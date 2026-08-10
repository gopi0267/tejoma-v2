"""
BGE-M3 + BGE-Reranker-v2-m3 microservice - a standalone, GPU-ready retrieval/reranking service,
deliberately kept separate from python-services/matching-ml-service (which stays the live-path
service, unchanged). See models.py's module doc for why these two never share a process.

Run (CPU dev machine today): uvicorn main:app --host 127.0.0.1 --port 8010 --workers 1
Run (future GPU box): identical command - sentence-transformers uses CUDA automatically when
available. Point BGE_SERVICE_URL (src/matching/bgeRetrievalClient.ts) at wherever this runs.

Not started automatically by `npm run dev` or any other part of this app - this only produces
real shadow data when explicitly run for local testing or pointed at a real deployment, exactly
as intended for a shadow-mode-only, not-yet-wired-into-anything-live capability.
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from pydantic import BaseModel

from models import embed_text, embed_texts_batch, rerank, get_embedding_model, get_reranker

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("bge-retrieval-service")

_state: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Loading BGE-M3 (embedding model)...")
    get_embedding_model()
    logger.info("Loading BGE-Reranker-v2-m3 (cross-encoder)...")
    get_reranker()
    _state["ready"] = True
    logger.info("BGE retrieval service ready.")
    yield
    _state.clear()


app = FastAPI(title="Tejoma BGE Retrieval Service (shadow-mode, GPU-ready)", lifespan=lifespan)


class EmbedRequest(BaseModel):
    text: str


class EmbedResponse(BaseModel):
    embedding: list[float]


class EmbedBatchRequest(BaseModel):
    texts: list[str]


class EmbedBatchResponse(BaseModel):
    embeddings: list[list[float]]


class RerankRequest(BaseModel):
    query: str
    documents: list[str]


class RerankResponse(BaseModel):
    scores: list[float]


@app.get("/health")
def health():
    return {"status": "ok" if _state.get("ready") else "loading", "modelsLoaded": bool(_state.get("ready"))}


@app.post("/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest):
    return EmbedResponse(embedding=embed_text(req.text))


@app.post("/embed/batch", response_model=EmbedBatchResponse)
def embed_batch(req: EmbedBatchRequest):
    return EmbedBatchResponse(embeddings=embed_texts_batch(req.texts))


@app.post("/rerank", response_model=RerankResponse)
def rerank_endpoint(req: RerankRequest):
    return RerankResponse(scores=rerank(req.query, req.documents))
