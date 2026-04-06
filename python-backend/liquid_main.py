import json
import os
import re
from contextlib import asynccontextmanager
from typing import Optional
from urllib import error, request

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import uvicorn

from main import (
    ChatRequest,
    PracticeRequest,
    StudentProfile,
    MAX_PRACTICE_TOKENS,
    PRACTICE_TOKENS_PER_QUESTION,
    POLITE_ABOVE_GRADE_LEVEL_MESSAGE,
    POLITE_GREETING_MESSAGE,
    POLITE_INSUFFICIENT_INFO_MESSAGE,
    POLITE_OUT_OF_CURRICULUM_MESSAGE,
    INSUFFICIENT_CURRICULUM_INFO_MESSAGE,
    build_profile_instruction,
    build_tutor_messages,
    fetch_textbook_context,
    finalize_student_answer,
    get_available_collection_names,
    get_client,
    get_embedding_func,
    is_greeting_message,
    is_retrieved_context_relevant,
    normalize_grade_value,
    normalize_questions,
    parse_json_object,
    resolve_chat_subject,
    resolve_effective_grade,
    resolve_question_with_history,
    resolve_student_profile,
    select_relevant_sentences_in_order,
    sanitize_tutor_response,
    extract_requested_grade,
)

HOST = os.getenv("LIQUID_EDUTWIN_HOST", "0.0.0.0")
PORT = int(os.getenv("LIQUID_EDUTWIN_PORT", "8001"))
LM_STUDIO_BASE_URL = os.getenv("LM_STUDIO_BASE_URL", "http://192.168.9.162:1234").rstrip("/")
LIQUID_MODEL = os.getenv("LIQUID_MODEL", "liquid")
REQUEST_TIMEOUT_SECONDS = int(os.getenv("LM_STUDIO_TIMEOUT", "180"))
ONLINE_REASONING_CHAT_URL = os.getenv("ONLINE_REASONING_CHAT_URL", "http://127.0.0.1:8000/chat").strip()
ONLINE_REASONING_TIMEOUT_SECONDS = int(os.getenv("ONLINE_REASONING_TIMEOUT", "60"))


class GradeRequest(BaseModel):
    question: str
    question_type: str
    correct_answer: str
    student_answer: str


def http_post_json(url: str, payload: dict, timeout: int = REQUEST_TIMEOUT_SECONDS):
    req = request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with request.urlopen(req, timeout=timeout) as response:
        raw = response.read().decode("utf-8", errors="ignore")
        return json.loads(raw)


def pick_lm_studio_model():
    if LIQUID_MODEL.strip() and LIQUID_MODEL.strip().lower() != "auto":
        return LIQUID_MODEL.strip()

    try:
        with request.urlopen(f"{LM_STUDIO_BASE_URL}/v1/models", timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8", errors="ignore"))
            models = payload.get("data") or []
            if models and isinstance(models[0], dict) and models[0].get("id"):
                return str(models[0]["id"])
    except Exception:
        pass

    return "liquid"


def call_lm_studio_chat(messages: list[dict], temperature: float = 0.0, max_tokens: int = 512):
    payload = {
        "model": pick_lm_studio_model(),
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }
    result = http_post_json(f"{LM_STUDIO_BASE_URL}/v1/chat/completions", payload)
    choices = result.get("choices") or []
    if not choices:
        raise ValueError("LM Studio returned no choices.")

    message = choices[0].get("message") or {}
    content = message.get("content")
    if not isinstance(content, str) or not content.strip():
        raise ValueError("LM Studio returned empty content.")
    return content.strip()


def normalize_answer_text(text: str):
    normalized = "".join(ch.lower() if ch.isalnum() else " " for ch in (text or ""))
    return " ".join(normalized.split())


def grade_answer_logic(question_type: str, correct_answer: str, student_answer: str):
    q_type = (question_type or "").strip().lower().replace("-", "_")
    correct = normalize_answer_text(correct_answer)
    student = normalize_answer_text(student_answer)

    if not correct or not student:
        return {
            "is_correct": False,
            "feedback": "Please provide a valid answer so I can grade it.",
        }

    if q_type in {"mcq", "true_false"}:
        is_correct = student == correct
    else:
        is_correct = (
            student == correct
            or (len(student) >= 3 and student in correct)
            or (len(correct) >= 3 and correct in student)
        )

    if is_correct:
        return {
            "is_correct": True,
            "feedback": "Great job. Your answer matches the textbook answer.",
        }

    return {
        "is_correct": False,
        "feedback": f"Not quite. Textbook answer: {correct_answer.strip()}",
    }


def clean_student_chat_output(text: str):
    cleaned = (text or "").strip()
    if not cleaned:
        return cleaned

    cleaned = cleaned.replace("**Explanation:**", "Explanation:")
    cleaned = cleaned.replace("**Example:**", "Example:")
    cleaned = cleaned.replace("**Summary:**", "Summary:")
    cleaned = cleaned.replace("**Practice Question:**", "Practice Question:")
    cleaned = cleaned.replace("**", "")

    lines = [line.strip() for line in cleaned.splitlines()]
    normalized_lines = []
    for line in lines:
        if not line:
            if normalized_lines and normalized_lines[-1] != "":
                normalized_lines.append("")
            continue
        normalized_lines.append(line)

    # Remove duplicate intro line if the model repeats it immediately.
    if len(normalized_lines) >= 2:
        first = normalized_lines[0].lower()
        second = normalized_lines[1].lower()
        if first == second:
            normalized_lines.pop(1)

    cleaned = "\n".join(normalized_lines).strip()
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned


def extract_explanation_only(text: str):
    cleaned = clean_student_chat_output(text)
    if not cleaned:
        return cleaned

    stop_markers = (
        "example:",
        "summary:",
        "practice question:",
    )

    selected_lines = []
    for line in cleaned.splitlines():
        normalized = line.strip()
        if not normalized:
            if selected_lines and selected_lines[-1] != "":
                selected_lines.append("")
            continue

        lowered = normalized.lower()
        if lowered.startswith(stop_markers):
            break

        if lowered.startswith("explanation:"):
            normalized = normalized[len("Explanation:"):].strip()
            if not normalized:
                continue

        selected_lines.append(normalized)

    result = "\n".join(selected_lines).strip()
    result = re.sub(r"\n{3,}", "\n\n", result)
    return result or cleaned


def is_calculation_question(text: str):
    lowered = (text or "").lower()
    markers = [
        "calculate",
        "find",
        "solve",
        "formula",
        "equation",
        "example",
        "work done",
        "force",
        "speed",
        "velocity",
        "acceleration",
        "pressure",
        "density",
        "mass",
    ]
    has_symbol = bool(re.search(r"[=+\-/*^]", lowered))
    return has_symbol or any(marker in lowered for marker in markers)


def offline_calculation_notice():
    return (
        "Offline mode note: this local model is best for text explanations, "
        "and calculation accuracy can be limited. For full step-by-step calculation support, use online mode."
    )


def can_use_online_reasoning():
    if not ONLINE_REASONING_CHAT_URL:
        return False

    local_loopback_targets = {
        f"http://127.0.0.1:{PORT}/chat",
        f"http://localhost:{PORT}/chat",
    }
    return ONLINE_REASONING_CHAT_URL not in local_loopback_targets


def build_calculation_online_question(question: str):
    return (
        "Solve this calculation question with clear step-by-step reasoning. "
        "Use formulas carefully, define variables, substitute values, and show units in each step. "
        "If values are missing, ask for the missing values instead of guessing.\n\n"
        f"Question: {question.strip()}"
    )


def try_online_calculation_reasoning(
    question: str,
    subject: str,
    grade: str,
    profile: StudentProfile,
    history: list[dict[str, str]],
):
    if not can_use_online_reasoning():
        return None

    payload = {
        "question": build_calculation_online_question(question),
        "subject": subject,
        "grade": grade,
        "history": history,
        "student_profile": {
            "full_name": profile.full_name,
            "grade": profile.grade,
            "mastery_score": profile.mastery_score,
            "performance_band": profile.performance_band,
            "preferred_language": profile.preferred_language,
            "twin_name": profile.twin_name,
            "support_subjects": profile.support_subjects,
            "strong_subjects": profile.strong_subjects,
        },
    }

    try:
        result = http_post_json(
            ONLINE_REASONING_CHAT_URL,
            payload,
            timeout=ONLINE_REASONING_TIMEOUT_SECONDS,
        )
    except Exception:
        return None

    response = result.get("response") if isinstance(result, dict) else None
    if not isinstance(response, str) or not response.strip():
        return None
    return response.strip()


def has_numeric_data(text: str):
    return bool(re.search(r"\b\d+(?:\.\d+)?\b", text or ""))


def build_grounded_extract_answer(question: str, context_text: str, subject: str):
    selected = select_relevant_sentences_in_order(question, context_text, subject, limit=4)
    if not selected:
        return ""

    deduped = []
    seen = set()
    for sentence in selected:
        normalized = re.sub(r"\s+", " ", sentence).strip()
        key = normalized.lower()
        if not normalized or key in seen:
            continue
        seen.add(key)
        deduped.append(normalized)

    return " ".join(deduped)


def output_is_grounded(answer_text: str, context_text: str):
    answer_tokens = {
        token
        for token in re.findall(r"[a-zA-Z]{4,}", (answer_text or "").lower())
    }
    if not answer_tokens:
        return False
    context_normalized = (context_text or "").lower()
    overlap = {token for token in answer_tokens if token in context_normalized}
    ratio = len(overlap) / max(1, len(answer_tokens))
    return ratio >= 0.42


def ask_tutor_liquid_logic(
    question: str,
    grade: str,
    profile: StudentProfile,
    selected_subject: Optional[str] = None,
    history: Optional[list[dict[str, str]]] = None,
):
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

    retrieval_result, retrieval_error = fetch_textbook_context(resolved_question, effective_grade, subject)
    if retrieval_error:
        if retrieval_error == INSUFFICIENT_CURRICULUM_INFO_MESSAGE:
            return POLITE_INSUFFICIENT_INFO_MESSAGE
        return retrieval_error

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

    context_text = retrieval_result.get("textbook_context_text") or retrieval_result.get("context_text", "")
    extractive_answer = build_grounded_extract_answer(resolved_question, context_text, subject)

    if is_calculation_question(resolved_question):
        online_reasoned = try_online_calculation_reasoning(
            question=resolved_question,
            subject=subject,
            grade=effective_grade,
            profile=profile,
            history=normalized_history,
        )
        if online_reasoned:
            cleaned_online = extract_explanation_only(sanitize_tutor_response(online_reasoned, resolved_question))
            finalized_online = finalize_student_answer(cleaned_online, profile, resolved_question)
            return clean_student_chat_output(finalized_online)

        notice = offline_calculation_notice()

        if not has_numeric_data(resolved_question) and not has_numeric_data(extractive_answer):
            return (
                "I can explain this from the textbook, but I need actual values to calculate. "
                "Please share the given numbers from your question.\n\n"
                f"{notice}"
            )
        base_response = (
            "I can help solve this, but please give the values with labels like m=..., a=..., v=..., or t=... "
            "so I can calculate step by step."
        )
        return f"{base_response}\n\n{notice}"

    try:
        ai_raw_text = call_lm_studio_chat(messages, temperature=0.0, max_tokens=640)
        clean_answer = sanitize_tutor_response(ai_raw_text, resolved_question)
        explanation_only = extract_explanation_only(clean_answer)

        if not output_is_grounded(explanation_only, context_text):
            if extractive_answer:
                finalized = finalize_student_answer(extractive_answer, profile, resolved_question)
                return clean_student_chat_output(finalized)
            return POLITE_INSUFFICIENT_INFO_MESSAGE

        finalized = finalize_student_answer(explanation_only, profile, resolved_question)
        return clean_student_chat_output(finalized)
    except Exception as model_error:
        if extractive_answer:
            finalized = finalize_student_answer(extractive_answer, profile, resolved_question)
            return clean_student_chat_output(finalized)
        return f"Error communicating with LM Studio Liquid model: {model_error}"


def stream_tutor_liquid_logic(
    question: str,
    grade: str,
    profile: StudentProfile,
    selected_subject: Optional[str] = None,
    history: Optional[list[dict[str, str]]] = None,
):
    # Keep stream endpoint compatible with app while using a single LM Studio completion.
    yield ask_tutor_liquid_logic(question, grade, profile, selected_subject, history)


def generate_practice_liquid_logic(
    subject_name: Optional[str],
    topic: str,
    num_questions: int,
    types: list[str],
    grade: str,
    profile: StudentProfile,
):
    effective_grade = normalize_grade_value(profile.grade or grade)
    profile.grade = effective_grade
    subject, subject_error = resolve_chat_subject(topic or "practice", effective_grade, subject_name)
    if subject_error and not subject:
        return {
            "error": "Choose a textbook subject for practice, such as Biology, Chemistry, Physics, or Math.",
            "questions": [],
        }

    query = topic.strip() or (subject or "biology")
    retrieval_result, retrieval_error = fetch_textbook_context(query, effective_grade, subject or "biology")
    if retrieval_error:
        return {"error": retrieval_error, "questions": []}

    token_budget = min(MAX_PRACTICE_TOKENS, max(500, num_questions * PRACTICE_TOKENS_PER_QUESTION))
    prompt = f"""
You are generating textbook-aligned practice for a Grade {profile.grade} student in the Ethiopian curriculum.
Use only the textbook context below.
Do not add greetings, commentary, markdown, or any text outside the JSON object.
Do not include questions that are outside the topic.

{build_profile_instruction(profile, subject or 'biology')}

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
        raw_json = call_lm_studio_chat(
            [{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=token_budget,
        )
        parsed = parse_json_object(raw_json)
        normalized = normalize_questions(parsed, num_questions, types)
        return {
            "subject": subject,
            "grade": effective_grade,
            "questions": normalized,
            "error": None if normalized else "The Liquid model did not return valid textbook-aligned practice questions.",
        }
    except Exception as practice_error:
        return {"error": str(practice_error), "questions": []}


def preload_backend_resources():
    try:
        get_client()
        get_available_collection_names()
        get_embedding_func()
    except Exception as preload_error:
        print(f"Resource preload failed: {preload_error}")


@asynccontextmanager
async def lifespan(_: FastAPI):
    preload_backend_resources()
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/")
def home():
    return {
        "status": "EduTwin Liquid Brain is Active",
        "lm_studio_url": LM_STUDIO_BASE_URL,
        "model": pick_lm_studio_model(),
    }


@app.post("/chat")
def chat_endpoint(req: ChatRequest):
    profile = resolve_student_profile(req.student_profile, req.grade)
    answer = ask_tutor_liquid_logic(req.question, profile.grade, profile, req.subject, req.history)
    return {"response": answer, "model": "liquid"}


@app.post("/chat/stream")
def chat_stream_endpoint(req: ChatRequest):
    profile = resolve_student_profile(req.student_profile, req.grade)
    return StreamingResponse(
        stream_tutor_liquid_logic(req.question, profile.grade, profile, req.subject, req.history),
        media_type="text/plain",
    )


@app.post("/practice")
def practice_endpoint(req: PracticeRequest):
    profile = resolve_student_profile(req.student_profile, req.grade)
    return generate_practice_liquid_logic(
        req.subject,
        req.topic,
        req.num_questions,
        req.types,
        profile.grade,
        profile,
    )


@app.post("/grade")
def grade_endpoint(req: GradeRequest):
    return grade_answer_logic(req.question_type, req.correct_answer, req.student_answer)


if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT)
