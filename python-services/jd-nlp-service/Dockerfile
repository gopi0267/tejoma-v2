# JD-NLP microservice - spaCy + GLiNER, models loaded once at FastAPI startup (see main.py's
# lifespan handler), never per-request. Internal-only: no ports published to the host, reachable
# only from the Node app container over the Docker internal network.
FROM python:3.11-slim

WORKDIR /app

# torch/transformers pull in build tooling transitively; curl is needed for the HEALTHCHECK.
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN python -m spacy download en_core_web_sm

COPY main.py matchers.py ner.py ./

RUN useradd --create-home tejoma && mkdir -p /home/tejoma/.cache/huggingface && chown -R tejoma:tejoma /home/tejoma/.cache
USER tejoma

EXPOSE 8008

# start-period is long because GLiNER's model isn't baked into the image at build time (only
# spaCy's en_core_web_sm is) - it downloads from HuggingFace on first container startup. A
# named volume for the HF cache (wired up in docker-compose.yml) means this long wait only
# happens once, not on every container recreate.
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=5 \
  CMD curl -f http://127.0.0.1:8008/health || exit 1

# --host 0.0.0.0 (not the 127.0.0.1 in this service's own docstring) so it's reachable from the
# app container.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8008", "--workers", "1"]
