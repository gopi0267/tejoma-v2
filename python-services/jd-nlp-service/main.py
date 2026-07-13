"""
JD NLP microservice - Tiers 3-5 of the JD parser pipeline (spaCy, PhraseMatcher, GLiNER).

Run: uvicorn main:app --host 0.0.0.0 --port 8008 --workers 1

Models (spaCy en_core_web_sm + GLiNER) are loaded exactly ONCE at process startup and kept warm
in memory for the life of the process - this is the whole reason this runs as a persistent
service instead of the old per-call subprocess pattern (see extract_resume_features.py), which
would take several seconds per call just to reload everything from disk. The Node backend
(src/jd-parser/tiers/nlpTier.ts) calls this over local HTTP, and only for the specific fields
Tiers 1-2 couldn't resolve - most well-formed JDs never need this service invoked at all.
"""
import logging
from contextlib import asynccontextmanager

import spacy
from fastapi import FastAPI
from pydantic import BaseModel

from matchers import build_title_matcher, extract_job_title
from ner import (
    extract_with_gliner,
    extract_location_spacy,
    extract_responsibilities_spacy,
    extract_summary_spacy,
    get_gliner_model,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("jd-nlp-service")

_state: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Loading spaCy model (en_core_web_sm)...")
    nlp = spacy.load("en_core_web_sm")
    _state["nlp"] = nlp
    _state["title_matcher"] = build_title_matcher(nlp)

    logger.info("Loading GLiNER model (urchade/gliner_small-v2)...")
    get_gliner_model()  # warms the model into ner.py's module-level cache

    logger.info("JD NLP service ready.")
    yield
    _state.clear()


app = FastAPI(title="Tejoma JD NLP Service", lifespan=lifespan)


class ExtractRequest(BaseModel):
    text: str
    neededFields: list[str] = []


class ExtractResponse(BaseModel):
    jobTitle: str | None = None
    industry: str | None = None
    department: str | None = None
    responsibilities: list[str] = []
    jobSummary: str | None = None
    location: list[str] = []


@app.get("/health")
def health():
    return {"status": "ok", "modelsLoaded": "nlp" in _state}


@app.post("/extract", response_model=ExtractResponse)
def extract(req: ExtractRequest) -> ExtractResponse:
    nlp = _state["nlp"]
    title_matcher = _state["title_matcher"]
    needed = set(req.neededFields)
    response = ExtractResponse()

    # --- Tier 4: PhraseMatcher for job title (fast, deterministic, tried before GLiNER) ---
    gliner_labels: list[str] = []
    if "jobTitle" in needed:
        title = extract_job_title(nlp, title_matcher, req.text)
        if title:
            response.jobTitle = title
        else:
            gliner_labels.append("job title")
    if "industry" in needed:
        gliner_labels.append("industry")
    if "department" in needed:
        gliner_labels.append("department")

    # --- Tier 5: GLiNER zero-shot NER, one batched call for whatever's still missing ---
    if gliner_labels:
        try:
            entities = extract_with_gliner(req.text, gliner_labels)
            if "job title" in entities and not response.jobTitle:
                response.jobTitle = entities["job title"]
            if "industry" in entities:
                response.industry = entities["industry"]
            if "department" in entities:
                response.department = entities["department"]
        except Exception as e:
            logger.warning(f"GLiNER extraction failed: {e}")

    # --- Tier 3: spaCy linguistic analysis for location/responsibilities/summary ---
    if "location" in needed:
        response.location = extract_location_spacy(nlp, req.text)
    if "responsibilities" in needed:
        response.responsibilities = extract_responsibilities_spacy(nlp, req.text)
    if "jobSummary" in needed:
        response.jobSummary = extract_summary_spacy(nlp, req.text)

    return response
