"""
Three-model ensemble for candidate-job match prediction: a real scikit-learn RandomForest
(replacing the hand-rolled TypeScript one previously used - a proper, tested implementation),
XGBoost, and LightGBM, combined via soft-voting (averaging predicted probabilities).

Trained on past recruiter swipe decisions (accept=1/reject=0) against an 8-dimensional feature
vector built in Node (src/services.ts) - see FEATURE_NAMES below for the exact schema, which
must stay in sync with the Node-side feature builder.

Models are persisted to disk (joblib) so a service restart doesn't lose training. Training data
volume is NOT gated here - the Python service always fits on whatever it's given; the Node side
is responsible for confidence-blending the ensemble output against the heuristic score based on
how much training data actually existed (see calculateMatchScore in src/services.ts).
"""
import os
import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import cross_val_score, StratifiedKFold
from xgboost import XGBClassifier
from lightgbm import LGBMClassifier

FEATURE_NAMES = [
    'jaccard_skill_score',
    'cosine_text_score',
    'cosine_bert_score',
    'euclidean_feature_score',
    'experience_score',
    'location_score',
    'salary_score',
    'levenshtein_title_score',
]

MODELS_DIR = os.path.join(os.path.dirname(__file__), 'models')
os.makedirs(MODELS_DIR, exist_ok=True)

MIN_SAMPLES_TO_TRAIN = 5  # below this, fitting a tree ensemble is meaningless (can't even split)
MIN_SAMPLES_FOR_CV = 10  # below this, skip cross-validation (not enough data for a fold split)


class MatchEnsemble:
    def __init__(self):
        self.rf: RandomForestClassifier | None = None
        self.xgb: XGBClassifier | None = None
        self.lgbm: LGBMClassifier | None = None
        self.is_trained = False
        self.trained_sample_count = 0
        self._load_from_disk()

    def _paths(self):
        return {
            'rf': os.path.join(MODELS_DIR, 'random_forest.joblib'),
            'xgb': os.path.join(MODELS_DIR, 'xgboost.joblib'),
            'lgbm': os.path.join(MODELS_DIR, 'lightgbm.joblib'),
            'meta': os.path.join(MODELS_DIR, 'meta.joblib'),
        }

    def _load_from_disk(self):
        paths = self._paths()
        if all(os.path.exists(p) for p in paths.values()):
            self.rf = joblib.load(paths['rf'])
            self.xgb = joblib.load(paths['xgb'])
            self.lgbm = joblib.load(paths['lgbm'])
            meta = joblib.load(paths['meta'])
            self.trained_sample_count = meta.get('sample_count', 0)
            self.is_trained = True

    def _save_to_disk(self):
        paths = self._paths()
        joblib.dump(self.rf, paths['rf'])
        joblib.dump(self.xgb, paths['xgb'])
        joblib.dump(self.lgbm, paths['lgbm'])
        joblib.dump({'sample_count': self.trained_sample_count}, paths['meta'])

    def train(self, X: list[list[float]], y: list[int]) -> dict:
        X_arr = np.array(X, dtype=float)
        y_arr = np.array(y, dtype=int)
        n = len(y_arr)

        if n < MIN_SAMPLES_TO_TRAIN:
            return {'trained': False, 'reason': f'Need at least {MIN_SAMPLES_TO_TRAIN} samples, got {n}', 'sampleCount': n}

        if len(set(y_arr.tolist())) < 2:
            return {'trained': False, 'reason': 'Training data has only one class (all accepts or all rejects) - cannot fit a classifier', 'sampleCount': n}

        self.rf = RandomForestClassifier(n_estimators=200, max_depth=10, min_samples_leaf=2, random_state=42, class_weight='balanced')
        self.xgb = XGBClassifier(n_estimators=150, max_depth=5, learning_rate=0.1, eval_metric='logloss', random_state=42)
        self.lgbm = LGBMClassifier(n_estimators=150, max_depth=5, learning_rate=0.1, random_state=42, verbose=-1)

        self.rf.fit(X_arr, y_arr)
        self.xgb.fit(X_arr, y_arr)
        self.lgbm.fit(X_arr, y_arr)

        self.is_trained = True
        self.trained_sample_count = n
        self._save_to_disk()

        metrics = {'trained': True, 'sampleCount': n}
        if n >= MIN_SAMPLES_FOR_CV:
            folds = min(5, min(np.bincount(y_arr)))
            if folds >= 2:
                cv = StratifiedKFold(n_splits=folds, shuffle=True, random_state=42)
                metrics['cvAccuracy'] = {
                    'randomForest': round(float(cross_val_score(RandomForestClassifier(n_estimators=200, max_depth=10, random_state=42), X_arr, y_arr, cv=cv).mean()), 4),
                    'xgboost': round(float(cross_val_score(XGBClassifier(n_estimators=150, max_depth=5, eval_metric='logloss', random_state=42), X_arr, y_arr, cv=cv).mean()), 4),
                    'lightgbm': round(float(cross_val_score(LGBMClassifier(n_estimators=150, max_depth=5, random_state=42, verbose=-1), X_arr, y_arr, cv=cv).mean()), 4),
                }
        else:
            metrics['cvAccuracy'] = None
            metrics['note'] = f'Fewer than {MIN_SAMPLES_FOR_CV} samples - cross-validation skipped, model fit on all available data'

        return metrics

    def predict_batch(self, X: list[list[float]]) -> list[dict]:
        if not self.is_trained:
            raise RuntimeError('Ensemble has not been trained yet')

        X_arr = np.array(X, dtype=float)
        rf_probs = self.rf.predict_proba(X_arr)[:, 1]
        xgb_probs = self.xgb.predict_proba(X_arr)[:, 1]
        lgbm_probs = self.lgbm.predict_proba(X_arr)[:, 1]
        ensemble_probs = (rf_probs + xgb_probs + lgbm_probs) / 3

        return [
            {
                'randomForest': round(float(rf_probs[i]), 4),
                'xgboost': round(float(xgb_probs[i]), 4),
                'lightgbm': round(float(lgbm_probs[i]), 4),
                'ensemble': round(float(ensemble_probs[i]), 4),
            }
            for i in range(len(X))
        ]


_ensemble_instance: MatchEnsemble | None = None


def get_ensemble() -> MatchEnsemble:
    global _ensemble_instance
    if _ensemble_instance is None:
        _ensemble_instance = MatchEnsemble()
    return _ensemble_instance
