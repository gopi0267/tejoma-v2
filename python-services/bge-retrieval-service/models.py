"""
BGE-M3 (dense embedding) + BGE-Reranker-v2-m3 (cross-encoder) - a deliberately SEPARATE service
from matching-ml-service, not merged into it. Both models are ~25x larger than
all-MiniLM-L6-v2 (the model matching-ml-service runs) and were benchmarked on this project's own
CPU dev machine at ~3.3s for a single embedding and ~580ms per reranked pair - see the
integration's own module doc in src/matching/bgeShadowRetrieval.ts for the full number. That is
far too slow to share a process/port with the live-path MiniLM service.

sentence-transformers auto-detects CUDA and uses it when available, CPU otherwise - this same
code runs unchanged on a laptop today and on a real GPU box later; only where it's deployed
changes, not what's deployed. Never wired into any live request path (see the TS side's own
module docs) - shadow-mode comparison only.
"""
from sentence_transformers import SentenceTransformer, CrossEncoder

_embed_model: SentenceTransformer | None = None
_reranker: CrossEncoder | None = None


def get_embedding_model() -> SentenceTransformer:
    global _embed_model
    if _embed_model is None:
        _embed_model = SentenceTransformer('BAAI/bge-m3')
    return _embed_model


def get_reranker() -> CrossEncoder:
    global _reranker
    if _reranker is None:
        _reranker = CrossEncoder('BAAI/bge-reranker-v2-m3')
    return _reranker


def embed_text(text: str) -> list[float]:
    model = get_embedding_model()
    vector = model.encode(text[:5000], normalize_embeddings=True)
    return vector.tolist()


def embed_texts_batch(texts: list[str]) -> list[list[float]]:
    model = get_embedding_model()
    truncated = [t[:5000] for t in texts]
    vectors = model.encode(truncated, normalize_embeddings=True, batch_size=8)
    return vectors.tolist()


def rerank(query: str, documents: list[str]) -> list[float]:
    reranker = get_reranker()
    pairs = [[query[:2000], doc[:5000]] for doc in documents]
    scores = reranker.predict(pairs)
    return [float(s) for s in scores]
