"""
Tier 3 (spaCy linguistic analysis) and Tier 5 (GLiNER zero-shot NER) extraction functions.

spaCy handles what it's naturally strong at here: GPE/LOC named-entity recognition for location,
POS-tag-based sentence classification for responsibilities, and sentence segmentation for the
summary fallback - all fast, deterministic, no zero-shot model needed.

GLiNER is reserved for genuinely open-vocabulary fields a fixed dictionary or POS heuristic can't
handle well: job title (only as a fallback, if PhraseMatcher found nothing), industry, and
department - these can be almost any string, which is exactly GLiNER's use case.
"""
import re

from gliner import GLiNER

_gliner_model: GLiNER | None = None


def get_gliner_model() -> GLiNER:
    """Lazily loads GLiNER on first use, then keeps it cached for the process lifetime - loaded
    once at most, matching the "no unnecessary model loading" requirement. Called during FastAPI
    startup (see main.py) so the first real request never pays the load cost."""
    global _gliner_model
    if _gliner_model is None:
        _gliner_model = GLiNER.from_pretrained("urchade/gliner_small-v2")
    return _gliner_model


# GLiNER sometimes includes the label word itself as part of the matched span (e.g. "Platform
# Engineering department" for label "department") - strip a trailing occurrence of the label
# word(s). It also sometimes includes a generic trailing business noun regardless of label
# (e.g. "fintech company" for label "industry") - strip those too, so the returned value is just
# the actual name.
_GENERIC_TRAILING_WORDS = ["company", "companies", "organization", "organisation", "sector", "industry", "field"]


def _strip_trailing_label_word(value: str, label: str) -> str:
    words_to_strip = [*label.split(), *_GENERIC_TRAILING_WORDS]
    changed = True
    while changed:
        changed = False
        for word in words_to_strip:
            new_value = re.sub(rf"\s+{re.escape(word)}s?$", "", value, flags=re.IGNORECASE)
            if new_value != value:
                value = new_value
                changed = True
    return value.strip()


def extract_with_gliner(text: str, labels: list[str], threshold: float = 0.4) -> dict[str, str]:
    model = get_gliner_model()
    truncated = text[:3000]
    entities = model.predict_entities(truncated, labels, threshold=threshold)

    result: dict[str, str] = {}
    for ent in entities:
        label = ent["label"]
        if label in result:
            continue
        value = _strip_trailing_label_word(ent["text"].strip(), label)
        if value and len(value) < 100:
            result[label] = value
    return result


def extract_location_spacy(nlp, text: str) -> list[str]:
    doc = nlp(text[:3000])
    locations: list[str] = []
    seen: set[str] = set()
    for ent in doc.ents:
        if ent.label_ in ("GPE", "LOC"):
            key = ent.text.strip().lower()
            if key and key not in seen:
                seen.add(key)
                locations.append(ent.text.strip())
    return locations


def extract_responsibilities_spacy(nlp, text: str) -> list[str]:
    """Sentences whose first token is a verb (imperative mood, e.g. "Design and build...",
    "Collaborate with...") - a reasonable proxy for responsibility-style bullets when the
    document has no recognizable "Responsibilities" section header at all."""
    doc = nlp(text[:5000])
    responsibilities: list[str] = []
    for sent in doc.sents:
        tokens = [t for t in sent if not t.is_space]
        if not tokens:
            continue
        first = tokens[0]
        if first.pos_ == "VERB" and 4 <= len(tokens) <= 40:
            responsibilities.append(sent.text.strip())
        if len(responsibilities) >= 10:
            break
    return responsibilities


def extract_summary_spacy(nlp, text: str) -> str | None:
    doc = nlp(text[:2000])
    sentences = [s.text.strip() for s in doc.sents if s.text.strip()]
    if not sentences:
        return None
    return " ".join(sentences[:2])
