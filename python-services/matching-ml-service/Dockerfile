# Matching-ML microservice - sentence-transformers embeddings + RandomForest/XGBoost/LightGBM
# ensemble. Trained model artifacts live in ./models (mounted as a named volume in
# docker-compose.yml so a rebuild doesn't wipe the trained ensemble). Internal-only: no ports
# published to the host, reachable only from the Node app container.
# 3.12, not 3.11 - xgboost==3.3.0 (requirements.txt) requires Python >=3.12.
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py ensemble.py embeddings.py ./
RUN mkdir -p models

RUN useradd --create-home tejoma && chown -R tejoma:tejoma /app
USER tejoma

EXPOSE 8009

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://127.0.0.1:8009/health || exit 1

# This service's own docstring documents --host 127.0.0.1, which would be unreachable from the
# app container - overridden to 0.0.0.0 here.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8009", "--workers", "1"]
