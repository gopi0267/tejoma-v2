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


class TrainRequest(BaseModel):
    samples: list[TrainSample]


class PredictBatchRequest(BaseModel):
    featureVectors: list[list[float]]


@app.get("/health")
def health():
    ensemble = get_ensemble()
    return {
        "status": "ok",
        "embeddingModelLoaded": "ensemble" in _state,
        "ensembleTrained": ensemble.is_trained,
        "trainedSampleCount": ensemble.trained_sample_count,
        "featureSchema": FEATURE_NAMES,
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
    result = ensemble.train(X, y)
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
