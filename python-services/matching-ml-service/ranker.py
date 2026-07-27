"""
Enterprise AI Matching Architecture, Phase 3 - Learning-to-Rank.

XGBRanker (rank:pairwise) + LGBMRanker (lambdarank), trained on GROUPED candidate examples
(query = job_id) instead of the i.i.d. accept/reject samples ensemble.py's classifiers use -
ranking loss functions optimize relative order *within* a job's candidate pool, which is the
actual shape of "Match Candidates" (rank N candidates for one job), unlike a classifier trained
to predict each candidate's accept probability independently of who else is in the pool.

Fully parallel and isolated from ensemble.py/MatchEnsemble: separate classes, separate joblib
files on disk, separate FastAPI endpoints (main.py's /train/ranking, /predict/ranking/batch).
Nothing in this file is called by the production classification path (get_ensemble/predict_batch)
or by any live scoring code in the Node side (src/services.ts, src/matching/matchingApi.ts) -
see src/matching/learningToRank.ts for the equally isolated Node-side orchestrator.

No RandomForest equivalent exists in scikit-learn for ranking (no RandomForestRanker) - per
explicit instruction, this ranking ensemble is XGBRanker + LGBMRanker only; RandomForest stays
classification-only in ensemble.py, unmodified.

Relevance grades are INTEGERS (enforced by main.py's Pydantic schema) - LightGBM's lambdarank
objective rejects non-integer labels (confirmed by hitting "label should be int type... for
ranking task" when a raw 0.5 "save" swipe value was sent directly). The Node caller
(src/matching/learningToRank.ts) maps its real signal values onto an ordinal integer scale
(reject=0, save=1, accept=2) before calling /train/ranking - a different encoding from the
Evaluation Framework's (src/matching/evaluation.ts), which uses the exact 0/0.5/1 swipe values
as float relevance for NDCG (no library constraint there). Both are internally consistent; they
don't need to share an encoding since they measure different things.
"""
import os
import joblib
import numpy as np
from xgboost import XGBRanker
from lightgbm import LGBMRanker

# Uses the same 8-dimensional feature schema as ensemble.py's FEATURE_NAMES (jaccard_skill_score,
# cosine_text_score, cosine_bert_score, euclidean_feature_score, experience_score, location_score,
# salary_score, levenshtein_title_score) - not re-imported here since this module never inspects
# individual feature columns by name, only passes the vector through to XGBRanker/LGBMRanker.

MODELS_DIR = os.path.join(os.path.dirname(__file__), 'models')
os.makedirs(MODELS_DIR, exist_ok=True)

MIN_GROUPS_TO_TRAIN = 2  # need at least 2 rank groups (jobs) to learn any relative order at all
MIN_GROUP_SIZE = 2  # a group of 1 candidate has no relative order to learn from


class LearningToRankEnsemble:
    def __init__(self):
        self.xgb_ranker: XGBRanker | None = None
        self.lgbm_ranker: LGBMRanker | None = None
        self.is_trained = False
        self.trained_example_count = 0
        self.trained_group_count = 0
        self._load_from_disk()

    def _paths(self):
        return {
            'xgb_ranker': os.path.join(MODELS_DIR, 'xgb_ranker.joblib'),
            'lgbm_ranker': os.path.join(MODELS_DIR, 'lgbm_ranker.joblib'),
            'meta': os.path.join(MODELS_DIR, 'ranker_meta.joblib'),
        }

    def _load_from_disk(self):
        paths = self._paths()
        if all(os.path.exists(p) for p in paths.values()):
            self.xgb_ranker = joblib.load(paths['xgb_ranker'])
            self.lgbm_ranker = joblib.load(paths['lgbm_ranker'])
            meta = joblib.load(paths['meta'])
            self.trained_example_count = meta.get('example_count', 0)
            self.trained_group_count = meta.get('group_count', 0)
            self.is_trained = True

    def _save_to_disk(self):
        paths = self._paths()
        joblib.dump(self.xgb_ranker, paths['xgb_ranker'])
        joblib.dump(self.lgbm_ranker, paths['lgbm_ranker'])
        joblib.dump({'example_count': self.trained_example_count, 'group_count': self.trained_group_count}, paths['meta'])

    def train(self, X: list[list[float]], relevance: list[float], group_sizes: list[int]) -> dict:
        """X/relevance are concatenated across all groups, IN GROUP ORDER (XGBRanker/LGBMRanker's
        group API requires contiguous examples per group, matching len(X) == sum(group_sizes))."""
        X_arr = np.array(X, dtype=float)
        y_arr = np.array(relevance, dtype=float)
        groups = np.array(group_sizes, dtype=int)
        n = len(y_arr)
        n_groups = len(groups)

        if n_groups < MIN_GROUPS_TO_TRAIN:
            return {'trained': False, 'reason': f'Need at least {MIN_GROUPS_TO_TRAIN} rank groups (jobs), got {n_groups}', 'exampleCount': n, 'groupCount': n_groups}

        usable_groups = int(np.sum(groups >= MIN_GROUP_SIZE))
        if usable_groups < MIN_GROUPS_TO_TRAIN:
            return {
                'trained': False,
                'reason': f'Need at least {MIN_GROUPS_TO_TRAIN} groups with >= {MIN_GROUP_SIZE} candidates each to learn a relative order, got {usable_groups}',
                'exampleCount': n, 'groupCount': n_groups,
            }

        if len(set(y_arr.tolist())) < 2:
            return {'trained': False, 'reason': 'Relevance labels have no variation (all identical) - cannot learn a ranking', 'exampleCount': n, 'groupCount': n_groups}

        self.xgb_ranker = XGBRanker(objective='rank:pairwise', n_estimators=150, max_depth=5, learning_rate=0.1, random_state=42)
        self.lgbm_ranker = LGBMRanker(objective='lambdarank', n_estimators=150, max_depth=5, learning_rate=0.1, random_state=42, verbose=-1)

        self.xgb_ranker.fit(X_arr, y_arr, group=groups)
        self.lgbm_ranker.fit(X_arr, y_arr, group=groups)

        self.is_trained = True
        self.trained_example_count = n
        self.trained_group_count = n_groups
        self._save_to_disk()

        return {'trained': True, 'exampleCount': n, 'groupCount': n_groups}

    def predict_batch(self, X: list[list[float]]) -> list[dict]:
        if not self.is_trained:
            raise RuntimeError('Learning-to-Rank ensemble has not been trained yet')

        X_arr = np.array(X, dtype=float)
        xgb_scores = self.xgb_ranker.predict(X_arr)
        lgbm_scores = self.lgbm_ranker.predict(X_arr)

        # Ranker outputs are unbounded relative-order scores, not probabilities - min-max
        # normalize per batch so callers get a comparable 0-1 "ranking score" instead of a raw,
        # unbounded logit whose scale has no fixed meaning across different candidate pools.
        def normalize(arr: np.ndarray) -> list[float]:
            lo, hi = float(np.min(arr)), float(np.max(arr))
            if hi - lo < 1e-9:
                return [0.5 for _ in arr]
            return [(float(v) - lo) / (hi - lo) for v in arr]

        xgb_norm = normalize(xgb_scores)
        lgbm_norm = normalize(lgbm_scores)
        ensemble_norm = [(a + b) / 2 for a, b in zip(xgb_norm, lgbm_norm)]

        return [
            {
                'xgboostRanker': round(xgb_norm[i], 4),
                'lightgbmRanker': round(lgbm_norm[i], 4),
                'ensemble': round(ensemble_norm[i], 4),
            }
            for i in range(len(X))
        ]


_ranker_instance: LearningToRankEnsemble | None = None


def get_ranker() -> LearningToRankEnsemble:
    global _ranker_instance
    if _ranker_instance is None:
        _ranker_instance = LearningToRankEnsemble()
    return _ranker_instance
