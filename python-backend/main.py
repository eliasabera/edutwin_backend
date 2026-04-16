import json
import os
import re
import socket
import subprocess
import sys
import time
from contextlib import asynccontextmanager
from typing import Literal, Optional
from urllib import error, request

import chromadb
from chromadb.utils import embedding_functions
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
import ollama
from pydantic import BaseModel, Field
import uvicorn

DB_DIR = "chroma_db"
MODEL = "llama3.1:8b"
EMBED_MODEL = "all-MiniLM-L6-v2"
DEFAULT_GRADE = "9"
HOST = os.getenv("EDUTWIN_HOST", "0.0.0.0")
PORT = int(os.getenv("EDUTWIN_PORT", "8000"))
TOP_K = 4
LIST_TOP_K = 12
TEACHER_GUIDE_TOP_K = 3
MAX_CONTEXT_SENTENCES = 5
MAX_CHAT_HISTORY_ITEMS = 6
COMPLEX_CHAT_TOKENS = 320
PRACTICE_TOKENS_PER_QUESTION = 160
MAX_PRACTICE_TOKENS = 1800
MIN_KEYWORD_OVERLAP = 1
MIN_CURRICULUM_GRADE = 9
MAX_CURRICULUM_GRADE = 12
INSUFFICIENT_CURRICULUM_INFO_MESSAGE = (
    "I cannot find enough information in the Ethiopian curriculum textbooks for your grade."
)
ABOVE_GRADE_LEVEL_MESSAGE = "This topic is above your grade level in the Ethiopian curriculum."
CURRICULUM_SCOPE_MESSAGE = "I can only help with Ethiopian curriculum learning topics."
I_DONT_KNOW_MESSAGE = "I don't know."
POLITE_OUT_OF_CURRICULUM_MESSAGE = (
    "Great question. I am focused on Ethiopian curriculum topics for your grade, "
    "so I cannot answer that directly. Please ask a Biology, Chemistry, Physics, or Math question from your textbook, "
    "and I will help right away."
)
POLITE_INSUFFICIENT_INFO_MESSAGE = (
    "I want to help, but I could not find enough textbook information for that question at your grade level. "
    "Please rephrase it or ask a more specific textbook question."
)
POLITE_ABOVE_GRADE_LEVEL_MESSAGE = (
    "That topic is usually taught above your current grade. "
    "I can help with the same concept at your grade level if you want."
)
POLITE_GREETING_MESSAGE = (
    "Hi. I am ready to help with your selected subject from the Ethiopian curriculum. "
    "Ask me a specific textbook question and I will explain it clearly."
)

NUMBER_WORDS = {
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
}

STOP_WORDS = {
    "a",
    "an",
    "and",
    "are",
    "be",
    "by",
    "can",
    "define",
    "do",
    "does",
    "for",
    "from",
    "give",
    "grade",
    "how",
    "i",
    "in",
    "is",
    "it",
    "me",
    "of",
    "on",
    "or",
    "please",
    "show",
    "tell",
    "the",
    "this",
    "to",
    "using",
    "what",
    "when",
    "where",
    "which",
    "why",
    "with",
}

SUBJECT_COLLECTION_ALIASES = {
    "biology": ["biology"],
    "chemistry": ["chemistry"],
    "physics": ["physics"],
    "math": ["math", "mathematics"],
}

UNSUPPORTED_SUBJECT_KEYWORDS = {
    "history",
    "geography",
    "civics",
    "economics",
    "english",
    "amharic",
    "social studies",
    "citizenship",
}

LIST_NOUNS = [
    "rules",
    "steps",
    "types",
    "examples",
    "reasons",
    "causes",
    "functions",
    "characteristics",
    "uses",
    "precautions",
    "materials",
    "tools",
    "methods",
    "parts",
]

NOISE_PHRASES = [
    "activity",
    "classwork",
    "homework",
    "objectives",
    "learning competencies",
    "at the end of this section",
    "the student will be able to",
    "attention",
    "discuss in groups",
    "think-pair-share",
    "review questions",
    "write the parts of",
    "figure",
    "table",
    "sections learning competencies",
]

TEACHER_GUIDE_MARKERS = {
    "teacher guide",
    "teachers guide",
    "teacher's guide",
    "teacher manual",
    "instructor guide",
    "facilitator guide",
}

TEXTBOOK_MARKERS = {
    "textbook",
    "student book",
    "learner book",
    "coursebook",
}

SOURCE_METADATA_KEYS = (
    "source_type",
    "document_type",
    "doc_type",
    "material_type",
    "book_type",
    "category",
    "title",
    "book",
    "source",
    "filename",
    "file_name",
    "path",
)

client = None
embedding_func = None
available_collections_cache = None


class StudentProfile(BaseModel):
    full_name: str = "Grade 9 Student"
    grade: str = DEFAULT_GRADE
    performance_band: Literal["support", "low", "medium", "top"] = "medium"
    student_level: Optional[Literal["low", "medium", "top"]] = None
    mastery_score: int = 50
    preferred_language: str = "en"
    twin_name: str = "EduTwin"
    support_subjects: list[str] = Field(default_factory=list)
    strong_subjects: list[str] = Field(default_factory=list)


class ChatRequest(BaseModel):
    question: str
    grade: str = DEFAULT_GRADE
    subject: Optional[str] = None
    history: list[dict[str, str]] = Field(default_factory=list)
    student_profile: Optional[StudentProfile] = None


class QuizRequest(BaseModel):
    topic: str
    num_questions: int = 3


class PracticeRequest(BaseModel):
    subject: Optional[str] = None
    topic: str
    num_questions: int = 5
    types: list[str] = Field(default_factory=lambda: ["mcq", "true_false", "short"])
    grade: str = DEFAULT_GRADE
    student_profile: Optional[StudentProfile] = None


class TextbookAssistRequest(BaseModel):
    subject: str = "physics"
    grade: str = DEFAULT_GRADE
    chapter: Optional[str] = None
    unit: Optional[str] = None
    current_page: Optional[int] = None
    current_topic: Optional[str] = None
    current_passage: Optional[str] = None


class TextSelectionAskRequest(BaseModel):
    subject: str = "physics"
    grade: str = DEFAULT_GRADE
    chapter: Optional[str] = None
    unit: Optional[str] = None
    question: str
    selected_text: str
    history: list[dict[str, str]] = Field(default_factory=list)
    full_name: Optional[str] = None
    current_page: Optional[int] = None
    current_topic: Optional[str] = None
    support_subjects: Optional[list[str]] = None
    strong_subjects: Optional[list[str]] = None
    mastery_score: Optional[float] = None
    performance_band: Optional[str] = None


class TextbookResourcesRequest(BaseModel):
    subject: str = "physics"
    grade: str = DEFAULT_GRADE
    chapter: Optional[str] = None
    unit: Optional[str] = None


CANVAS_KEYS = ("canvas_url", "canvas_link", "model_url", "demo_url", "canvasModelLink")
AR_KEYS = ("ar_model_url", "ar_url", "figure_ar_url")
TEXTBOOK_URL_KEYS = ("textbook_url", "book_url", "pdf_url", "source_url")


def get_client():
    global client
    if client is None:
        client = chromadb.PersistentClient(path=DB_DIR)
    return client


def get_embedding_func():
    global embedding_func
    if embedding_func is None:
        embedding_func = embedding_functions.SentenceTransformerEmbeddingFunction(
            model_name=EMBED_MODEL
        )
    return embedding_func


def get_available_collection_names():
    global available_collections_cache
    if available_collections_cache is None:
        collections = get_client().list_collections()
        available_collections_cache = {getattr(item, "name", item) for item in collections}
    return available_collections_cache


def is_port_in_use(port: int):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def running_edutwin_status(port: int):
    try:
        with request.urlopen(f"http://127.0.0.1:{port}/", timeout=1) as response:
            payload = response.read().decode("utf-8", errors="ignore")
            return "EduTwin Brain is Active" in payload
    except (error.URLError, TimeoutError, OSError):
        return False


def get_listener_pid_windows(port: int):
    try:
        output = subprocess.check_output(
            ["netstat", "-ano", "-p", "tcp"],
            text=True,
            encoding="utf-8",
            errors="ignore",
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None

    port_suffix = f":{port}"
    for line in output.splitlines():
        parts = line.split()
        if len(parts) < 5:
            continue
        local_address = parts[1]
        state = parts[3].upper()
        pid_text = parts[4]
        if state == "LISTENING" and local_address.endswith(port_suffix) and pid_text.isdigit():
            return int(pid_text)
    return None


def stop_existing_edutwin_backend(port: int):
    if os.name != "nt":
        return False

    pid = get_listener_pid_windows(port)
    if not pid:
        return False

    try:
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/F"],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return True
    except subprocess.CalledProcessError:
        return False


def warm_model():
    try:
        ollama.chat(
            model=MODEL,
            messages=[{"role": "user", "content": "warmup"}],
            options={"num_predict": 1, "temperature": 0.0},
        )
    except Exception as warmup_error:
        print(f"Warmup failed: {warmup_error}")


def preload_backend_resources():
    try:
        get_client()
        get_available_collection_names()
        get_embedding_func()
    except Exception as preload_error:
        print(f"Resource preload failed: {preload_error}")
    warm_model()


@asynccontextmanager
async def lifespan(_: FastAPI):
    preload_backend_resources()
    yield


app = FastAPI(lifespan=lifespan)


def normalize_grade_value(raw_grade: str):
    digits = re.search(r"\d+", str(raw_grade))
    if digits:
        numeric_grade = int(digits.group(0))
        clamped = max(MIN_CURRICULUM_GRADE, min(numeric_grade, MAX_CURRICULUM_GRADE))
        return str(clamped)
    return DEFAULT_GRADE


def extract_requested_grade(text: str):
    if not text:
        return None
    lowered = text.lower()
    for word, value in NUMBER_WORDS.items():
        if MIN_CURRICULUM_GRADE <= value <= MAX_CURRICULUM_GRADE:
            if re.search(rf"\b(?:grade|class)\s*{re.escape(word)}\b", lowered):
                return str(value)

    patterns = [
        r"\bgrade\s*(\d{1,2})\b",
        r"\bclass\s*(\d{1,2})\b",
        r"\bg\s*(\d{1,2})\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, lowered)
        if not match:
            continue
        requested = int(match.group(1))
        if MIN_CURRICULUM_GRADE <= requested <= MAX_CURRICULUM_GRADE:
            return str(requested)
    return None


def resolve_student_profile(profile: Optional[StudentProfile], grade: str):
    if profile is None:
        profile = StudentProfile(grade=normalize_grade_value(grade))
        profile.student_level = resolve_student_level(profile)
        return profile
    profile.grade = normalize_grade_value(profile.grade or grade)
    profile.student_level = resolve_student_level(profile)
    return profile


def resolve_effective_grade(grade: str, profile: StudentProfile):
    profile.grade = normalize_grade_value(profile.grade or grade)
    return profile.grade


def resolve_student_level(profile: StudentProfile):
    raw_level = (profile.student_level or profile.performance_band or "medium").strip().lower()
    level_map = {
        "support": "low",
        "low": "low",
        "medium": "medium",
        "top": "top",
    }
    return level_map.get(raw_level, "medium")


def get_accessible_grades(grade: str):
    current_grade = int(normalize_grade_value(grade))
    return [str(value) for value in range(current_grade, MIN_CURRICULUM_GRADE - 1, -1)]


def get_higher_grades(grade: str):
    current_grade = int(normalize_grade_value(grade))
    return [str(value) for value in range(current_grade + 1, MAX_CURRICULUM_GRADE + 1)]


def normalize_subject_name(subject: Optional[str]):
    if not subject:
        return None
    lowered = subject.strip().lower()
    for canonical_subject, aliases in SUBJECT_COLLECTION_ALIASES.items():
        if lowered == canonical_subject or lowered in aliases:
            return canonical_subject
    return None


def metadata_page(metadata: dict):
    for key in ("page", "page_number", "page_no", "page_index", "pageIndex"):
        value = metadata.get(key)
        if value is None:
            continue
        if isinstance(value, int):
            return value
        match = re.search(r"\d+", str(value))
        if match:
            return int(match.group(0))
    return None


def first_non_empty(metadata: dict, keys: tuple[str, ...]):
    for key in keys:
        value = metadata.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def collection_rows(subject: str, grade: str, unit: Optional[str] = None):
    collections = get_client().list_collections()
    if not collections:
        return []

    name = getattr(collections[0], "name", collections[0])
    collection = get_client().get_collection(name)
    result = collection.get(include=["documents", "metadatas"])

    docs = result.get("documents") or []
    metas = result.get("metadatas") or []

    wanted_subject = normalize_grounded_answer(subject).lower()
    wanted_grade = normalize_grade_value(grade)
    wanted_unit = normalize_grounded_answer(unit).lower() if unit else ""

    rows = []
    for idx, doc in enumerate(docs):
        metadata = metas[idx] if idx < len(metas) and isinstance(metas[idx], dict) else {}
        row_subject = normalize_grounded_answer(str(metadata.get("subject", ""))).lower()
        row_grade = normalize_grade_value(str(metadata.get("grade", wanted_grade)))
        row_unit = normalize_grounded_answer(str(metadata.get("unit", ""))).lower()

        if wanted_subject and row_subject and row_subject != wanted_subject:
            continue
        if wanted_grade and row_grade and row_grade != wanted_grade:
            continue
        if wanted_unit and row_unit and row_unit != wanted_unit:
            continue

        rows.append({"document": normalize_grounded_answer(str(doc or "")), "metadata": metadata})
    return rows


def rank_rows(query: str, rows: list[dict]):
    tokens = set(re.findall(r"[a-zA-Z0-9]{3,}", normalize_grounded_answer(query).lower()))
    if not tokens:
        return rows[:TOP_K]

    scored = []
    for row in rows:
        text_tokens = set(re.findall(r"[a-zA-Z0-9]{3,}", row["document"].lower()))
        score = len(tokens.intersection(text_tokens))
        scored.append((score, row))

    scored.sort(key=lambda item: item[0], reverse=True)
    ranked = [row for score, row in scored if score > 0]
    return (ranked or [row for _, row in scored])[:TOP_K]


def find_canvas_for_page(rows: list[dict], page: Optional[int]):
    if page is None or page <= 0:
        return {
            "show_canvas_suggestion": False,
            "topic": None,
            "canvas_link": None,
            "suggestion_text": None,
            "matched_page": page,
        }

    exact = []
    nearby = []
    for row in rows:
        row_page = metadata_page(row.get("metadata", {}))
        if row_page is None:
            continue
        if row_page == page:
            exact.append(row)
        elif abs(row_page - page) <= 1:
            nearby.append(row)

    for bucket in (exact, nearby):
        for row in bucket:
            link = first_non_empty(row.get("metadata", {}), CANVAS_KEYS)
            if link:
                row_page = metadata_page(row.get("metadata", {}))
                return {
                    "show_canvas_suggestion": True,
                    "topic": f"page {row_page}",
                    "canvas_link": link,
                    "suggestion_text": f"Do you want to see the canvas model for page {row_page}?",
                    "matched_page": row_page,
                }

    return {
        "show_canvas_suggestion": False,
        "topic": None,
        "canvas_link": None,
        "suggestion_text": None,
        "matched_page": page,
    }


def find_ar_for_page(rows: list[dict], page: Optional[int]):
    if page is None or page <= 0:
        return {
            "show_ar_suggestion": False,
            "ar_model_url": None,
            "ar_suggestion_text": None,
        }

    for row in rows:
        row_page = metadata_page(row.get("metadata", {}))
        if row_page != page:
            continue
        ar_link = first_non_empty(row.get("metadata", {}), AR_KEYS)
        if ar_link:
            return {
                "show_ar_suggestion": True,
                "ar_model_url": ar_link,
                "ar_suggestion_text": f"Tap the figure on page {page} to open AR model.",
            }

    return {
        "show_ar_suggestion": False,
        "ar_model_url": None,
        "ar_suggestion_text": None,
    }


def extract_textbook_resources(rows: list[dict]):
    resources = []
    seen = set()

    for row in rows:
        metadata = row.get("metadata", {}) if isinstance(row, dict) else {}
        page = metadata_page(metadata)
        chapter = first_non_empty(metadata, ("chapter", "chapter_name", "unit")) or "General"
        topic = first_non_empty(metadata, ("topic", "subtopic", "section", "title")) or (
            f"Page {page}" if page else "General"
        )

        canvas_link = first_non_empty(metadata, CANVAS_KEYS)
        ar_link = first_non_empty(metadata, AR_KEYS)

        if canvas_link:
            key = ("canvas", canvas_link)
            if key not in seen:
                seen.add(key)
                resources.append(
                    {
                        "id": f"canvas-{len(resources) + 1}",
                        "chapter": str(chapter),
                        "topic": str(topic),
                        "title": f"{topic} Canvas Model",
                        "type": "canvas",
                        "url": canvas_link,
                        "page": page,
                    }
                )

        if ar_link:
            key = ("ar", ar_link)
            if key not in seen:
                seen.add(key)
                resources.append(
                    {
                        "id": f"ar-{len(resources) + 1}",
                        "chapter": str(chapter),
                        "topic": str(topic),
                        "title": f"{topic} AR Model",
                        "type": "ar",
                        "url": ar_link,
                        "page": page,
                    }
                )

    resources.sort(key=lambda item: (item.get("chapter", ""), item.get("topic", ""), item.get("type", "")))
    return resources


def detect_subject(text: str):
    if not text:
        return None
    lowered = text.lower()
    for subject, aliases in SUBJECT_COLLECTION_ALIASES.items():
        for alias in aliases:
            if re.search(rf"\b{re.escape(alias)}\b", lowered):
                return subject
    return None


def mentions_unsupported_subject(text: str):
    if not text:
        return False
    if detect_subject(text):
        return False

    lowered = normalize_match_text(text)
    for keyword in UNSUPPORTED_SUBJECT_KEYWORDS:
        normalized_keyword = normalize_match_text(keyword)
        if not normalized_keyword:
            continue
        if " " in normalized_keyword:
            if normalized_keyword in lowered:
                return True
            continue
        if re.search(rf"\b{re.escape(normalized_keyword)}\b", lowered):
            return True
    return False


def extract_query_keywords(text: str):
    tokens = re.findall(r"[a-zA-Z]{3,}", text.lower())
    return {token for token in tokens if token not in STOP_WORDS}


def normalize_grounded_answer(text: str):
    text = (
        text.replace("â€™", "'")
        .replace("â€˜", "'")
        .replace("â€œ", '"')
        .replace("â€", '"')
        .replace("â€¢", "-")
        .replace("•", "-")
        .replace("Don’t", "Don't")
        .replace("It’s", "It's")
    )
    cleaned = re.sub(r"\s+", " ", text).strip()
    cleaned = re.sub(r"\s+([.,;:!?])", r"\1", cleaned)
    return cleaned


def normalize_match_text(text: str):
    cleaned = re.sub(r"[^a-z0-9 ]", " ", normalize_grounded_answer(text).lower())
    return re.sub(r"\s+", " ", cleaned).strip()


def strip_section_noise(text: str):
    cleaned = normalize_grounded_answer(text)
    cleaned = re.sub(r"\b\d+\.\d+(?:\.\d+)?\b", " ", cleaned)
    cleaned = re.sub(r"\b(?:figure|table)\s+\d+(?:\.\d+)?\b", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def is_noise_sentence(sentence: str):
    lowered = normalize_match_text(sentence)
    return any(phrase in lowered for phrase in NOISE_PHRASES)


def split_into_sentences(text: str):
    normalized = strip_section_noise(text)
    if not normalized:
        return []
    parts = re.split(r"(?<=[.!?])\s+", normalized)
    return [part.strip() for part in parts if part.strip()]


def split_context_clauses(text: str):
    normalized = strip_section_noise(text)
    if not normalized:
        return []
    raw_parts = re.split(
        r"(?<=[.!?])\s+|(?=\b[A-Z][A-Za-z-]*(?: [A-Z][A-Za-z-]*){0,4}:\s)",
        normalized,
    )
    clauses = []
    for part in raw_parts:
        cleaned = part.strip(" .")
        if len(cleaned) < 12:
            continue
        if is_noise_sentence(cleaned):
            continue
        if not cleaned.endswith((".", "!", "?")):
            cleaned = f"{cleaned}."
        clauses.append(cleaned)
    return clauses


def get_clean_sentences(context_text: str):
    sentences = split_into_sentences(context_text)
    filtered = [sentence for sentence in sentences if not is_noise_sentence(sentence)]
    return filtered or sentences


def sentence_overlap_score(sentence: str, query_keywords: set[str]):
    lowered_sentence = normalize_match_text(sentence)
    overlap = {keyword for keyword in query_keywords if keyword in lowered_sentence}
    return len(overlap), len(sentence)


def select_relevant_sentences(query: str, context_text: str, subject: str, limit: int = MAX_CONTEXT_SENTENCES):
    query_keywords = extract_query_keywords(query)
    query_keywords.update(extract_query_keywords(subject))
    sentences = get_clean_sentences(context_text)
    if not sentences:
        return []

    ranked = []
    for sentence in sentences:
        overlap_count, sentence_length = sentence_overlap_score(sentence, query_keywords)
        if overlap_count > 0:
            ranked.append((overlap_count, sentence_length, sentence))

    if not ranked:
        return sentences[:limit]

    ranked.sort(key=lambda item: (-item[0], item[1]))
    return [sentence for _, _, sentence in ranked[:limit]]


def select_relevant_sentences_in_order(query: str, context_text: str, subject: str, limit: int = MAX_CONTEXT_SENTENCES):
    selected = select_relevant_sentences(query, context_text, subject, limit)
    if not selected:
        return []

    positions = {sentence: index for index, sentence in enumerate(get_clean_sentences(context_text))}
    return sorted(selected, key=lambda sentence: positions.get(sentence, 10**9))


def is_definition_question(question: str):
    lowered = question.lower().strip()
    patterns = [
        r"^what is\b",
        r"^what are\b",
        r"^define\b",
        r"^meaning of\b",
        r"^give the definition of\b",
    ]
    return any(re.search(pattern, lowered) for pattern in patterns)


def extract_requested_item_count(question: str):
    lowered = question.lower()
    digit_match = re.search(r"\b(\d{1,2})\b", lowered)
    if digit_match:
        return int(digit_match.group(1))
    for word, value in NUMBER_WORDS.items():
        if re.search(rf"\b{word}\b", lowered):
            return value
    return None


def strip_requested_count(text: str):
    stripped = re.sub(
        r"^\s*(?:\d{1,2}|" + "|".join(NUMBER_WORDS.keys()) + r")\s+",
        "",
        text.strip(),
        flags=re.IGNORECASE,
    )
    return re.sub(r"\s+", " ", stripped).strip()


def detect_list_noun(text: str):
    lowered = text.lower().strip()
    for noun in LIST_NOUNS:
        if re.search(rf"\b{re.escape(noun)}\b", lowered):
            return noun
    return None


def strip_list_noun(text: str, list_noun: Optional[str]):
    cleaned = strip_requested_count(text)
    if not list_noun:
        return cleaned

    patterns = [
        rf"^the\s+{re.escape(list_noun)}\s+of\s+",
        rf"^{re.escape(list_noun)}\s+of\s+",
        rf"^the\s+{re.escape(list_noun)}\s+for\s+",
        rf"^{re.escape(list_noun)}\s+for\s+",
        r"^the\s+",
    ]
    normalized = cleaned.strip()
    for pattern in patterns:
        normalized = re.sub(pattern, "", normalized, flags=re.IGNORECASE)

    trailing_patterns = [
        rf"\b{re.escape(list_noun)}\b$",
        rf"\b{re.escape(list_noun)}\s+list\b$",
    ]
    for pattern in trailing_patterns:
        normalized = re.sub(pattern, "", normalized, flags=re.IGNORECASE)

    return re.sub(r"\s+", " ", normalized).strip(" -")


def is_list_question(question: str):
    lowered = question.lower().strip()
    list_verbs = ["list", "name", "mention", "give", "what are", "tell me", "describe"]
    has_list_verb = any(lowered.startswith(item) for item in list_verbs)
    has_list_noun = detect_list_noun(question) is not None
    return has_list_noun and (has_list_verb or extract_requested_item_count(question) is not None)


def is_parts_function_question(question: str):
    lowered = question.lower().strip()
    return any(marker in lowered for marker in ["parts", "part of", "function", "functionality"])


def is_explanation_question(question: str):
    lowered = question.lower().strip()
    starters = ["explain", "describe", "tell me about", "discuss", "compare", "how does", "how do"]
    return any(lowered.startswith(starter) for starter in starters)


def is_simple_topic_teaching_question(question: str):
    if is_list_question(question) or is_parts_function_question(question):
        return False
    return is_definition_question(question) or is_explanation_question(question)


def extract_definition_target(question: str):
    lowered = question.lower().strip().rstrip("?.!")
    patterns = [
        r"^what is\s+(?:a|an|the)?\s*(.+)$",
        r"^what are\s+(?:the)?\s*(.+)$",
        r"^define\s+(.+)$",
        r"^meaning of\s+(.+)$",
        r"^give the definition of\s+(.+)$",
    ]
    for pattern in patterns:
        match = re.search(pattern, lowered)
        if match:
            return re.sub(r"\s+", " ", match.group(1)).strip()
    return None


def extract_topic_target(question: str):
    definition_target = extract_definition_target(question)
    if definition_target:
        return definition_target

    lowered = question.lower().strip().rstrip("?.!")
    patterns = [
        r"^(?:explain|describe|tell me about)\s+(.+)$",
        r"^function(?:ality)? of\s+(.+)$",
        r"^parts? of\s+(.+)$",
        r"^what are\s+(.+)$",
    ]
    for pattern in patterns:
        match = re.search(pattern, lowered)
        if match:
            return re.sub(r"\s+", " ", match.group(1)).strip()
    return None


def build_list_retrieval_queries(question: str, topic_target: str):
    list_noun = detect_list_noun(question) or detect_list_noun(topic_target)
    stripped_topic = strip_requested_count(topic_target)
    focus_topic = strip_list_noun(stripped_topic or topic_target, list_noun)

    variants = []
    for candidate in [topic_target, stripped_topic, focus_topic]:
        cleaned = re.sub(r"\s+", " ", (candidate or "")).strip()
        if cleaned:
            variants.append(cleaned)

    if list_noun and focus_topic:
        variants.extend(
            [
                f"{list_noun} of {focus_topic}",
                f"{focus_topic} {list_noun}",
                f"general {focus_topic} {list_noun}",
                f"{focus_topic} {list_noun} list",
            ]
        )
    elif list_noun:
        variants.extend([f"general {list_noun}", f"{list_noun} list"])

    unique_variants = []
    seen = set()
    for item in variants:
        normalized = re.sub(r"\s+", " ", item).strip().lower()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        unique_variants.append(item.strip())
    return unique_variants


def build_retrieval_queries(question: str, subject: str):
    queries = [question.strip()]
    topic_target = extract_topic_target(question)
    if topic_target:
        queries.append(topic_target)

        stripped_topic = strip_requested_count(topic_target)
        if stripped_topic and stripped_topic.lower() != topic_target.lower():
            queries.append(stripped_topic)

        lowered = question.lower()
        if is_parts_function_question(question):
            queries.extend(
                [
                    f"parts of {topic_target}",
                    f"functions of {topic_target}",
                    f"{topic_target} parts",
                    f"{topic_target} function",
                ]
            )
        if is_list_question(question):
            queries.extend(build_list_retrieval_queries(question, topic_target))

    if subject and subject not in question.lower():
        queries.append(f"{subject} {question.strip()}")

    unique_queries = []
    seen = set()
    for item in queries:
        normalized = re.sub(r"\s+", " ", item).strip().lower()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        unique_queries.append(item.strip())
    return unique_queries


def is_retrieved_context_relevant(query: str, documents: list[str], subject: str):
    query_keywords = extract_query_keywords(query)
    if not query_keywords:
        return True
    document_text = normalize_match_text(" ".join(documents))
    overlap = {keyword for keyword in query_keywords if keyword in document_text}
    return len(overlap) >= MIN_KEYWORD_OVERLAP


def normalize_meta_blob(metadata: Optional[dict]):
    if not isinstance(metadata, dict):
        return ""
    values = []
    for key in SOURCE_METADATA_KEYS:
        value = metadata.get(key)
        if value is not None:
            values.append(str(value).lower())
    return " ".join(values)


def metadata_text(metadata: Optional[dict], keys: tuple[str, ...]):
    if not isinstance(metadata, dict):
        return ""
    values = []
    for key in keys:
        value = metadata.get(key)
        if value is not None:
            values.append(str(value).lower())
    return " ".join(values)


def row_matches_subject_grade(row: dict, subject: str, grade: str):
    metadata = row.get("metadata") if isinstance(row, dict) else {}
    blob = normalize_meta_blob(metadata)
    subject_blob = metadata_text(metadata, ("subject", "course", "topic", "book", "title", "source"))
    grade_blob = metadata_text(metadata, ("grade", "class", "level", "book", "title", "source"))

    subject_token = subject.strip().lower()
    grade_token = str(grade).strip().lower()

    subject_ok = subject_token in blob or subject_token in subject_blob
    grade_ok = (
        re.search(rf"\b{re.escape(grade_token)}\b", blob) is not None
        or re.search(rf"\b{re.escape(grade_token)}\b", grade_blob) is not None
        or re.search(rf"\bgrade\s*{re.escape(grade_token)}\b", grade_blob) is not None
        or re.search(rf"\bg\s*{re.escape(grade_token)}\b", grade_blob) is not None
    )
    return subject_ok and grade_ok


def classify_chunk_source(document: str, metadata: Optional[dict]):
    meta_blob = normalize_meta_blob(metadata)
    if any(marker in meta_blob for marker in TEACHER_GUIDE_MARKERS):
        return "teacher_guide"
    if any(marker in meta_blob for marker in TEXTBOOK_MARKERS):
        return "textbook"

    lowered_doc = normalize_match_text(document)
    if lowered_doc.startswith("teacher guide") or " teacher guide " in f" {lowered_doc} ":
        return "teacher_guide"
    return "textbook"


def dedupe_documents(scored_rows: list[dict]):
    deduped = []
    seen = set()
    for row in scored_rows:
        doc = normalize_grounded_answer(row.get("document", ""))
        if not doc:
            continue
        key = normalize_match_text(doc)
        if key in seen:
            continue
        seen.add(key)
        deduped.append({"document": doc, "metadata": row.get("metadata") or {}, "distance": row.get("distance", 9999.0)})
    return deduped


def query_ranked_chunks(collection, queries: list[str], where_filter: Optional[dict], n_results: int):
    ranked = []
    for item in queries:
        try:
            results = collection.query(
                query_texts=[item],
                n_results=n_results,
                where=where_filter,
                include=["documents", "metadatas", "distances"],
            )
        except Exception:
            continue

        docs = (results.get("documents") or [[]])[0]
        metadatas = (results.get("metadatas") or [[]])[0]
        distances = (results.get("distances") or [[]])[0]
        for index, doc in enumerate(docs):
            ranked.append(
                {
                    "document": doc,
                    "metadata": metadatas[index] if index < len(metadatas) else {},
                    "distance": distances[index] if index < len(distances) else 9999.0,
                }
            )

    ranked.sort(key=lambda row: row.get("distance", 9999.0))
    return dedupe_documents(ranked)


def fetch_textbook_context(query: str, grade: str, subject: str):
    print(f"Searching ChromaDB for {subject} Grade {grade}...")

    db_client = get_client()
    collections = db_client.list_collections()

    if not collections:
        return None, "Error: The database is completely empty. No collections found."

    # Grab the first (and only) master collection.
    master_collection_name = getattr(collections[0], "name", collections[0])

    try:
        # Reuse the embedding function persisted with the collection to avoid
        # conflicts when legacy/default collections already exist.
        collection = db_client.get_collection(master_collection_name)

        retrieval_queries = build_retrieval_queries(query, subject)
        subject_candidates = []
        for candidate in [subject.capitalize(), subject.title(), subject.lower(), subject.upper(), subject]:
            if candidate not in subject_candidates:
                subject_candidates.append(candidate)

        where_filters = [
            {
                "$and": [
                    {"subject": {"$eq": candidate}},
                    {"grade": {"$eq": str(grade)}},
                ]
            }
            for candidate in subject_candidates
        ]
        where_filters.append({"grade": {"$eq": str(grade)}})

        ranked_rows = []
        for where_filter in where_filters:
            ranked_rows = query_ranked_chunks(
                collection,
                retrieval_queries,
                where_filter,
                n_results=max(TOP_K + TEACHER_GUIDE_TOP_K, TOP_K),
            )
            if ranked_rows:
                break

        if not ranked_rows:
            broad_rows = query_ranked_chunks(
                collection,
                retrieval_queries,
                where_filter=None,
                n_results=max((TOP_K + TEACHER_GUIDE_TOP_K) * 4, 24),
            )

            strict_meta_match = [
                row for row in broad_rows if row_matches_subject_grade(row, subject, str(grade))
            ]
            ranked_rows = strict_meta_match

        if not ranked_rows:
            return None, INSUFFICIENT_CURRICULUM_INFO_MESSAGE

        textbook_docs = []
        teacher_guide_docs = []
        for row in ranked_rows:
            source_kind = classify_chunk_source(row["document"], row.get("metadata"))
            if source_kind == "teacher_guide" and len(teacher_guide_docs) < TEACHER_GUIDE_TOP_K:
                teacher_guide_docs.append(row["document"])
            elif len(textbook_docs) < TOP_K:
                textbook_docs.append(row["document"])

            if len(textbook_docs) >= TOP_K and len(teacher_guide_docs) >= TEACHER_GUIDE_TOP_K:
                break

        if not textbook_docs and not teacher_guide_docs:
            return None, INSUFFICIENT_CURRICULUM_INFO_MESSAGE

        primary_context = "\n\n".join(textbook_docs)
        guide_context = "\n\n".join(teacher_guide_docs)
        combined_sections = []
        if primary_context:
            combined_sections.append(f"Textbook excerpts:\n{primary_context}")
        if guide_context:
            combined_sections.append(f"Teacher guide excerpts:\n{guide_context}")

        return {
            "context_text": "\n\n".join(combined_sections),
            "textbook_context_text": primary_context,
            "teacher_guide_context_text": guide_context,
            "source_grade": str(grade),
        }, None

    except Exception as db_error:
        print(f"DB Error: {db_error}")
        return None, f"Error querying the textbook database: {db_error}"


def normalize_history(history: list[dict[str, str]]):
    normalized = []
    for item in history[-MAX_CHAT_HISTORY_ITEMS:]:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role", "")).strip().lower()
        content = str(item.get("content", "")).strip()
        if role not in {"user", "assistant"} or not content:
            continue
        normalized.append({"role": role, "content": content})
    return normalized


def is_follow_up_question(text: str):
    lowered = re.sub(r"\s+", " ", text.lower()).strip()
    follow_up_phrases = [
        "explain more",
        "tell me more",
        "more detail",
        "give example",
        "another example",
        "what about",
        "how about",
        "why is that",
        "can you simplify",
        "simplify that",
    ]
    if any(phrase in lowered for phrase in follow_up_phrases):
        return True
    vague_questions = {"why", "how", "explain", "explain it", "what next", "more"}
    if lowered in vague_questions:
        return True
    tokens = re.findall(r"[a-zA-Z]+", lowered)
    vague_tokens = {"it", "this", "that", "they", "them", "these", "those"}
    return len(tokens) <= 6 and any(token in vague_tokens for token in tokens)


def is_greeting_message(text: str):
    lowered = re.sub(r"\s+", " ", text.lower()).strip(" .,!?")
    if not lowered:
        return False
    greetings = {
        "hi",
        "hey",
        "hello",
        "selam",
        "good morning",
        "good afternoon",
        "good evening",
        "how are you",
    }
    if lowered in greetings:
        return True
    return len(lowered.split()) <= 3 and any(
        lowered.startswith(item) for item in ["hi", "hey", "hello"]
    )


def resolve_question_with_history(question: str, history: list[dict[str, str]]):
    trimmed_question = question.strip()
    normalized_history = normalize_history(history)
    if not normalized_history or not is_follow_up_question(trimmed_question):
        return trimmed_question, normalized_history

    last_user = next((item["content"] for item in reversed(normalized_history) if item["role"] == "user"), "")
    last_assistant = next((item["content"] for item in reversed(normalized_history) if item["role"] == "assistant"), "")
    if not last_user and not last_assistant:
        return trimmed_question, normalized_history

    expanded_parts = [f"Current follow-up question: {trimmed_question}"]
    if last_user:
        expanded_parts.append(f"Previous student question: {last_user}")
    if last_assistant:
        expanded_parts.append(f"Previous tutor answer: {last_assistant}")
    expanded_parts.append("Explain the same textbook topic more clearly.")
    return "\n".join(expanded_parts), normalized_history


def get_supported_subjects_for_grade(grade: str):
    return list(SUBJECT_COLLECTION_ALIASES.keys())


def resolve_chat_subject(question: str, grade: str, selected_subject: Optional[str] = None):
    if mentions_unsupported_subject(question):
        return None, CURRICULUM_SCOPE_MESSAGE

    normalized_subject = normalize_subject_name(selected_subject)
    if normalized_subject:
        return normalized_subject, None

    detected_subject = detect_subject(question)
    if detected_subject:
        return detected_subject, None

    supported_subjects = get_supported_subjects_for_grade(grade)
    if len(supported_subjects) == 1 and is_follow_up_question(question):
        return supported_subjects[0], None

    return None, "Please mention the textbook subject clearly, such as Biology, Chemistry, Physics, or Math."


def build_profile_instruction(profile: StudentProfile, subject: str):
    level = resolve_student_level(profile)
    level_instruction = {
        "low": "Use very simple English, short sentences, slow explanation, and real-life analogies that stay grounded in the textbook context.",
        "medium": "Use a balanced explanation with clear steps and moderate examples from the textbook context.",
        "top": "Use deeper reasoning, more detail, and stronger connections between textbook ideas without adding outside knowledge.",
    }[level]

    support_focus = (
        "This subject is a support area for the student, so scaffold the explanation carefully."
        if subject in profile.support_subjects
        else f"Keep the explanation aligned to Grade {profile.grade} textbook language."
    )

    return f"""
    Student name: {profile.full_name}
    Grade: {profile.grade}
    Twin name: {profile.twin_name}
    Mastery score: {profile.mastery_score}
    Preferred language: {profile.preferred_language}
    Student level: {level}
    Teaching style: {level_instruction}
    Teaching focus: {support_focus}
    """


def strip_heading_markup(text: str):
    cleaned = re.sub(r"\*\*[^*]+:\*\*", "", text)
    return re.sub(r"\s+", " ", cleaned).strip()


def extract_content_lines(text: str):
    lines = []
    for raw_line in text.splitlines():
        stripped = raw_line.strip()
        if not stripped:
            continue
        if re.match(r"^\d+\.\s+", stripped):
            lines.append(normalize_grounded_answer(stripped))
            continue
        for sentence in split_into_sentences(stripped) or [stripped]:
            normalized = normalize_grounded_answer(sentence)
            if normalized:
                lines.append(normalized)
    return lines


def shorten_line(text: str, max_words: int):
    cleaned = normalize_grounded_answer(text).strip(" -")
    words = cleaned.split()
    if len(words) <= max_words:
        return cleaned if cleaned.endswith((".", "!", "?")) else f"{cleaned}."
    shortened = " ".join(words[:max_words]).rstrip(",;:")
    return f"{shortened}."


def build_textbook_example(question: str, context_text: str, subject: str):
    example_markers = ["for example", "for instance", "such as", "example"]
    for sentence in select_relevant_sentences_in_order(question, context_text, subject, limit=6):
        lowered = normalize_match_text(sentence)
        if any(marker in lowered for marker in example_markers):
            return normalize_grounded_answer(sentence)

    selected = select_relevant_sentences_in_order(question, context_text, subject, limit=3)
    if selected:
        fallback_sentence = normalize_grounded_answer(selected[0])
        if is_list_question(question):
            return f"One textbook point is: {fallback_sentence}"
        return f"From the textbook context, one example is: {fallback_sentence}"
    return "Use the textbook explanation above as your example."


def build_summary_lines(explanation_text: str, question: str):
    explanation_lines = [
        line for line in extract_content_lines(strip_heading_markup(explanation_text))
        if not re.match(r"^\d+\.\s+", line)
    ]
    if explanation_lines:
        return [
            shorten_line(explanation_lines[0], 16),
            shorten_line(explanation_lines[min(1, len(explanation_lines) - 1)], 16),
        ]

    topic_target = strip_requested_count(extract_topic_target(question) or "this topic")
    return [
        f"The textbook answer is about {topic_target}.",
        "Review the main idea and key details from the explanation.",
    ]


def build_practice_question(question: str, profile: StudentProfile):
    level = resolve_student_level(profile)
    topic_target = strip_requested_count(extract_topic_target(question) or "this topic")
    list_noun = detect_list_noun(question)
    if is_list_question(question) and list_noun:
        if level == "low":
            return f"Can you write any two {list_noun} about {topic_target}?"
        if level == "top":
            return f"Choose three {list_noun} about {topic_target} and explain why each one matters."
        return f"Can you list three {list_noun} about {topic_target} from the textbook?"
    if is_parts_function_question(question):
        if level == "low":
            return f"Choose one part of {topic_target} and tell its function."
        if level == "top":
            return f"Explain one part of {topic_target} and connect its function to the whole system."
        return f"Choose one part of {topic_target} and explain its function."
    if level == "low":
        return f"What is {topic_target}?"
    if level == "top":
        return f"Explain {topic_target} and connect it to another idea from the same textbook topic."
    return f"Explain {topic_target} in your own words."


def adapt_explanation_for_level(explanation_text: str, context_text: str, question: str, subject: str, profile: StudentProfile):
    level = resolve_student_level(profile)
    if is_list_question(question):
        return explanation_text

    line_limit = {"low": 2, "medium": 3, "top": 4}[level]
    lines = extract_content_lines(strip_heading_markup(explanation_text))
    if level == "top":
        extra_lines = select_relevant_sentences_in_order(question, context_text, subject, limit=5)
        for sentence in extra_lines:
            normalized = normalize_grounded_answer(sentence)
            if normalized and normalized not in lines:
                lines.append(normalized)

    selected = []
    seen = set()
    for line in lines:
        normalized = normalize_grounded_answer(line)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        if level == "low":
            selected.append(shorten_line(normalized, 18))
        else:
            selected.append(normalized)
        if len(selected) >= line_limit:
            break

    return "\n".join(selected) if selected else explanation_text


def format_structured_answer(question: str, explanation_text: str, context_text: str, subject: str, profile: StudentProfile):
    first_name = re.sub(r"\s+", " ", profile.full_name).strip().split()[0] if profile.full_name.strip() else "student"
    example_text = build_textbook_example(question, context_text, subject)
    summary_lines = build_summary_lines(explanation_text, question)
    practice_question = build_practice_question(question, profile)
    explanation_body = adapt_explanation_for_level(explanation_text, context_text, question, subject, profile)
    summary_body = "\n".join([f"- {line}" for line in summary_lines[:2]])

    return "\n\n".join(
        [
            f"Hey {first_name}, let me explain.",
            f"**Explanation:**\n{explanation_body}",
            f"**Example:**\n{example_text}",
            f"**Summary:**\n{summary_body}",
            f"**Practice Question:**\n{practice_question}",
        ]
    )


def build_tutor_messages(
    question: str,
    context_text: str,
    profile: StudentProfile,
    subject: str,
    source_grade: str,
    history: list[dict[str, str]],
    teacher_guide_context: str = "",
):
    first_name = re.sub(r"\s+", " ", profile.full_name).strip().split()[0] if profile.full_name.strip() else "student"

    system_prompt = f"""You are EduTwin, a friendly, encouraging, and highly effective tutor for Ethiopian Grade {profile.grade} students.

YOUR PERSONA & TEACHING STYLE:
1. Be welcoming! Always start your response with a friendly greeting, such as "Hey {first_name}, let me explain this to you."
2. Use very simple, clear English that a Grade 9 student can easily understand. Short sentences are best.
3. Act like a helpful teacher. Use the provided Teacher Guide context to help you explain the Textbook facts simply, clearly, and engagingly.

CRITICAL SECURITY INSTRUCTIONS YOU MUST OBEY:
1. STRICT BOUNDARIES: You must base your factual answers ONLY on the "TEXTBOOK CONTEXT" below. 
2. NO GENERAL KNOWLEDGE: If the student's question asks about something not explicitly detailed in the context below (like higher grade topics or random facts), refuse politely and ask the student to ask a curriculum-aligned textbook question.
3. NO AMHARIC: You are FORBIDDEN from using Amharic script or translating. English only.

Student Guidance:
{build_profile_instruction(profile, subject)}

TEXTBOOK & TEACHER GUIDE CONTEXT:
{context_text}
{teacher_guide_context}
"""

    injected_question = (
        f"Student Question: {question.strip()}\n\n"
        "[SYSTEM REMINDER: Be warm and simple. Use only the provided textbook context. "
        "If the answer is not supported by context, reply politely and ask the student to rephrase or ask a curriculum-aligned question. "
        "Do not invent facts. No Amharic.]"
    )

    history_messages = []
    for item in history:
        role = item.get("role")
        content = str(item.get("content", "")).strip()
        if role in {"user", "assistant"} and content:
            history_messages.append({"role": role, "content": content})

    return [
        {"role": "system", "content": system_prompt},
        *history_messages,
        {"role": "user", "content": injected_question},
    ]


def sanitize_tutor_response(raw_text: str, question: str):
    cleaned = raw_text.strip()
    leak_markers = [
        "STUDENT PROFILE:",
        "TEACHING STYLE:",
        "TEXTBOOK CONTEXT:",
        "TEACHER GUIDE CONTEXT:",
        "TASK:",
        "STUDENT QUESTION:",
    ]
    marker_positions = [cleaned.rfind(marker) for marker in leak_markers if cleaned.rfind(marker) != -1]
    if marker_positions:
        cleaned = cleaned[max(marker_positions):].strip()
        if ":" in cleaned:
            cleaned = cleaned.split(":", 1)[1].strip()

    lines = [line.strip() for line in cleaned.splitlines()]
    while lines and not lines[0]:
        lines.pop(0)

    lowered_question = question.strip().lower()
    while lines and lines[0].strip('"').lower() == lowered_question:
        lines.pop(0)

    cleaned = "\n".join(line for line in lines if line).strip()
    for marker in leak_markers:
        cleaned = cleaned.replace(marker, "")
    cleaned = re.sub(r"^(Answer|Response|Final Answer)\s*:\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^(Here is the answer|Student-facing answer)\s*:\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    return cleaned or "I could not generate a clean textbook-based answer right now."


def sanitize_selection_response(raw_text: str):
    cleaned = normalize_grounded_answer(raw_text or "")
    if not cleaned:
        return "I could not generate a clear answer from the selected text."

    cleaned = re.sub(r"\*+", "", cleaned)
    cleaned = re.sub(r"#+", "", cleaned)

    # Drop common structured tails that appear in tutor-mode output.
    cleaned = re.split(
        r"\b(?:Example|Examples|Summary|Practice\s*Question|Activity(?:\s*\d+)?)\s*:",
        cleaned,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0].strip()

    # Remove greeting with student name from the start (e.g., "Hey Abel, ...").
    cleaned = re.sub(
        r"^(?:hey|hello|hi)\s+[a-zA-Z][a-zA-Z'\- ]{0,30}[,.!?]\s*",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )

    # Normalize markdown-like list prefixes.
    cleaned = re.sub(r"(?:^|\s)[\-•]+\s*", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned or "I could not generate a clear answer from the selected text."


def is_selection_direct_answer_request(question: str):
    lowered = normalize_match_text(question)
    direct_markers = [
        "answer this question",
        "final answer",
        "choose the correct",
        "which option",
        "mcq",
        "multiple choice",
        "true or false",
        "only answer",
    ]
    return any(marker in lowered for marker in direct_markers)


def is_generic_selection_prompt(question: str):
    lowered = normalize_match_text(question)
    generic_prompts = {
        "answer",
        "answer question",
        "answer the question",
        "solve",
        "solve this",
        "give answer",
        "give the answer",
        "only answer",
    }
    return lowered in generic_prompts


def add_student_intro(answer: str, profile: StudentProfile, question: str):
    cleaned_answer = normalize_grounded_answer(answer)
    if not cleaned_answer:
        return cleaned_answer
    if "**Explanation:**" in answer and "**Practice Question:**" in answer:
        return answer.strip()
    first_name = re.sub(r"\s+", " ", profile.full_name).strip().split()[0] if profile.full_name.strip() else "student"
    lowered_answer = cleaned_answer.lower()
    if lowered_answer.startswith(f"hey {first_name.lower()}") or lowered_answer.startswith(f"hello {first_name.lower()}"):
        return cleaned_answer
    if is_follow_up_question(question):
        intro = f"Hey {first_name}, let me explain that more."
    elif is_definition_question(question) or is_simple_topic_teaching_question(question):
        intro = f"Hey {first_name}, let me explain."
    else:
        intro = f"Hey {first_name}, let me answer that."
    return f"{intro} {cleaned_answer}"


def finalize_student_answer(answer: Optional[str], profile: StudentProfile, question: str):
    if not answer:
        return answer
    return add_student_intro(answer, profile, question)


def parse_json_object(raw_text: str):
    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", raw_text)
        if not match:
            raise ValueError("Model did not return valid JSON")
        return json.loads(match.group(0))


def normalize_questions(payload, num_questions: int, types: list[str]):
    allowed_types = {"mcq", "true_false", "short"}
    requested_types = {item for item in types if item in allowed_types} or allowed_types
    raw_questions = payload.get("questions") if isinstance(payload, dict) else []
    normalized = []

    for item in raw_questions or []:
        if not isinstance(item, dict):
            continue

        question_type = str(item.get("type", "mcq")).strip().lower().replace("-", "_")
        if question_type == "truefalse":
            question_type = "true_false"
        if question_type not in requested_types:
            continue

        question_text = str(item.get("question", "")).strip()
        answer = str(item.get("answer", "")).strip()
        explanation = str(item.get("explanation", "")).strip()
        options = item.get("options") or []
        if not question_text or not answer or not explanation:
            continue

        if question_type == "true_false":
            options = ["True", "False"]
        elif question_type == "short":
            options = []
        else:
            options = [str(option).strip() for option in options if str(option).strip()]
            if len(options) < 2:
                continue

        normalized.append(
            {
                "type": question_type,
                "question": question_text,
                "options": options,
                "answer": answer,
                "explanation": explanation,
            }
        )
        if len(normalized) >= num_questions:
            break

    return normalized


def ask_tutor_logic(question: str, grade: str, profile: StudentProfile, selected_subject: Optional[str] = None, history: Optional[list[dict[str, str]]] = None):
    effective_grade = resolve_effective_grade(grade, profile)
    resolved_question, normalized_history = resolve_question_with_history(question, history or [])

    if is_greeting_message(question):
        return POLITE_GREETING_MESSAGE

    requested_grade = extract_requested_grade(question)
    if requested_grade and requested_grade != effective_grade:
        if int(requested_grade) > int(effective_grade):
            return POLITE_ABOVE_GRADE_LEVEL_MESSAGE
        return POLITE_OUT_OF_CURRICULUM_MESSAGE

    subject, subject_error = resolve_chat_subject(resolved_question, effective_grade, selected_subject)

    if subject_error:
        return POLITE_OUT_OF_CURRICULUM_MESSAGE if selected_subject is None else subject_error

    retrieval_result, error_message = fetch_textbook_context(resolved_question, effective_grade, subject)
    if error_message:
        if error_message == INSUFFICIENT_CURRICULUM_INFO_MESSAGE:
            return POLITE_INSUFFICIENT_INFO_MESSAGE
        return error_message
    if not is_retrieved_context_relevant(
        resolved_question,
        [
            retrieval_result.get("textbook_context_text", ""),
            retrieval_result.get("teacher_guide_context_text", ""),
        ],
        subject,
    ):
        return POLITE_INSUFFICIENT_INFO_MESSAGE

    messages = build_tutor_messages(
        question=resolved_question,
        context_text=retrieval_result["context_text"],
        profile=profile,
        subject=subject,
        source_grade=retrieval_result["source_grade"],
        history=normalized_history,
        teacher_guide_context=retrieval_result.get("teacher_guide_context_text", ""),
    )

    try:
        response = ollama.chat(
            model=MODEL,
            messages=messages,
            options={"temperature": 0.0}
        )
        ai_raw_text = response["message"]["content"]
        clean_answer = sanitize_tutor_response(ai_raw_text, resolved_question)
        final_output = format_structured_answer(
            question=resolved_question,
            explanation_text=clean_answer,
            context_text=retrieval_result["context_text"],
            subject=subject,
            profile=profile,
        )
        return finalize_student_answer(final_output, profile, resolved_question)
    except Exception as e:
        return f"Error communicating with the AI Brain: {e}"


def stream_tutor_logic(question: str, grade: str, profile: StudentProfile, selected_subject: Optional[str] = None, history: Optional[list[dict[str, str]]] = None):
    effective_grade = resolve_effective_grade(grade, profile)
    resolved_question, normalized_history = resolve_question_with_history(question, history or [])

    if is_greeting_message(question):
        yield POLITE_GREETING_MESSAGE
        return

    requested_grade = extract_requested_grade(question)
    if requested_grade and requested_grade != effective_grade:
        if int(requested_grade) > int(effective_grade):
            yield POLITE_ABOVE_GRADE_LEVEL_MESSAGE
            return
        yield POLITE_OUT_OF_CURRICULUM_MESSAGE
        return

    subject, subject_error = resolve_chat_subject(resolved_question, effective_grade, selected_subject)

    if subject_error:
        yield POLITE_OUT_OF_CURRICULUM_MESSAGE if selected_subject is None else subject_error
        return

    retrieval_result, error_message = fetch_textbook_context(resolved_question, effective_grade, subject)
    if error_message:
        if error_message == INSUFFICIENT_CURRICULUM_INFO_MESSAGE:
            yield POLITE_INSUFFICIENT_INFO_MESSAGE
            return
        yield error_message
        return
    if not is_retrieved_context_relevant(
        resolved_question,
        [
            retrieval_result.get("textbook_context_text", ""),
            retrieval_result.get("teacher_guide_context_text", ""),
        ],
        subject,
    ):
        yield POLITE_INSUFFICIENT_INFO_MESSAGE
        return

    messages = build_tutor_messages(
        question=resolved_question,
        context_text=retrieval_result["context_text"],
        profile=profile,
        subject=subject,
        source_grade=retrieval_result["source_grade"],
        history=normalized_history,
        teacher_guide_context=retrieval_result.get("teacher_guide_context_text", ""),
    )

    try:
        for chunk in ollama.chat(
            model=MODEL,
            messages=messages,
            stream=True,
            options={"temperature": 0.0}
        ):
            if chunk and "message" in chunk and "content" in chunk["message"]:
                yield chunk["message"]["content"]
    except Exception as e:
        yield f"\n[Error communicating with the AI Brain: {e}]"


def generate_practice_logic(subject_name: Optional[str], topic: str, num_questions: int, types: list[str], grade: str, profile: StudentProfile):
    effective_grade = normalize_grade_value(profile.grade or grade)
    profile.grade = effective_grade
    subject = normalize_subject_name(subject_name) or detect_subject(subject_name or topic)
    if not subject:
        return {
            "error": "Choose a textbook subject for practice, such as Biology, Chemistry, Physics, or Math.",
            "questions": [],
        }

    query = topic.strip() or subject
    retrieval_result, error_message = fetch_textbook_context(query, effective_grade, subject)
    if error_message:
        return {"error": error_message, "questions": []}

    token_budget = min(MAX_PRACTICE_TOKENS, max(500, num_questions * PRACTICE_TOKENS_PER_QUESTION))
    prompt = f"""
    You are generating textbook-aligned practice for a Grade {profile.grade} student in the Ethiopian curriculum.
    Use only the textbook context below.
    Do not add greetings, commentary, markdown, or any text outside the JSON object.
    Do not include questions that are outside the topic.

    {build_profile_instruction(profile, subject)}

    TEXTBOOK CONTEXT:
    {retrieval_result['context_text']}

    TASK:
    - Generate exactly {num_questions} questions on this topic: {query}
    - Allowed question types: {', '.join(types)}
    - Match the difficulty to the student profile.
    - For MCQ, provide 4 options.
    - For true_false, use exactly ["True", "False"].
    - For short answers, use an empty options list.
    - Keep each explanation short and textbook-based.

    RETURN THIS JSON SHAPE ONLY:
    {{
      "questions": [
        {{
          "type": "mcq|true_false|short",
          "question": "...",
          "options": ["..."],
          "answer": "...",
          "explanation": "..."
        }}
      ]
    }}
    """

    try:
        response = ollama.chat(
            model=MODEL,
            messages=[{"role": "user", "content": prompt}],
            options={"num_predict": token_budget, "temperature": 0.1},
            format="json",
        )
        parsed = parse_json_object(response["message"]["content"].strip())
        normalized = normalize_questions(parsed, num_questions, types)
        return {
            "subject": subject,
            "grade": effective_grade,
            "questions": normalized,
            "error": None if normalized else "The model did not return valid textbook-aligned practice questions.",
        }
    except Exception as practice_error:
        return {"error": str(practice_error), "questions": []}


@app.get("/")
def home():
    return {"status": "EduTwin Brain is Active"}


@app.get("/textbook/info")
def textbook_info():
    rows = collection_rows("physics", DEFAULT_GRADE)
    textbook_url = None
    for row in rows:
        textbook_url = first_non_empty(row.get("metadata", {}), TEXTBOOK_URL_KEYS)
        if textbook_url:
            break

    return {
        "subject": "physics",
        "grade": DEFAULT_GRADE,
        "unit": None,
        "chapter": None,
        "textbook_url": textbook_url,
    }


@app.post("/textbook/resources")
def textbook_resources(req: TextbookResourcesRequest):
    normalized_subject = normalize_subject_name(req.subject) or "physics"
    normalized_grade = normalize_grade_value(req.grade)
    rows = collection_rows(normalized_subject, normalized_grade, req.unit)
    resources = extract_textbook_resources(rows)
    return {
        "subject": normalized_subject,
        "grade": normalized_grade,
        "resources": resources,
        "message": "Textbook resources fetched from database metadata.",
    }


@app.post("/textbook/assist")
def textbook_assist(req: TextbookAssistRequest):
    normalized_subject = normalize_subject_name(req.subject) or "physics"
    normalized_grade = normalize_grade_value(req.grade)
    rows = collection_rows(normalized_subject, normalized_grade, req.unit)
    canvas = find_canvas_for_page(rows, req.current_page)
    ar_hint = find_ar_for_page(rows, req.current_page)

    return {
        **canvas,
        **ar_hint,
        "current_page": req.current_page,
        "message": "Interactive hint generated.",
    }


@app.post("/textbook/selection-ask")
def textbook_selection_ask(req: TextSelectionAskRequest):
    selected_text = normalize_grounded_answer(req.selected_text)
    # Large highlighted passages can overflow model context and look like retrieval failure.
    selected_text_excerpt = selected_text[:1800] if selected_text else ""
    question = normalize_grounded_answer(req.question)
    subject = normalize_subject_name(req.subject) or "physics"
    grade = normalize_grade_value(req.grade)
    support_subjects = [
        normalize_subject_name(item) or normalize_grounded_answer(str(item)).lower()
        for item in (req.support_subjects or [])
        if str(item).strip()
    ]
    strong_subjects = [
        normalize_subject_name(item) or normalize_grounded_answer(str(item)).lower()
        for item in (req.strong_subjects or [])
        if str(item).strip()
    ]
    student_name = normalize_grounded_answer(req.full_name or "").strip()
    if student_name:
        student_name = student_name.split()[0]

    if not question:
        return {
            "response": "Please type a question about the selected text.",
            "selected_text": selected_text,
            "current_page": req.current_page,
            "subject": subject,
            "grade": grade,
            "message": "Question is required.",
        }

    rows = collection_rows(subject, grade, req.unit)
    query_text = f"{question} {selected_text_excerpt}".strip() or question
    if req.current_page is not None and req.current_page > 0:
        page_rows = [row for row in rows if metadata_page(row.get("metadata", {})) == req.current_page]
        rows_for_rank = page_rows or rows
    else:
        rows_for_rank = rows

    ranked = rank_rows(query_text, rows_for_rank)
    ranked_context_text = "\n\n".join(row.get("document", "") for row in ranked[:TOP_K]).strip()
    retrieval_result = None
    teacher_guide_context = ""
    textbook_context = ranked_context_text

    if not ranked:
        retrieval_result, error_message = fetch_textbook_context(query_text, grade, subject)
        if error_message:
            return {
                "response": POLITE_INSUFFICIENT_INFO_MESSAGE,
                "selected_text": selected_text,
                "current_page": req.current_page,
                "subject": subject,
                "grade": grade,
                "message": error_message,
            }
        textbook_context = str(retrieval_result.get("textbook_context_text", "") or "").strip()
        teacher_guide_context = str(retrieval_result.get("teacher_guide_context_text", "") or "").strip()

    performance_band = normalize_grounded_answer(req.performance_band or "")

    profile = StudentProfile(
        full_name=req.full_name or "Student",
        grade=grade,
        performance_band=(req.performance_band or "medium") if (req.performance_band or "").strip() in {"support", "low", "medium", "top"} else "medium",
        mastery_score=int(req.mastery_score) if req.mastery_score is not None else 50,
        support_subjects=[item for item in support_subjects if item],
        strong_subjects=[item for item in strong_subjects if item],
    )

    if selected_text_excerpt:
        textbook_context = f"Selected text excerpt:\n{selected_text_excerpt}\n\n{textbook_context}".strip()

    # Keep context within practical model limits for stable responses.
    if textbook_context:
        textbook_context = textbook_context[:7000]
    if teacher_guide_context:
        teacher_guide_context = teacher_guide_context[:3000]

    if not textbook_context:
        return {
            "response": POLITE_INSUFFICIENT_INFO_MESSAGE,
            "selected_text": selected_text,
            "current_page": req.current_page,
            "subject": subject,
            "grade": grade,
            "message": "No grounded textbook context found for this selection.",
        }

    direct_answer_request = (
        is_selection_direct_answer_request(question)
        or is_generic_selection_prompt(question)
    )

    effective_question = question
    if selected_text_excerpt and is_generic_selection_prompt(question):
        effective_question = (
            "Use the selected text to answer the exact textbook question and show the final answer clearly.\n\n"
            f"Selected question text: {selected_text_excerpt}"
        )

    composed_question = (
        f"Student question: {effective_question}\n\n"
        "Answer exactly what the student wants. "
        "Do not say: I will answer, let me answer, or similar meta text. "
        "Start directly with the answer. "
        "If it is a calculation question, show key steps and final answer clearly. "
        "If asked to explain more, continue the same idea with deeper but focused explanation."
    )

    tutor_answer = None
    try:
        messages = build_tutor_messages(
            question=composed_question,
            context_text=textbook_context,
            profile=profile,
            subject=subject,
            source_grade=grade,
            history=normalize_history(req.history or []),
            teacher_guide_context=teacher_guide_context,
        )
        response = ollama.chat(
            model=MODEL,
            messages=messages,
            options={"temperature": 0.0},
        )
        ai_raw_text = response.get("message", {}).get("content", "")
        clean_answer = sanitize_tutor_response(ai_raw_text, composed_question)
        clean_answer = re.sub(
            r"^(?:i\s+will\s+answer(?:\s+your)?|i\s+can\s+answer(?:\s+your)?|let\s+me\s+answer(?:\s+that)?)[^a-z0-9]+",
            "",
            clean_answer.strip(),
            flags=re.IGNORECASE,
        ).strip()

        if direct_answer_request:
            tutor_answer = clean_answer
        else:
            tutor_answer = finalize_student_answer(clean_answer, profile, question)
    except Exception as generation_error:
        print(f"[selection-ask] generation failed: {generation_error}")
        tutor_answer = None

    if not tutor_answer:
        tutor_answer = POLITE_INSUFFICIENT_INFO_MESSAGE

    answer = tutor_answer.strip()

    return {
        "response": answer,
        "selected_text": selected_text,
        "current_page": req.current_page,
        "subject": subject,
        "grade": grade,
        "support_subjects": support_subjects,
        "strong_subjects": strong_subjects,
        "performance_band": performance_band or None,
        "mastery_score": req.mastery_score,
        "message": "Answered from selected textbook text.",
    }


@app.post("/chat")
def chat_endpoint(req: ChatRequest):
    profile = resolve_student_profile(req.student_profile, req.grade)
    answer = ask_tutor_logic(req.question, profile.grade, profile, req.subject, req.history)
    return {"response": answer}


@app.post("/chat/stream")
def chat_stream_endpoint(req: ChatRequest):
    profile = resolve_student_profile(req.student_profile, req.grade)
    return StreamingResponse(
        stream_tutor_logic(req.question, profile.grade, profile, req.subject, req.history),
        media_type="text/plain",
    )


@app.post("/quiz")
def quiz_endpoint(req: QuizRequest):
    return {"message": f"Quiz generator placeholder for topic: {req.topic}"}


@app.post("/practice")
def practice_endpoint(req: PracticeRequest):
    profile = resolve_student_profile(req.student_profile, req.grade)
    return generate_practice_logic(
        req.subject,
        req.topic,
        req.num_questions,
        req.types,
        profile.grade,
        profile,
    )


if __name__ == "__main__":
    if is_port_in_use(PORT):
        if running_edutwin_status(PORT):
            if stop_existing_edutwin_backend(PORT):
                print(f"Replaced the existing EduTwin backend on port {PORT}.")
                for _ in range(10):
                    if not is_port_in_use(PORT):
                        break
                    time.sleep(0.2)
            else:
                print(f"EduTwin backend is already running on port {PORT}.")
                print("Stop the existing server before starting a new one.")
                sys.exit(0)

        if is_port_in_use(PORT):
            print(f"Port {PORT} is already in use by another process.")
            print(f"Stop that process or run with EDUTWIN_PORT set to a different port.")
            sys.exit(1)

    uvicorn.run(app, host=HOST, port=PORT)