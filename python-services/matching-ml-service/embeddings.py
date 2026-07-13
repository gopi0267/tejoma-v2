"""
Sentence-BERT embeddings for resume/job-description semantic similarity.

all-MiniLM-L6-v2 is the standard lightweight production choice: ~80MB, 384-dim, free/open-source
(sentence-transformers, already installed in this repo's venv), and fast enough on CPU to embed
a resume or job description in well under 100ms. Embeddings are generated ONCE per candidate/job
(at creation time, see src/algorithms/bert-embeddings.ts) and stored in Postgres - real-time
match scoring never calls this at all, it just does a fast in-memory cosine similarity over the
already-stored vectors.
"""
from sentence_transformers import SentenceTransformer

_model: SentenceTransformer | None = None


def get_embedding_model() -> SentenceTransformer:
    global _model
    if _model is None:
        _model = SentenceTransformer('all-MiniLM-L6-v2')
    return _model


def embed_text(text: str) -> list[float]:
    model = get_embedding_model()
    # Truncate to a generous character budget - the model itself truncates to 256 tokens
    # internally, this just avoids tokenizing an enormous string for no benefit.
    vector = model.encode(text[:5000], normalize_embeddings=True)
    return vector.tolist()


def embed_texts_batch(texts: list[str]) -> list[list[float]]:
    model = get_embedding_model()
    truncated = [t[:5000] for t in texts]
    vectors = model.encode(truncated, normalize_embeddings=True, batch_size=32)
    return vectors.tolist()
