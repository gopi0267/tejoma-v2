import os
import sys
import json
import argparse
import fitz  # PyMuPDF
import spacy
from spacy.matcher import PhraseMatcher
from flashtext import KeywordProcessor

# Setup warnings suppression to keep stdout clean for JSON parsing
import warnings
warnings.filterwarnings("ignore")

def clean_extracted_text(text):
    if not text:
        return ""
    # Remove null bytes which crash postgres insert
    text = text.replace("\x00", "")
    # Normalize unicode whitespace characters
    import unicodedata
    text = unicodedata.normalize("NFKC", text)
    # Standardize newline characters
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # Clean non-printable characters except space, tab, and newline
    text = "".join(ch for ch in text if ch.isprintable() or ch in ['\n', '\t'])
    return text

def extract_pdf_text(file_path):
    """Layout-aware text extraction using PyMuPDF"""
    text = ""
    try:
        doc = fitz.open(file_path)
        for page in doc:
            # Extract text blocks preserving layout flows
            blocks = page.get_text("blocks")
            # Sort blocks from top-to-bottom, left-to-right
            blocks.sort(key=lambda b: (b[1], b[0]))
            for block in blocks:
                text += block[4] + "\n"
        return clean_extracted_text(text)
    except Exception as e:
        print(f"Error reading PDF with PyMuPDF: {str(e)}", file=sys.stderr)
        return ""

def run_gliner_ner(text):
    """Extract candidate name, email, and phone using GLiNER zero-shot NER"""
    ner_result = {"name": "N/A", "email": "N/A", "phone": "N/A"}
    try:
        from gliner import GLiNER
        # Load a small CPU-safe zero-shot NER model
        model = GLiNER.from_pretrained("urchade/gliner_small-v2")
        
        labels = ["candidate name", "email address", "phone number"]
        # Limit text length to prevent RAM issues on 16GB systems
        truncated_text = text[:4000]
        
        entities = model.predict_entities(truncated_text, labels, threshold=0.45)
        
        for ent in entities:
            label = ent["label"]
            text_val = ent["text"].strip()
            if label == "candidate name" and ner_result["name"] == "N/A":
                # Filter out obvious false positives
                if len(text_val.split()) >= 2 and len(text_val) < 40 and not any(x in text_val.lower() for x in ["curriculum", "resume", "objective", "profile"]):
                    ner_result["name"] = text_val
            elif label == "email address" and ner_result["email"] == "N/A":
                if "@" in text_val:
                    ner_result["email"] = text_val
            elif label == "phone number" and ner_result["phone"] == "N/A":
                # Simple validation to ensure it has numeric digits
                digits = "".join(c for c in text_val if c.isdigit())
                if len(digits) >= 10:
                    ner_result["phone"] = text_val
    except Exception as e:
        print(f"GLiNER prediction failed: {str(e)}", file=sys.stderr)
    return ner_result

def match_skills(text, skills_list):
    """Extract skills using FlashText (Trie keyword search) and spaCy PhraseMatcher"""
    matched_skills = set()
    try:
        # 1. FlashText Trie Matching (Fast & exact boundary match)
        kp = KeywordProcessor()
        for skill in skills_list:
            kp.add_keyword(skill)
        
        flashtext_matches = kp.extract_keywords(text)
        for match in flashtext_matches:
            matched_skills.add(match)
            
        # 2. spaCy PhraseMatcher Matching (NLP boundary match)
        nlp = spacy.load("en_core_web_sm")
        matcher = PhraseMatcher(nlp.vocab, attr="LOWER")
        
        # Build patterns
        patterns = [nlp.make_doc(skill) for skill in skills_list]
        matcher.add("SKILLS_PATTERNS", patterns)
        
        doc = nlp(text)
        spacy_matches = matcher(doc)
        for match_id, start, end in spacy_matches:
            span = doc[start:end]
            matched_skills.add(span.text)
    except Exception as e:
        print(f"Skills matching failed: {str(e)}", file=sys.stderr)
    
    # Return unique sorted skills
    return sorted(list(matched_skills))

def calculate_rerank_score(text, job_desc):
    """Calculate semantic relevance score using BGE Reranker"""
    if not job_desc or not job_desc.strip():
        return 0.0
    try:
        from sentence_transformers import CrossEncoder
        # Load lightweight BGE Reranker base model
        model = CrossEncoder("BAAI/bge-reranker-base")
        # Compute relevance score for pairs
        score = model.predict([job_desc, text])
        # Convert sigmoid logic to standard 0-1 confidence float
        import numpy as np
        prob = float(1 / (1 + np.exp(-score)))
        return round(prob, 4)
    except Exception as e:
        print(f"BGE Reranking failed: {str(e)}", file=sys.stderr)
        return 0.0

def main():
    parser = argparse.ArgumentParser(description="Advanced Extraction Engine")
    parser.add_argument("--file", help="Path to resume file")
    parser.add_argument("--skills", help="Path to skills.json list")
    parser.add_argument("--text", help="Raw text of the resume (optional fallback)")
    parser.add_argument("--job-desc", help="Target job description for reranker match scoring")
    parser.add_argument("--jobs", help="JSON array of jobs for batch match scoring (e.g. '[{\"id\": 1, \"description\": \"...\"}]')")
    args = parser.parse_args()

    # Determine source text
    raw_text = ""
    if args.text and args.text.strip():
        raw_text = clean_extracted_text(args.text)
    elif args.file and os.path.exists(args.file):
        ext = os.path.splitext(args.file)[1].lower()
        if ext == ".pdf":
            raw_text = extract_pdf_text(args.file)
        elif ext in [".docx", ".doc"]:
            # Word documents are parsed on the Node side and passed via --text to avoid zip format errors
            pass
        elif ext == ".txt":
            try:
                with open(args.file, "r", encoding="utf-8", errors="ignore") as f:
                    raw_text = clean_extracted_text(f.read())
            except Exception as e:
                print(f"Error reading TXT file: {str(e)}", file=sys.stderr)

    if not raw_text.strip():
        print(json.dumps({"error": "No text content found or extracted."}))
        sys.exit(1)

    # Load skills dictionary list
    skills_list = []
    if args.skills and os.path.exists(args.skills):
        try:
            with open(args.skills, "r", encoding="utf-8") as sf:
                s_data = json.load(sf)
                skills_list = s_data.get("skills", [])
        except Exception as e:
            print(f"Error loading skills list: {str(e)}", file=sys.stderr)

    # Perform zero-shot Named Entity Recognition
    ner_data = run_gliner_ner(raw_text)

    # Perform keyword & phrase skills matching
    skills_data = match_skills(raw_text, skills_list)

    # Perform semantic relevance ranking if job description exists
    rerank_score = calculate_rerank_score(raw_text, args.job_desc)

    # Perform batch jobs reranking if --jobs is specified
    job_scores = {}
    if args.jobs:
        try:
            jobs_list = json.loads(args.jobs)
            if jobs_list:
                from sentence_transformers import CrossEncoder
                import numpy as np
                model = CrossEncoder("BAAI/bge-reranker-base")
                pairs = [[job["description"], raw_text] for job in jobs_list]
                scores = model.predict(pairs)
                # Compute probabilities safely
                probs = 1 / (1 + np.exp(-scores))
                # Ensure it's iterable
                if np.isscalar(probs):
                    probs = [probs]
                elif isinstance(probs, np.ndarray) and probs.ndim == 0:
                    probs = [float(probs)]
                for i, job in enumerate(jobs_list):
                    job_scores[str(job["id"])] = round(float(probs[i]), 4)
        except Exception as e:
            print(f"BGE Jobs Reranking failed: {str(e)}", file=sys.stderr)

    # Output JSON results cleanly to stdout
    result = {
        "text": raw_text,
        "ner": ner_data,
        "skills": skills_data,
        "rerank_score": rerank_score,
        "job_scores": job_scores
    }
    
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()
