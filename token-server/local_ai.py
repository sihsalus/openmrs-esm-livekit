"""Local AI helper endpoints for the OpenMRS LiveKit hackathon prototype."""

from __future__ import annotations

import json
import os
import re
import shutil
import time
import urllib.request
import uuid
from typing import Any

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "medgemma:latest")
OLLAMA_TIMEOUT = int(os.environ.get("OLLAMA_TIMEOUT", "45"))
OPENMRS_BASE_URL = os.environ.get("OPENMRS_BASE_URL", "http://127.0.0.1/openmrs").rstrip("/")
LIVEKIT_HTTP_URL = os.environ.get("LIVEKIT_HTTP_URL", "http://127.0.0.1:7880").rstrip("/")
DRAFT_STORE_PATH = os.environ.get("DRAFT_STORE_PATH", "/tmp/openmrs-livekit-drafts.jsonl")

DEMO_TRANSCRIPT = (
    "Doctor: Joshua has had cough, fever, and sore throat for two days. "
    "No known drug allergies. The caregiver gave paracetamol yesterday. "
    "Patient: Me duele la garganta y tengo tos. "
    "Doctor: Drink fluids and return immediately if breathing becomes difficult."
)

DRAFT_KEYS = (
    "chiefComplaint",
    "symptoms",
    "medicationsMentioned",
    "allergiesMentioned",
    "assessmentNotes",
    "patientInstructions",
)

SYMPTOM_KEYWORDS = {
    "cough": ["cough", "tos"],
    "fever": ["fever", "fiebre"],
    "sore throat": ["sore throat", "throat pain", "dolor de garganta", "garganta"],
    "shortness of breath": ["shortness of breath", "difficulty breathing", "dificultad para respirar"],
    "headache": ["headache", "dolor de cabeza"],
    "nausea": ["nausea", "nauseas", "nauseas"],
    "abdominal pain": ["abdominal pain", "stomach pain", "dolor abdominal", "dolor de estomago"],
    "diarrhea": ["diarrhea", "diarrea"],
}

MEDICATION_KEYWORDS = [
    "acetaminophen",
    "amoxicillin",
    "azithromycin",
    "ibuprofen",
    "metformin",
    "paracetamol",
    "salbutamol",
]


def build_health_response(room_prefix: str) -> dict[str, Any]:
    ollama = _probe_ollama()
    livekit = _probe_http(LIVEKIT_HTTP_URL, expect_json=False)
    openmrs = _probe_http(f"{OPENMRS_BASE_URL}/ws/rest/v1/session", expect_json=True)
    stt_engine = _first_command(["whisper-cli", "whisper.cpp", "whisper", "vosk-transcriber"])
    tts_engine = _first_command(["piper", "espeak-ng"])

    services = {
        "tokenServer": {"status": "ok", "port": int(os.environ.get("TOKEN_SERVER_PORT", "7890"))},
        "livekit": livekit,
        "openmrs": openmrs,
        "ollama": ollama,
        "stt": {
            "status": "configured" if stt_engine else "not_configured",
            "engine": stt_engine,
            "contract": "POST /stt",
        },
        "tts": {
            "status": "configured" if tts_engine else "not_configured",
            "engine": tts_engine,
            "contract": "POST /tts",
        },
        "parser": {
            "status": "ok" if ollama["status"] == "ok" else "fallback",
            "engine": "ollama" if ollama["status"] == "ok" else "heuristic",
            "contract": "POST /compile-encounter",
        },
    }
    core_ok = all(services[name]["status"] == "ok" for name in ("livekit", "openmrs", "ollama"))

    return {
        "status": "ok" if core_ok else "degraded",
        "roomPrefix": room_prefix,
        "offline": True,
        "services": services,
        "livekit": services["livekit"]["status"],
        "openmrs": services["openmrs"]["status"],
        "ollama": services["ollama"]["status"],
        "stt": services["stt"]["status"],
        "tts": services["tts"]["status"],
    }


def compile_encounter(body: dict[str, Any]) -> dict[str, Any]:
    transcript = str(body.get("transcript") or body.get("text") or DEMO_TRANSCRIPT).strip()
    names = [body.get("patientName"), body.get("clinicianName"), body.get("doctorName")]
    redacted_transcript = redact_phi(transcript, names)
    warnings: list[str] = []

    try:
        draft = _compile_with_ollama(redacted_transcript)
        engine = "ollama"
        model = OLLAMA_MODEL
    except Exception as error:
        draft = _heuristic_draft(redacted_transcript)
        engine = "heuristic"
        model = None
        warnings.append(f"Ollama parser fallback used: {type(error).__name__}: {str(error)[:160]}")

    return {
        "status": "ok",
        "engine": engine,
        "model": model,
        "redactedTranscript": redacted_transcript,
        "draft": _normalize_draft(draft),
        "privacy": {
            "rawAudioStored": False,
            "redactionApplied": True,
            "localOnlyProcessing": True,
            "clinicianReviewRequired": True,
        },
        "warnings": warnings,
    }


def translate_text(body: dict[str, Any]) -> dict[str, Any]:
    text = str(body.get("text") or "").strip()
    if not text:
        return {"status": "error", "error": "Missing text"}

    source = body.get("sourceLanguage") or "auto"
    target = body.get("targetLanguage") or "es"
    target_name = _language_name(str(target))
    prompt = (
        "Translate this clinical message for a patient. Preserve clinical meaning, "
        "use plain language, do not add new facts, and return only the translated text.\n"
        f"Source language: {source}\n"
        f"Target language: {target_name}\n"
        f"Text:\n{text}"
    )

    try:
        translated = _ollama_generate(prompt, timeout=OLLAMA_TIMEOUT).strip()
        engine = "ollama"
    except Exception:
        translated = text
        engine = "identity-fallback"

    return {
        "status": "ok",
        "engine": engine,
        "sourceLanguage": source,
        "targetLanguage": target,
        "translatedText": translated,
    }


def stt_response(body: dict[str, Any]) -> dict[str, Any]:
    engine = _first_command(["whisper-cli", "whisper.cpp", "whisper", "vosk-transcriber"])
    demo_transcript = str(body.get("demoTranscript") or DEMO_TRANSCRIPT if body.get("demo") else "")
    return {
        "status": "configured" if engine else "not_configured",
        "engine": engine,
        "transcript": demo_transcript,
        "message": "Local STT endpoint contract is ready. Install whisper.cpp or Vosk to enable real audio transcription.",
    }


def tts_response(body: dict[str, Any]) -> dict[str, Any]:
    engine = _first_command(["piper", "espeak-ng"])
    return {
        "status": "configured" if engine else "not_configured",
        "engine": engine,
        "audioContent": None,
        "audioFormat": None,
        "text": body.get("text") or "",
        "message": "Local TTS endpoint contract is ready. Install Piper to return generated audio.",
    }


def queue_openmrs_draft(body: dict[str, Any]) -> dict[str, Any]:
    draft_id = str(uuid.uuid4())
    record = {
        "id": draft_id,
        "createdAt": int(time.time()),
        "patientUuid": body.get("patientUuid"),
        "redactedTranscript": body.get("redactedTranscript"),
        "draft": body.get("draft") or {},
        "source": "openmrs-livekit-local-ai",
        "clinicianReviewRequired": True,
        "openmrsWrite": "disabled",
    }
    with open(DRAFT_STORE_PATH, "a", encoding="utf-8") as file:
        file.write(json.dumps(record, ensure_ascii=True) + "\n")

    return {
        "status": "queued",
        "draftId": draft_id,
        "clinicianReviewRequired": True,
        "openmrsWrite": "disabled",
        "message": "Draft queued locally for clinician review. It has not been written to OpenMRS.",
    }


def redact_phi(text: str, names: list[Any] | None = None) -> str:
    result = text
    for name in names or []:
        if not name:
            continue
        name_text = str(name).strip()
        if len(name_text) >= 2:
            result = re.sub(re.escape(name_text), "[REDACTED_NAME]", result, flags=re.IGNORECASE)

    replacements = [
        (r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", "[REDACTED_EMAIL]"),
        (r"(?:\+?\d[\d .()\-]{7,}\d)", "[REDACTED_PHONE]"),
        (r"(?:OpenMRS ID|patient id|national id|document id|ID)\s*[:#]?\s*[A-Z0-9-]+", "[REDACTED_ID]"),
        (r"\d{1,2}[/-]\d{1,2}[/-]\d{2,4}", "[REDACTED_DATE]"),
    ]
    for pattern, replacement in replacements:
        result = re.sub(pattern, replacement, result, flags=re.IGNORECASE)
    return result


def _compile_with_ollama(redacted_transcript: str) -> dict[str, Any]:
    prompt = f"""
You are an offline clinical documentation assistant for OpenMRS.
Convert the redacted doctor-patient transcript into JSON only.
Do not invent facts. Do not produce a final diagnosis. Make it clear that clinician review is required.

Return exactly these keys:
chiefComplaint: string
symptoms: string[]
medicationsMentioned: string[]
allergiesMentioned: string[]
assessmentNotes: string
patientInstructions: string

Redacted transcript:
{redacted_transcript}
""".strip()
    response = _ollama_generate(prompt, timeout=OLLAMA_TIMEOUT)
    return _extract_json(response)


def _heuristic_draft(redacted_transcript: str) -> dict[str, Any]:
    lower = redacted_transcript.lower()
    symptoms = [label for label, terms in SYMPTOM_KEYWORDS.items() if any(term in lower for term in terms)]
    medications = [med for med in MEDICATION_KEYWORDS if med in lower]
    allergies = _extract_allergies(redacted_transcript)
    chief_complaint = _first_relevant_sentence(redacted_transcript, symptoms) or "Clinical concern discussed during voice consultation"

    return {
        "chiefComplaint": chief_complaint,
        "symptoms": symptoms,
        "medicationsMentioned": medications,
        "allergiesMentioned": allergies,
        "assessmentNotes": "Generated from redacted transcript. Requires clinician review before saving to OpenMRS.",
        "patientInstructions": _extract_instruction(redacted_transcript),
    }


def _normalize_draft(draft: dict[str, Any]) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    for key in DRAFT_KEYS:
        value = draft.get(key)
        if key.endswith("Mentioned") or key == "symptoms":
            normalized[key] = value if isinstance(value, list) else ([] if not value else [str(value)])
        else:
            normalized[key] = "" if value is None else str(value)
    return normalized


def _extract_json(text: str) -> dict[str, Any]:
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("Ollama response did not contain a JSON object")
    return json.loads(text[start : end + 1])


def _extract_allergies(text: str) -> list[str]:
    if re.search(r"no known (drug )?allerg", text, flags=re.IGNORECASE):
        return []
    match = re.search(r"allerg(?:y|ic|ies) (?:to )?([A-Za-z, ]+)", text, flags=re.IGNORECASE)
    if not match:
        return []
    return [item.strip().lower() for item in match.group(1).split(",") if item.strip()]


def _first_relevant_sentence(text: str, symptoms: list[str]) -> str | None:
    sentences = re.split(r"(?<=[.!?])\s+", text)
    for sentence in sentences:
        lowered = sentence.lower()
        if any(symptom in lowered for symptom in symptoms):
            return sentence[:240]
    return sentences[0][:240] if sentences else None


def _extract_instruction(text: str) -> str:
    sentences = re.split(r"(?<=[.!?])\s+", text)
    instruction_terms = ("drink", "return", "follow", "take", "hydrate", "fluids", "regrese", "tome")
    for sentence in sentences:
        if any(term in sentence.lower() for term in instruction_terms):
            return sentence[:240]
    return "No patient instructions extracted. Clinician review required."


def _ollama_generate(prompt: str, timeout: int = 45) -> str:
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.1, "num_ctx": 4096},
    }
    response = _json_request(f"{OLLAMA_URL}/api/generate", payload, timeout=timeout)
    return str(response.get("response") or "")


def _probe_ollama() -> dict[str, Any]:
    try:
        response = _json_request(f"{OLLAMA_URL}/api/tags", timeout=2)
        models = [item.get("name") for item in response.get("models", []) if item.get("name")]
        return {"status": "ok", "url": OLLAMA_URL, "model": OLLAMA_MODEL, "models": models[:8]}
    except Exception as error:
        return {"status": "unreachable", "url": OLLAMA_URL, "model": OLLAMA_MODEL, "detail": str(error)[:160]}


def _probe_http(url: str, expect_json: bool) -> dict[str, Any]:
    try:
        body = _json_request(url, timeout=2) if expect_json else _text_request(url, timeout=2)
        payload: dict[str, Any] = {"status": "ok", "url": url}
        if isinstance(body, dict) and "authenticated" in body:
            payload["authenticated"] = body["authenticated"]
        return payload
    except Exception as error:
        return {"status": "unreachable", "url": url, "detail": str(error)[:160]}


def _json_request(url: str, payload: dict[str, Any] | None = None, timeout: int = 2) -> Any:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read().decode("utf-8", "replace")
    return json.loads(raw) if raw else {}


def _text_request(url: str, timeout: int = 2) -> str:
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return response.read(1024).decode("utf-8", "replace")


def _first_command(commands: list[str]) -> str | None:
    for command in commands:
        if shutil.which(command):
            return command
    return None


def _language_name(language: str) -> str:
    normalized = language.lower()
    if normalized.startswith("es"):
        return "Spanish"
    if normalized.startswith("en"):
        return "English"
    return language
