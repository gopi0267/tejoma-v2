# Tejoma - AI Recruitment Platform

React 19 + Vite frontend, Node/Express backend, PostgreSQL, and two Python FastAPI microservices
(JD parsing NLP, matching ML ensemble), with Google Gemini for resume parsing, JD-parser NLP
fallback fields, and a RAG chatbot.

## Run Locally

**Prerequisites:** Node.js 20+, Python 3.11+, PostgreSQL 14+ running locally.

1. Install Node dependencies: `npm install`
2. Set up both Python microservices (each in its own virtualenv):
   ```bash
   cd python-services/jd-nlp-service && pip install -r requirements.txt && python -m spacy download en_core_web_sm
   cd python-services/matching-ml-service && pip install -r requirements.txt
   ```
3. Copy `.env.example` to `.env.local` and fill in real values (DB credentials, `GEMINI_API_KEY`,
   `JWT_SECRET`, etc. - see `.env.example` for what each one does).
4. Start all three processes (separate terminals):
   ```bash
   npm run dev                                                        # Node app, :3006
   cd python-services/jd-nlp-service && uvicorn main:app --port 8008   # JD-NLP service
   cd python-services/matching-ml-service && uvicorn main:app --port 8009  # Matching-ML service
   ```
5. Open `http://localhost:3006`.

## Production Deployment

Docker Compose + Nginx (TLS, reverse proxy) + Prometheus/Grafana monitoring - see
**[DEPLOYMENT.md](DEPLOYMENT.md)** for the full guide.
