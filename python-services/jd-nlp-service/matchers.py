"""
spaCy PhraseMatcher-based job title detection - Tier 4 in the pipeline priority order
(regex -> dictionary -> spaCy -> PhraseMatcher -> GLiNER -> validation).

Rather than a single flat list of exact job titles (which could never enumerate every real-world
title), this matches on common TITLE SUFFIX/ROLE words (Engineer, Developer, Manager, ...) plus
optional seniority prefixes (Senior, Lead, Principal, ...), then expands the match to the full
containing line - this is a fast, deterministic pass that resolves the large majority of JDs
without ever needing the heavier GLiNER zero-shot fallback.
"""
from spacy.matcher import PhraseMatcher

SENIORITY_PREFIXES = [
    "Senior", "Sr", "Sr.", "Junior", "Jr", "Jr.", "Lead", "Principal", "Staff",
    "Associate", "Chief", "Head of", "VP of", "Director of",
]

ROLE_WORDS = [
    "Engineer", "Developer", "Manager", "Analyst", "Designer", "Architect",
    "Consultant", "Scientist", "Administrator", "Executive", "Officer",
    "Specialist", "Intern", "Lead", "Director", "Coordinator", "Recruiter",
    "Accountant", "Researcher", "Strategist", "Producer", "Product Manager",
    "Project Manager", "Program Manager", "QA Engineer", "DevOps Engineer",
    "Data Scientist", "Data Engineer", "Software Engineer", "Full Stack Developer",
    "Backend Developer", "Frontend Developer", "UX Designer", "UI Designer",
]


def build_title_matcher(nlp) -> PhraseMatcher:
    matcher = PhraseMatcher(nlp.vocab, attr="LOWER")
    patterns = [nlp.make_doc(word) for word in ROLE_WORDS]
    matcher.add("ROLE_WORD", patterns)
    return matcher


def extract_job_title(nlp, matcher: PhraseMatcher, text: str) -> str | None:
    """
    Scans only the first ~300 chars (titles appear near the top of a JD) for a role-word
    match, then expands to the full line it's on and strips a leading seniority prefix marker
    if present, returning the line as the candidate title.
    """
    head = text[:300]
    doc = nlp(head)
    matches = matcher(doc)
    if not matches:
        return None

    # Take the earliest match (titles are almost always the very first role-word mention).
    match_id, start, end = min(matches, key=lambda m: m[1])
    span = doc[start:end]

    # Expand to the full line containing the match.
    line_start = head.rfind("\n", 0, span.start_char) + 1
    line_end = head.find("\n", span.end_char)
    if line_end == -1:
        line_end = len(head)
    line = head[line_start:line_end].strip()

    if not line or len(line) > 80:
        return span.text
    return line
