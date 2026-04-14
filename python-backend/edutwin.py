import os
import re
from contextlib import asynccontextmanager
from typing import Optional

import chromadb
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
import ollama
from pydantic import BaseModel
import uvicorn

DB_DIR = "chroma_db"
HOST = os.getenv("EDUTWIN_HOST", "0.0.0.0")
PORT = int(os.getenv("EDUTWIN_PORT", "8011"))
MODEL = os.getenv("EDUTWIN_LLM_MODEL", "llama3.1:8b")
TOP_K = 4

TEST_TEXTBOOK_URL = (
    "https://vzqerbreduraaluicaxe.supabase.co/storage/v1/object/public/3d-models/"
    "G9-Physics-STB-2023-webUnit1.pdf"
)

CANVAS_KEYS = ("canvas_url", "canvas_link", "model_url", "demo_url", "canvasModelLink")
AR_KEYS = ("ar_model_url", "ar_url", "figure_ar_url")

client = None


class TextbookAssistRequest(BaseModel):
    subject: str = "physics"
    grade: str = "9"
    chapter: str = "1"
    unit: str = "Unit1"
    current_page: Optional[int] = None
    current_topic: Optional[str] = None
    current_passage: Optional[str] = None


class ChatRequest(BaseModel):
    question: str
    subject: str = "physics"
    grade: str = "9"
    chapter: str = "1"
    unit: str = "Unit1"
    current_page: Optional[int] = None


class TextSelectionAskRequest(BaseModel):
    subject: str = "physics"
    grade: str = "9"
    chapter: str = "1"
    unit: str = "Unit1"
    question: str
    selected_text: str
    current_page: Optional[int] = None
    current_topic: Optional[str] = None
    support_subjects: Optional[list[str]] = None
    strong_subjects: Optional[list[str]] = None
    mastery_score: Optional[float] = None
    performance_band: Optional[str] = None


def get_client():
    global client
    if client is None:
        client = chromadb.PersistentClient(path=DB_DIR)
    return client


def normalize_text(text: str):
    return re.sub(r"\s+", " ", str(text or "")).strip()


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


def collection_rows(subject: str, grade: str, unit: str):
    collections = get_client().list_collections()
    if not collections:
        return []

    name = getattr(collections[0], "name", collections[0])
    collection = get_client().get_collection(name)
    result = collection.get(include=["documents", "metadatas"])

    docs = result.get("documents") or []
    metas = result.get("metadatas") or []

    wanted_subject = normalize_text(subject).lower()
    wanted_grade = normalize_text(grade)
    wanted_unit = normalize_text(unit).lower()

    rows = []
    for idx, doc in enumerate(docs):
        metadata = metas[idx] if idx < len(metas) and isinstance(metas[idx], dict) else {}
        row_subject = normalize_text(metadata.get("subject", "")).lower()
        row_grade = normalize_text(metadata.get("grade", ""))
        row_unit = normalize_text(metadata.get("unit", "")).lower()

        if wanted_subject and row_subject and row_subject != wanted_subject:
            continue
        if wanted_grade and row_grade and row_grade != wanted_grade:
            continue
        if wanted_unit and row_unit and row_unit != wanted_unit:
            continue

        rows.append({"document": normalize_text(doc), "metadata": metadata})
    return rows


def rank_rows(query: str, rows: list[dict]):
    tokens = set(re.findall(r"[a-zA-Z0-9]{3,}", normalize_text(query).lower()))
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
        return None

    exact = []
    nearby = []
    for row in rows:
        metadata = row["metadata"]
        row_page = metadata_page(metadata)
        if row_page is None:
            continue
        if row_page == page:
            exact.append(row)
        elif abs(row_page - page) <= 1:
            nearby.append(row)

    for bucket in (exact, nearby):
        for row in bucket:
            link = first_non_empty(row["metadata"], CANVAS_KEYS)
            if link:
                row_page = metadata_page(row["metadata"])
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
        return None
    for row in rows:
        row_page = metadata_page(row["metadata"])
        if row_page != page:
            continue
        ar_link = first_non_empty(row["metadata"], AR_KEYS)
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


def rag_answer(question: str, rows: list[dict]):
    if not rows:
        return "I could not find enough textbook context for this page."
    context = "\n\n".join(row["document"] for row in rows[:TOP_K])
    prompt = (
        "You are EduTwin tutor. Use only the textbook context below. "
        "If context is insufficient, say so briefly.\n\n"
        f"TEXTBOOK CONTEXT:\n{context}\n\n"
        f"QUESTION:\n{question}"
    )

    try:
        response = ollama.chat(
            model=MODEL,
            messages=[{"role": "user", "content": prompt}],
            options={"temperature": 0.0},
        )
        return normalize_text(response.get("message", {}).get("content", "")) or "No answer generated."
    except Exception as exc:
        return f"Error communicating with local Llama model: {exc}"


def rag_stream(question: str, rows: list[dict]):
    if not rows:
        yield "I could not find enough textbook context for this page."
        return
    context = "\n\n".join(row["document"] for row in rows[:TOP_K])
    prompt = (
        "You are EduTwin tutor. Use only the textbook context below. "
        "If context is insufficient, say so briefly.\n\n"
        f"TEXTBOOK CONTEXT:\n{context}\n\n"
        f"QUESTION:\n{question}"
    )

    try:
        for chunk in ollama.chat(
            model=MODEL,
            messages=[{"role": "user", "content": prompt}],
            stream=True,
            options={"temperature": 0.0},
        ):
            content = chunk.get("message", {}).get("content", "") if isinstance(chunk, dict) else ""
            if content:
                yield content
    except Exception as exc:
        yield f"\n[Error communicating with local Llama model: {exc}]"


@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        get_client()
    except Exception as preload_error:
        print(f"Preload failed: {preload_error}")
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/")
def health():
    return {"status": "EduTwin interactive textbook backend is active"}


@app.get("/textbook/info")
def textbook_info():
    return {
        "subject": "physics",
        "grade": "9",
        "unit": "Unit1",
        "chapter": "1",
        "textbook_url": TEST_TEXTBOOK_URL,
    }


@app.post("/textbook/assist")
def textbook_assist(req: TextbookAssistRequest):
    rows = collection_rows(req.subject, req.grade, req.unit)
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
    selected_text = normalize_text(req.selected_text)
    question = normalize_text(req.question)
    subject = normalize_text(req.subject).lower() or "physics"
    grade = normalize_text(req.grade) or "9"
    unit = normalize_text(req.unit) or "Unit1"
    support_subjects = [normalize_text(item).lower() for item in (req.support_subjects or []) if normalize_text(item)]
    strong_subjects = [normalize_text(item).lower() for item in (req.strong_subjects or []) if normalize_text(item)]
    performance_band = normalize_text(req.performance_band)
    mastery_score_text = ""
    if req.mastery_score is not None:
        mastery_score_text = str(req.mastery_score)

    if not selected_text:
        return {
            "response": "Please highlight textbook text first, then ask your question.",
            "selected_text": "",
            "current_page": req.current_page,
            "subject": subject,
            "grade": grade,
            "message": "No selected text was provided.",
        }

    if not question:
        return {
            "response": "Please type a question about the selected text.",
            "selected_text": selected_text,
            "current_page": req.current_page,
            "subject": subject,
            "grade": grade,
            "message": "Question is required.",
        }

    rows = collection_rows(subject, grade, unit)
    if req.current_page is not None and req.current_page > 0:
        page_rows = [row for row in rows if metadata_page(row["metadata"]) == req.current_page]
        rows_for_rank = page_rows or rows
    else:
        rows_for_rank = rows

    ranked = rank_rows(f"{question} {selected_text}", rows_for_rank)
    level_guidance = (
        "Teach with balanced depth and clear steps."
    )
    if subject in support_subjects:
        level_guidance = (
            "This is a support subject for the student. Keep explanation simple, step-by-step, "
            "with short sentences and one concrete example."
        )
    elif subject in strong_subjects:
        level_guidance = (
            "This is a strong subject for the student. Give a concise answer first, then include "
            "one extension insight or challenge."
        )

    composed_question = (
        f"Student grade: {grade}\n"
        f"Subject: {subject}\n\n"
        f"Support subjects: {', '.join(support_subjects) if support_subjects else 'none'}\n"
        f"Strong subjects: {', '.join(strong_subjects) if strong_subjects else 'none'}\n"
        f"Performance band: {performance_band or 'unknown'}\n"
        f"Mastery score: {mastery_score_text or 'unknown'}\n"
        f"Teaching guidance: {level_guidance}\n\n"
        "Selected textbook text:\n"
        f"{selected_text}\n\n"
        "Student question:\n"
        f"{question}\n\n"
        "Answer directly, simply, and only from textbook context."
    )
    answer = rag_answer(composed_question, ranked)

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
def chat(req: ChatRequest):
    rows = collection_rows(req.subject, req.grade, req.unit)
    if req.current_page is not None and req.current_page > 0:
        page_rows = [row for row in rows if metadata_page(row["metadata"]) == req.current_page]
        ranked = rank_rows(req.question, page_rows or rows)
    else:
        ranked = rank_rows(req.question, rows)

    answer = rag_answer(req.question, ranked)
    interactive = find_canvas_for_page(rows, req.current_page)
    return {
        "response": answer,
        "interactive": {
            **interactive,
            "current_page": req.current_page,
        },
    }


@app.post("/chat/stream")
def chat_stream(req: ChatRequest):
    rows = collection_rows(req.subject, req.grade, req.unit)
    if req.current_page is not None and req.current_page > 0:
        page_rows = [row for row in rows if metadata_page(row["metadata"]) == req.current_page]
        ranked = rank_rows(req.question, page_rows or rows)
    else:
        ranked = rank_rows(req.question, rows)
    return StreamingResponse(rag_stream(req.question, ranked), media_type="text/plain")


if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT)
