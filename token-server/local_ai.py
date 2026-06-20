"""Local AI helper endpoints for the OpenMRS LiveKit hackathon prototype."""

from __future__ import annotations

import base64
import datetime as dt
import json
import os
import re
import shutil
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "medgemma:latest")
OLLAMA_TIMEOUT = int(os.environ.get("OLLAMA_TIMEOUT", "45"))
OPENMRS_BASE_URL = os.environ.get("OPENMRS_BASE_URL", "http://127.0.0.1/openmrs").rstrip("/")
LIVEKIT_HTTP_URL = os.environ.get("LIVEKIT_HTTP_URL", "http://127.0.0.1:7880").rstrip("/")
DRAFT_STORE_PATH = os.environ.get("DRAFT_STORE_PATH", "/tmp/openmrs-livekit-drafts.jsonl")
RECORDING_MANIFEST_PATH = os.environ.get(
    "RECORDING_MANIFEST_PATH", "/tmp/openmrs-livekit-recordings.jsonl"
)

OPENMRS_DRAFT_WRITE_ENABLED = os.environ.get("OPENMRS_DRAFT_WRITE_ENABLED", "false").lower() in {
    "1",
    "true",
    "yes",
    "on",
}
OPENMRS_ENCOUNTER_TYPE_UUID = os.environ.get("OPENMRS_ENCOUNTER_TYPE_UUID", "").strip()
OPENMRS_LOCATION_UUID = os.environ.get("OPENMRS_LOCATION_UUID", "").strip()
OPENMRS_PROVIDER_UUID = os.environ.get("OPENMRS_PROVIDER_UUID", "").strip()
OPENMRS_ENCOUNTER_ROLE_UUID = os.environ.get("OPENMRS_ENCOUNTER_ROLE_UUID", "").strip()
OPENMRS_DRAFT_OBS_CONCEPT_UUID = os.environ.get("OPENMRS_DRAFT_OBS_CONCEPT_UUID", "").strip()
OPENMRS_BASIC_AUTH = os.environ.get("OPENMRS_BASIC_AUTH", "").strip()
OPENMRS_USERNAME = os.environ.get("OPENMRS_USERNAME", "").strip()
OPENMRS_PASSWORD = os.environ.get("OPENMRS_PASSWORD", "")

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

SYNTHETIC_CASES: dict[str, dict[str, Any]] = {
    "pediatric-respiratory": {
        "patient": {"display": "Sofia Demo", "age": "4 years", "sex": "female"},
        "sourceLanguage": "en",
        "targetLanguage": "es",
        "transcript": (
            "Doctor: Sofia Demo has had cough, fever, and sore throat for two days. "
            "No known drug allergies. The caregiver gave paracetamol yesterday. "
            "Patient: Me duele la garganta y tengo tos. "
            "Doctor: Drink fluids and return immediately if breathing becomes difficult."
        ),
        "draft": {
            "chiefComplaint": "Cough, fever, and sore throat for two days",
            "symptoms": ["cough", "fever", "sore throat"],
            "medicationsMentioned": ["paracetamol"],
            "allergiesMentioned": [],
            "assessmentNotes": "Synthetic respiratory complaint. Clinician review required.",
            "patientInstructions": "Drink fluids and return immediately if breathing becomes difficult.",
        },
    },
    "adult-diabetes-followup": {
        "patient": {"display": "Miguel Demo", "age": "52 years", "sex": "male"},
        "sourceLanguage": "es",
        "targetLanguage": "en",
        "transcript": (
            "Doctor: Miguel Demo viene para control de diabetes. Refiere dolor de cabeza leve "
            "y nausea desde ayer. Patient: I forgot metformin twice this week. "
            "Doctor: Revisaremos glucosa, medicacion y signos de alarma."
        ),
        "draft": {
            "chiefComplaint": "Diabetes follow-up with headache and nausea",
            "symptoms": ["headache", "nausea"],
            "medicationsMentioned": ["metformin"],
            "allergiesMentioned": [],
            "assessmentNotes": "Synthetic diabetes follow-up. Clinician review required.",
            "patientInstructions": "Review glucose, medications, and warning signs with the clinician.",
        },
    },
}


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
        "openmrsDraftWrite": _openmrs_write_status(),
        "syntheticData": {
            "status": "ok",
            "contract": "POST /synthetic-consultation",
            "cases": sorted(SYNTHETIC_CASES.keys()),
        },
        "recording": {
            "status": "manifest_only",
            "contract": "POST /recording/session",
            "rawAudioStoredByDefault": False,
            "egressConfigured": bool(os.environ.get("LIVEKIT_EGRESS_URL")),
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
    demo_transcript = str(body.get("demoTranscript") or (DEMO_TRANSCRIPT if body.get("demo") else ""))
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


def generate_synthetic_consultation(body: dict[str, Any]) -> dict[str, Any]:
    case_id = str(body.get("caseId") or "pediatric-respiratory")
    case = SYNTHETIC_CASES.get(case_id) or SYNTHETIC_CASES["pediatric-respiratory"]
    patient = dict(case["patient"])
    patient["synthetic"] = True
    patient_uuid = str(body.get("patientUuid") or f"synthetic-{case_id}")
    transcript = str(body.get("transcript") or case["transcript"])
    redacted_transcript = redact_phi(transcript, [patient.get("display")])
    draft = _normalize_draft(case.get("draft") or _heuristic_draft(redacted_transcript))

    return {
        "status": "ok",
        "caseId": case_id if case_id in SYNTHETIC_CASES else "pediatric-respiratory",
        "synthetic": True,
        "sourceLanguage": body.get("sourceLanguage") or case.get("sourceLanguage", "en"),
        "targetLanguage": body.get("targetLanguage") or case.get("targetLanguage", "es"),
        "patient": {**patient, "uuid": patient_uuid},
        "transcript": transcript,
        "redactedTranscript": redacted_transcript,
        "draft": draft,
        "openmrsDraftRequest": {
            "patientUuid": patient_uuid,
            "redactedTranscript": redacted_transcript,
            "draft": draft,
        },
        "privacy": {
            "containsRealPatientData": False,
            "safeForDemoRecording": True,
            "rawAudioStored": False,
            "redactionApplied": True,
        },
    }


def recording_session(body: dict[str, Any]) -> dict[str, Any]:
    consent = bool(body.get("consent") or body.get("consentCaptured"))
    if not consent:
        return {
            "status": "consent_required",
            "recordingStatus": "not_started",
            "rawAudioStored": False,
            "message": "Recording requires explicit patient consent before any media or manifest is created.",
        }

    session_id = str(body.get("sessionId") or uuid.uuid4())
    record = {
        "id": session_id,
        "createdAt": int(time.time()),
        "patientUuid": body.get("patientUuid"),
        "roomName": body.get("roomName"),
        "consentCaptured": True,
        "recordingStatus": "manifest_recorded",
        "mediaRecording": "not_configured",
        "rawAudioStored": False,
        "storage": {
            "manifestPath": RECORDING_MANIFEST_PATH,
            "mediaPath": None,
        },
        "retention": body.get("retention") or "demo-session-only",
        "source": "openmrs-livekit-local-ai",
    }
    with open(RECORDING_MANIFEST_PATH, "a", encoding="utf-8") as file:
        file.write(json.dumps(record, ensure_ascii=True) + "\n")

    return {
        "status": "queued",
        "recordingId": session_id,
        "recordingStatus": "manifest_recorded",
        "mediaRecording": "not_configured",
        "rawAudioStored": False,
        "message": "Consent manifest recorded locally. Configure LiveKit Egress or browser MediaRecorder to capture audio.",
        "recording": record,
    }


def queue_openmrs_draft(body: dict[str, Any], context: dict[str, Any] | None = None) -> dict[str, Any]:
    draft_id = str(uuid.uuid4())
    record = {
        "id": draft_id,
        "createdAt": int(time.time()),
        "patientUuid": body.get("patientUuid"),
        "redactedTranscript": body.get("redactedTranscript"),
        "draft": body.get("draft") or {},
        "source": "openmrs-livekit-local-ai",
        "clinicianReviewRequired": True,
        "openmrsWrite": "pending",
    }
    openmrs = build_openmrs_draft_integration(body, record, context or {})
    record["openmrsWrite"] = openmrs["writeStatus"]
    if openmrs.get("encounterUuid"):
        record["encounterUuid"] = openmrs["encounterUuid"]

    with open(DRAFT_STORE_PATH, "a", encoding="utf-8") as file:
        file.write(json.dumps(record, ensure_ascii=True) + "\n")

    saved = openmrs["writeStatus"] == "created"
    return {
        "status": "saved" if saved else "queued",
        "draftId": draft_id,
        "clinicianReviewRequired": True,
        "openmrsWrite": openmrs["writeStatus"],
        "encounterUuid": openmrs.get("encounterUuid"),
        "message": openmrs["message"],
        "openmrs": openmrs,
    }


def build_openmrs_draft_integration(
    body: dict[str, Any], record: dict[str, Any], context: dict[str, Any]
) -> dict[str, Any]:
    write_requested = _write_requested(body)
    payload = _build_encounter_payload(body, record.get("draft") or {}, record.get("redactedTranscript"))
    missing = _openmrs_missing_write_config(body)
    patient_uuid = str(body.get("patientUuid") or record.get("patientUuid") or "").strip()
    auth_headers = _openmrs_auth_headers(context)

    result: dict[str, Any] = {
        "writeRequested": write_requested,
        "writeEnabled": OPENMRS_DRAFT_WRITE_ENABLED,
        "writeStatus": "queued_only",
        "message": "Draft queued locally for clinician review. It has not been written to OpenMRS.",
        "restBase": f"{OPENMRS_BASE_URL}/ws/rest/v1",
        "authSource": _auth_source(context),
        "authenticated": None,
        "requiredConfiguration": missing,
        "encounterPayload": payload,
    }

    if not write_requested:
        return result

    if not OPENMRS_DRAFT_WRITE_ENABLED:
        result.update(
            {
                "writeStatus": "disabled",
                "message": "OpenMRS write mode is disabled. Set OPENMRS_DRAFT_WRITE_ENABLED=true after configuring encounter metadata.",
            }
        )
        return result

    if not patient_uuid:
        result.update(
            {
                "writeStatus": "missing_patient",
                "message": "OpenMRS write requested, but patientUuid was not supplied.",
            }
        )
        return result

    if missing:
        result.update(
            {
                "writeStatus": "not_configured",
                "message": "OpenMRS write requested, but required encounter metadata is missing.",
            }
        )
        return result

    if not auth_headers:
        result.update(
            {
                "writeStatus": "auth_required",
                "message": "OpenMRS write requested, but no OpenMRS Authorization header, session cookie, or server credentials were available.",
            }
        )
        return result

    session = _openmrs_request("session", headers=auth_headers)
    result["session"] = session
    result["authenticated"] = bool(isinstance(session.get("body"), dict) and session["body"].get("authenticated"))
    result["user"] = _safe_user(session.get("body", {}).get("user") if isinstance(session.get("body"), dict) else None)
    if not session["ok"] or not result["authenticated"]:
        result.update(
            {
                "writeStatus": "auth_required",
                "message": "OpenMRS did not accept the provided session or credentials.",
            }
        )
        return result

    patient_resource = urllib.parse.quote(patient_uuid, safe="")
    patient = _openmrs_request(f"patient/{patient_resource}?v=ref", headers=auth_headers)
    result["patientCheck"] = patient
    if not patient["ok"]:
        result.update(
            {
                "writeStatus": "patient_not_found",
                "message": "OpenMRS could not load the requested patient before creating the encounter.",
            }
        )
        return result

    create = _openmrs_request("encounter", method="POST", payload=payload, headers=auth_headers, timeout=10)
    result["createEncounter"] = create
    if create["ok"]:
        body_payload = create.get("body") if isinstance(create.get("body"), dict) else {}
        result.update(
            {
                "writeStatus": "created",
                "encounterUuid": body_payload.get("uuid"),
                "message": "Draft encounter created in OpenMRS for clinician review.",
            }
        )
    else:
        result.update(
            {
                "writeStatus": "failed",
                "message": "OpenMRS rejected the encounter create request.",
            }
        )
    return result


def redact_phi(text: str, names: list[Any] | None = None) -> str:
    result = text
    for name in names or []:
        if not name:
            continue
        name_text = str(name).strip()
        if len(name_text) >= 2:
            result = re.sub(re.escape(name_text), "[REDACTED_NAME]", result, flags=re.IGNORECASE)

    replacements = [
        (r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", "[REDACTED_EMAIL]"),
        (r"(?<!\w)(?:\+?\d[\d .()\-]{7,}\d)(?!\w)", "[REDACTED_PHONE]"),
        (r"\b(?:OpenMRS ID|patient id|national id|document id|ID)\s*[:#]?\s*[A-Z0-9-]+\b", "[REDACTED_ID]"),
        (r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b", "[REDACTED_DATE]"),
    ]
    for pattern, replacement in replacements:
        result = re.sub(pattern, replacement, result, flags=re.IGNORECASE)
    return result


def _build_encounter_payload(
    body: dict[str, Any], draft: dict[str, Any], redacted_transcript: str | None
) -> dict[str, Any]:
    normalized = _normalize_draft(draft if isinstance(draft, dict) else {})
    encounter_datetime = str(body.get("encounterDatetime") or _openmrs_datetime())
    patient_uuid = str(body.get("patientUuid") or "").strip()
    encounter_type = _body_or_env(body, "encounterTypeUuid", OPENMRS_ENCOUNTER_TYPE_UUID)
    location = _body_or_env(body, "locationUuid", OPENMRS_LOCATION_UUID)
    provider = _body_or_env(body, "providerUuid", OPENMRS_PROVIDER_UUID)
    encounter_role = _body_or_env(body, "encounterRoleUuid", OPENMRS_ENCOUNTER_ROLE_UUID)
    draft_obs_concept = _body_or_env(body, "draftObsConceptUuid", OPENMRS_DRAFT_OBS_CONCEPT_UUID)

    payload: dict[str, Any] = {
        "encounterDatetime": encounter_datetime,
        "patient": patient_uuid,
        "encounterType": encounter_type,
        "location": location,
    }
    if body.get("visitUuid"):
        payload["visit"] = body["visitUuid"]
    if provider and encounter_role:
        payload["encounterProviders"] = [{"provider": provider, "encounterRole": encounter_role}]
    if draft_obs_concept:
        payload["obs"] = [
            {
                "concept": draft_obs_concept,
                "obsDatetime": encounter_datetime,
                "value": _draft_text(normalized, redacted_transcript),
                "comment": "OpenMRS LiveKit AI draft. Clinician review required before relying on this note.",
            }
        ]

    return {key: value for key, value in payload.items() if value not in (None, "", [])}


def _openmrs_write_status() -> dict[str, Any]:
    missing = _openmrs_missing_write_config({})
    if OPENMRS_DRAFT_WRITE_ENABLED and not missing:
        status = "configured"
    elif OPENMRS_DRAFT_WRITE_ENABLED:
        status = "not_configured"
    else:
        status = "disabled"
    return {
        "status": status,
        "enabled": OPENMRS_DRAFT_WRITE_ENABLED,
        "requiredConfiguration": missing,
        "optionalConfiguration": ["OPENMRS_PROVIDER_UUID", "OPENMRS_ENCOUNTER_ROLE_UUID"],
        "contract": "POST /openmrs/draft",
        "restBase": f"{OPENMRS_BASE_URL}/ws/rest/v1",
    }


def _openmrs_missing_write_config(body: dict[str, Any] | None = None) -> list[str]:
    body = body or {}
    required = [
        ("OPENMRS_ENCOUNTER_TYPE_UUID or encounterTypeUuid", _body_or_env(body, "encounterTypeUuid", OPENMRS_ENCOUNTER_TYPE_UUID)),
        ("OPENMRS_LOCATION_UUID or locationUuid", _body_or_env(body, "locationUuid", OPENMRS_LOCATION_UUID)),
        ("OPENMRS_DRAFT_OBS_CONCEPT_UUID or draftObsConceptUuid", _body_or_env(body, "draftObsConceptUuid", OPENMRS_DRAFT_OBS_CONCEPT_UUID)),
    ]
    return [name for name, value in required if not value]


def _body_or_env(body: dict[str, Any], body_key: str, env_value: str) -> str:
    value = body.get(body_key)
    if value is None:
        return env_value
    return str(value).strip() or env_value


def _write_requested(body: dict[str, Any]) -> bool:
    if body.get("writeToOpenmrs") is True:
        return True
    return str(body.get("mode") or body.get("openmrsWrite") or "").lower() in {"write", "true", "enabled"}


def _openmrs_auth_headers(context: dict[str, Any]) -> dict[str, str]:
    headers: dict[str, str] = {}
    if OPENMRS_BASIC_AUTH:
        headers["Authorization"] = (
            OPENMRS_BASIC_AUTH
            if OPENMRS_BASIC_AUTH.lower().startswith(("basic ", "bearer "))
            else f"Basic {OPENMRS_BASIC_AUTH}"
        )
    elif OPENMRS_USERNAME and OPENMRS_PASSWORD:
        token = base64.b64encode(f"{OPENMRS_USERNAME}:{OPENMRS_PASSWORD}".encode("utf-8")).decode("ascii")
        headers["Authorization"] = f"Basic {token}"
    elif context.get("authorization"):
        headers["Authorization"] = str(context["authorization"])

    if context.get("cookie"):
        headers["Cookie"] = str(context["cookie"])
    return headers


def _auth_source(context: dict[str, Any]) -> str:
    if OPENMRS_BASIC_AUTH or (OPENMRS_USERNAME and OPENMRS_PASSWORD):
        return "server_credentials"
    if context.get("authorization"):
        return "request_authorization"
    if context.get("cookie"):
        return "request_cookie"
    return "none"


def _openmrs_request(
    resource: str,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 5,
) -> dict[str, Any]:
    resource_path = resource.lstrip("/")
    url = f"{OPENMRS_BASE_URL}/ws/rest/v1/{resource_path}"
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request_headers = {"Accept": "application/json"}
    if data is not None:
        request_headers["Content-Type"] = "application/json"
    request_headers.update(headers or {})
    request = urllib.request.Request(url, data=data, headers=request_headers, method=method)

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8", "replace")
            body = _parse_json(raw)
            status = response.getcode()
            return {"ok": 200 <= status < 300, "status": status, "body": body, "url": url}
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", "replace")
        return {"ok": False, "status": error.code, "body": _parse_json(raw), "url": url}
    except Exception as error:
        return {
            "ok": False,
            "status": None,
            "body": {"error": f"{type(error).__name__}: {str(error)[:180]}"},
            "url": url,
        }


def _safe_user(user: Any) -> dict[str, Any] | None:
    if not isinstance(user, dict):
        return None
    return {key: user.get(key) for key in ("uuid", "display") if user.get(key)}


def _draft_text(draft: dict[str, Any], redacted_transcript: str | None) -> str:
    lines = [
        "AI-generated clinical draft. Clinician review required.",
        f"Chief complaint: {draft.get('chiefComplaint') or ''}",
        f"Symptoms: {_list_text(draft.get('symptoms'))}",
        f"Medications mentioned: {_list_text(draft.get('medicationsMentioned'))}",
        f"Allergies mentioned: {_list_text(draft.get('allergiesMentioned'))}",
        f"Assessment notes: {draft.get('assessmentNotes') or ''}",
        f"Patient instructions: {draft.get('patientInstructions') or ''}",
    ]
    if redacted_transcript:
        lines.extend(["", "Redacted transcript excerpt:", str(redacted_transcript)[:2000]])
    return "\n".join(lines).strip()


def _list_text(value: Any) -> str:
    if isinstance(value, list):
        return ", ".join(str(item) for item in value if item)
    return str(value or "")


def _openmrs_datetime() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000+0000")


def _parse_json(raw: str) -> Any:
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"raw": raw[:1200]}


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


def _first_command(candidates: list[str]) -> str | None:
    for candidate in candidates:
        path = shutil.which(candidate)
        if path:
            return candidate
    return None


def _language_name(code: str) -> str:
    return {
        "en": "English",
        "es": "Spanish",
        "fr": "French",
        "pt": "Portuguese",
        "sw": "Swahili",
    }.get(code.lower(), code)
