"""
Matching ML microservice: BERT embeddings + RandomForest/XGBoost/LightGBM ensemble for
candidate-job match scoring.

Run: uvicorn main:app --host 127.0.0.1 --port 8009 --workers 1

Persistent process, same reasoning as python-services/jd-nlp-service: the sentence-transformer
model loads once at startup and stays warm; trained tree ensembles are persisted to disk
(./models/) and reloaded on restart so training isn't lost between deploys.
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from embeddings import embed_text, embed_texts_batch, get_embedding_model
from ensemble import get_ensemble, FEATURE_NAMES
from ranker import get_ranker

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("matching-ml-service")

_state: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Loading sentence-transformer model (all-MiniLM-L6-v2)...")
    get_embedding_model()
    logger.info("Loading match ensemble (from disk if previously trained)...")
    _state["ensemble"] = get_ensemble()
    logger.info(f"Matching ML service ready. Ensemble trained: {_state['ensemble'].is_trained} (n={_state['ensemble'].trained_sample_count})")
    logger.info("Loading Learning-to-Rank ensemble (from disk if previously trained)...")
    _state["ranker"] = get_ranker()
    logger.info(f"Learning-to-Rank ready. Trained: {_state['ranker'].is_trained} (examples={_state['ranker'].trained_example_count}, groups={_state['ranker'].trained_group_count})")
    yield
    _state.clear()


app = FastAPI(title="Tejoma Matching ML Service", lifespan=lifespan)


class EmbedRequest(BaseModel):
    text: str


class EmbedResponse(BaseModel):
    embedding: list[float]


class EmbedBatchRequest(BaseModel):
    texts: list[str]


class EmbedBatchResponse(BaseModel):
    embeddings: list[list[float]]


class TrainSample(BaseModel):
    features: list[float]
    label: int  # 1 = accepted, 0 = rejected
    # Enterprise AI Matching Architecture, Phase 3 - Feedback Learning Engine. Optional per-sample
    # confidence (0-1); omitted defaults to full confidence (1.0), reproducing pre-Phase-3
    # behavior exactly when the Node caller doesn't send it.
    weight: float | None = None


class TrainRequest(BaseModel):
    samples: list[TrainSample]


class PredictBatchRequest(BaseModel):
    featureVectors: list[list[float]]


# Enterprise AI Matching Architecture, Phase 3 - Learning-to-Rank. Separate request/response
# shapes from TrainRequest/PredictBatchRequest above (grouped by job, graded relevance) - not a
# variant of the classification ensemble's flat, ungrouped schema.
class RankingSample(BaseModel):
    features: list[float]
    # Graded relevance, INTEGER (LightGBM's lambdarank objective rejects non-integer labels -
    # confirmed: "label should be int type... for ranking task" - discovered when swipe.action's
    # 0.5 "save" value was sent directly). The Node caller (src/matching/learningToRank.ts) maps
    # its 3 real signal values onto an ordinal integer scale (reject=0, save=1, accept=2) before
    # calling this endpoint - Pydantic enforces that contract here by rejecting a non-integer
    # float with a clean 422 instead of this endpoint crashing with a raw LightGBM exception.
    relevance: int


class RankingGroup(BaseModel):
    jobId: int
    samples: list[RankingSample]


class TrainRankingRequest(BaseModel):
    groups: list[RankingGroup]


class PredictRankingBatchRequest(BaseModel):
    featureVectors: list[list[float]]


@app.get("/health")
def health():
    ensemble = get_ensemble()
    ranker = get_ranker()
    return {
        "status": "ok",
        "embeddingModelLoaded": "ensemble" in _state,
        "ensembleTrained": ensemble.is_trained,
        "trainedSampleCount": ensemble.trained_sample_count,
        "featureSchema": FEATURE_NAMES,
        # Learning-to-Rank - reported for monitoring only; never read by any live scoring
        # decision (this ranker is isolated from production matching this phase).
        "rankerTrained": ranker.is_trained,
        "rankerTrainedExampleCount": ranker.trained_example_count,
        "rankerTrainedGroupCount": ranker.trained_group_count,
    }


@app.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest):
    if not req.text or not req.text.strip():
        raise HTTPException(status_code=400, detail="text is required")
    return EmbedResponse(embedding=embed_text(req.text))


@app.post("/embed/batch", response_model=EmbedBatchResponse)
def embed_batch(req: EmbedBatchRequest):
    if not req.texts:
        raise HTTPException(status_code=400, detail="texts is required")
    return EmbedBatchResponse(embeddings=embed_texts_batch(req.texts))


@app.post("/train")
def train(req: TrainRequest):
    if not req.samples:
        raise HTTPException(status_code=400, detail="samples is required")

    ensemble = get_ensemble()
    X = [s.features for s in req.samples]
    y = [s.label for s in req.samples]
    # None (not 1.0-filled) when no sample sent a weight at all, so ensemble.train's own
    # backward-compatible default (weight-free .fit(), byte-identical to pre-Phase-3 behavior)
    # is what actually runs - not a weight array indistinguishable from "no weights".
    weights = [s.weight for s in req.samples]
    sample_weight = weights if any(w is not None for w in weights) else None
    if sample_weight is not None:
        sample_weight = [w if w is not None else 1.0 for w in sample_weight]
    result = ensemble.train(X, y, sample_weight)
    return result


@app.post("/predict/batch")
def predict_batch(req: PredictBatchRequest):
    ensemble = get_ensemble()
    if not ensemble.is_trained:
        return {"trained": False, "predictions": []}

    if not req.featureVectors:
        raise HTTPException(status_code=400, detail="featureVectors is required")

    predictions = ensemble.predict_batch(req.featureVectors)
    return {"trained": True, "trainedSampleCount": ensemble.trained_sample_count, "predictions": predictions}


# ==================== LEARNING-TO-RANK (Phase 3) ====================
# Additive, isolated endpoints - do not modify /train or /predict/batch above, and are never
# called by the production classification path. See ranker.py's module doc.

@app.post("/train/ranking")
def train_ranking(req: TrainRankingRequest):
    if not req.groups:
        raise HTTPException(status_code=400, detail="groups is required")

    ranker = get_ranker()
    X: list[list[float]] = []
    relevance: list[float] = []
    group_sizes: list[int] = []
    for group in req.groups:
        if not group.samples:
            continue
        group_sizes.append(len(group.samples))
        for sample in group.samples:
            X.append(sample.features)
            relevance.append(sample.relevance)

    result = ranker.train(X, relevance, group_sizes)
    return result


@app.post("/predict/ranking/batch")
def predict_ranking_batch(req: PredictRankingBatchRequest):
    ranker = get_ranker()
    if not ranker.is_trained:
        return {"trained": False, "predictions": []}

    if not req.featureVectors:
        raise HTTPException(status_code=400, detail="featureVectors is required")

    predictions = ranker.predict_batch(req.featureVectors)
    return {
        "trained": True,
        "trainedExampleCount": ranker.trained_example_count,
        "trainedGroupCount": ranker.trained_group_count,
        "predictions": predictions,
    }
