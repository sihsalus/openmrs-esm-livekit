#!/usr/bin/env python3
"""HTTP e2e contract tests for the local OpenMRS LiveKit helper."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import stat
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
TOKEN_SERVER = ROOT / "token-server" / "server.py"
sys.path.insert(0, str(TOKEN_SERVER.parent))
import local_ai  # noqa: E402
import server as token_server  # noqa: E402


def free_port() -> int:
    server = ThreadingHTTPServer(("127.0.0.1", 0), BaseHTTPRequestHandler)
    port = int(server.server_address[1])
    server.server_close()
    return port


class FakeOpenMRSHandler(BaseHTTPRequestHandler):
    encounter_payloads: list[dict[str, Any]] = []

    def do_GET(self):
        if self.path.startswith("/openmrs/ws/rest/v1/session"):
            authenticated = bool(self.headers.get("Authorization") or self.headers.get("Cookie"))
            self.send_json(
                {
                    "authenticated": authenticated,
                    "user": {"uuid": "user-uuid", "display": "Demo Clinician"} if authenticated else None,
                }
            )
            return
        if self.path.startswith("/openmrs/ws/rest/v1/patient/"):
            if not self.headers.get("Authorization") and not self.headers.get("Cookie"):
                self.send_json({"error": "auth required"}, status=401)
                return
            self.send_json({"uuid": "patient-uuid", "display": "Synthetic Patient"})
            return
        if self.path.startswith("/openmrs/ws/rest/v1/encountertype/"):
            if not self.headers.get("Authorization") and not self.headers.get("Cookie"):
                self.send_json({"error": "auth required"}, status=401)
                return
            self.send_json(
                {
                    "uuid": "encounter-type-uuid",
                    "display": "Visit Note",
                    "name": "Visit Note",
                    "retired": False,
                }
            )
            return
        if self.path.startswith("/openmrs/ws/rest/v1/location/"):
            if not self.headers.get("Authorization") and not self.headers.get("Cookie"):
                self.send_json({"error": "auth required"}, status=401)
                return
            self.send_json(
                {
                    "uuid": "location-uuid",
                    "display": "Outpatient Clinic",
                    "name": "Outpatient Clinic",
                    "retired": False,
                }
            )
            return
        if self.path.startswith("/openmrs/ws/rest/v1/concept/"):
            if not self.headers.get("Authorization") and not self.headers.get("Cookie"):
                self.send_json({"error": "auth required"}, status=401)
                return
            self.send_json(
                {
                    "uuid": "obs-concept-uuid",
                    "display": "Text of encounter note",
                    "name": "Text of encounter note",
                    "retired": False,
                    "datatype": {"display": "Text", "name": "Text"},
                    "conceptClass": {"display": "Misc", "name": "Misc"},
                }
            )
            return
        if self.path.startswith("/openmrs/ws/rest/v1/visit/"):
            if not self.headers.get("Authorization") and not self.headers.get("Cookie"):
                self.send_json({"error": "auth required"}, status=401)
                return
            visit_uuid = self.path.split("/visit/", 1)[1].split("?", 1)[0]
            if visit_uuid == "active-visit-uuid":
                self.send_json(
                    {
                        "uuid": "active-visit-uuid",
                        "patient": {"uuid": "patient-uuid"},
                        "stopDatetime": None,
                    }
                )
                return
            self.send_json(
                {
                    "uuid": visit_uuid,
                    "patient": {"uuid": "patient-uuid"},
                    "stopDatetime": "2026-07-06T10:00:00.000+0000",
                }
            )
            return
        self.send_json({"error": "not found", "path": self.path}, status=404)

    def do_POST(self):
        if self.path == "/openmrs/ws/rest/v1/encounter":
            payload = self.read_json()
            FakeOpenMRSHandler.encounter_payloads.append(payload)
            self.send_json({"uuid": "encounter-created", "display": "AI Draft Encounter"}, status=201)
            return
        self.send_json({"error": "not found", "path": self.path}, status=404)

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", 0))
        if not length:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def send_json(self, payload: dict[str, Any], status: int = 200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode("utf-8"))

    def log_message(self, *_args):
        return


class FakeOpenMRSLoginHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(b"<!doctype html><title>OpenMRS Login</title>")

    def log_message(self, *_args):
        return


class FakeOllamaHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/tags":
            self.send_json({"models": [{"name": "medgemma:test"}]})
            return
        self.send_json({"error": "not found"}, status=404)

    def do_POST(self):
        if self.path == "/api/generate":
            content_length = int(self.headers.get("Content-Length", "0"))
            request_body = self.rfile.read(content_length).decode("utf-8") if content_length else ""
            draft = {
                "chiefComplaint": "cough and fever",
                "symptoms": ["cough", "fever"],
                "medicationsMentioned": ["paracetamol"],
                "allergiesMentioned": [],
                "assessmentNotes": "Clinician review required.",
                "patientInstructions": "Return if breathing worsens.",
            }
            if "empty-medication-extraction-test" in request_body:
                draft["medicationsMentioned"] = []
            self.send_json(
                {
                    "response": json.dumps(draft)
                }
            )
            return
        self.send_json({"error": "not found"}, status=404)

    def send_json(self, payload: dict[str, Any], status: int = 200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode("utf-8"))

    def log_message(self, *_args):
        return


class FakeLiveKitHandler(BaseHTTPRequestHandler):
    room_requests: list[dict[str, Any]] = []

    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")

    def do_POST(self):
        if self.path.startswith("/twirp/livekit.RoomService/"):
            payload = self.read_json()
            self.room_requests.append(
                {
                    "path": self.path,
                    "payload": payload,
                    "authorization": self.headers.get("Authorization"),
                }
            )
            self.send_json({})
            return
        self.send_json({"error": "not found", "path": self.path}, status=404)

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", 0))
        if not length:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def send_json(self, payload: dict[str, Any], status: int = 200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode("utf-8"))

    def log_message(self, *_args):
        return


def start_server(handler: type[BaseHTTPRequestHandler]) -> tuple[ThreadingHTTPServer, str]:
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port = int(server.server_address[1])
    import threading

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, f"http://127.0.0.1:{port}"


DEFAULT_AUTH_HEADER = "Basic " + base64.b64encode(b"admin:Admin123").decode("ascii")


def request_json(
    base_url: str,
    path: str,
    payload: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    authenticated: bool = True,
):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request_headers = {"Content-Type": "application/json", **(headers or {})}
    if authenticated and "Authorization" not in request_headers:
        request_headers["Authorization"] = DEFAULT_AUTH_HEADER
    request = urllib.request.Request(
        f"{base_url}{path}",
        data=data,
        headers=request_headers,
        method="POST" if payload is not None else "GET",
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read().decode("utf-8")), response


def read_http_error_json(error: urllib.error.HTTPError) -> dict[str, Any]:
    try:
        return json.loads(error.read().decode("utf-8"))
    finally:
        error.close()


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def decode_jwt_json(part: str) -> dict[str, Any]:
    padding = "=" * (-len(part) % 4)
    return json.loads(base64.urlsafe_b64decode(f"{part}{padding}").decode("utf-8"))


def base64url_bytes(payload: bytes) -> str:
    return base64.urlsafe_b64encode(payload).rstrip(b"=").decode("ascii")


def run_token_server_startup(
    env_overrides: dict[str, str],
    env_removals: tuple[str, ...] = (),
) -> tuple[int | None, str]:
    env = os.environ.copy()
    for key in env_removals:
        env.pop(key, None)
    env.update(env_overrides)
    process = subprocess.Popen(
        [sys.executable, str(TOKEN_SERVER)],
        cwd=str(TOKEN_SERVER.parent),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    output, _stderr = process.communicate(timeout=5)
    return process.returncode, output


class TokenServerE2ETest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        FakeOpenMRSHandler.encounter_payloads = []
        FakeLiveKitHandler.room_requests = []
        cls.openmrs_server, cls.openmrs_url = start_server(FakeOpenMRSHandler)
        cls.ollama_server, cls.ollama_url = start_server(FakeOllamaHandler)
        cls.livekit_server, cls.livekit_url = start_server(FakeLiveKitHandler)
        cls.agent_server, cls.agent_url = start_server(FakeLiveKitHandler)
        cls.tempdir = tempfile.TemporaryDirectory()
        cls.port = free_port()
        cls.base_url = f"http://127.0.0.1:{cls.port}"

        env = os.environ.copy()
        env.update(
            {
                "TOKEN_SERVER_PORT": str(cls.port),
                "TOKEN_SERVER_ENV": "production",
                "TOKEN_SERVER_REQUIRE_OPENMRS_SESSION": "true",
                "TOKEN_SERVER_ALLOWED_ORIGINS": "https://openmrs.test",
                "LIVEKIT_API_KEY": "test-key",
                "LIVEKIT_API_SECRET": "test-secret",
                "OLLAMA_URL": cls.ollama_url,
                "OLLAMA_MODEL": "medgemma:test",
                "OPENMRS_BASE_URL": f"{cls.openmrs_url}/openmrs",
                "LIVEKIT_HTTP_URL": cls.livekit_url,
                "LIVEKIT_AGENT_HEALTH_URL": f"{cls.agent_url}/metrics",
                "LIVEKIT_AGENT_LLM_PROVIDER": "ollama",
                "LIVEKIT_AGENT_STT_PROVIDER": "whisper",
                "LIVEKIT_AGENT_TTS_PROVIDER": "piper",
                "AI_RUNTIME_CONFIG_PATH": str(Path(cls.tempdir.name) / "ai-runtime-config.json"),
                "DRAFT_STORE_PATH": str(Path(cls.tempdir.name) / "drafts.jsonl"),
                "RECORDING_MANIFEST_PATH": str(Path(cls.tempdir.name) / "recordings.jsonl"),
                "AUDIT_LOG_PATH": str(Path(cls.tempdir.name) / "audit.jsonl"),
                "AUDIT_HASH_SALT": "test-audit-salt",
                "OPENMRS_DRAFT_WRITE_ENABLED": "true",
                "OPENMRS_ENCOUNTER_TYPE_UUID": "encounter-type-uuid",
                "OPENMRS_LOCATION_UUID": "location-uuid",
                "OPENMRS_PROVIDER_UUID": "provider-uuid",
                "OPENMRS_ENCOUNTER_ROLE_UUID": "encounter-role-uuid",
                "OPENMRS_DRAFT_OBS_CONCEPT_UUID": "obs-concept-uuid",
                "OPENMRS_STRUCTURED_OBS_CONCEPTS": json.dumps(
                    {
                        "chiefComplaint": "chief-complaint-concept-uuid",
                        "symptoms": "symptom-concept-uuid",
                        "medicationsMentioned": "medication-concept-uuid",
                        "patientInstructions": "instructions-concept-uuid",
                    }
                ),
                "OPENMRS_USERNAME": "admin",
                "OPENMRS_PASSWORD": "Admin123",
            }
        )
        cls.process = subprocess.Popen(
            [sys.executable, str(TOKEN_SERVER)],
            cwd=str(TOKEN_SERVER.parent),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        deadline = time.time() + 10
        while time.time() < deadline:
            try:
                request_json(cls.base_url, "/health")
                return
            except Exception:
                if cls.process.poll() is not None:
                    output = cls.process.stdout.read() if cls.process.stdout else ""
                    raise RuntimeError(f"token server exited early:\n{output}")
                time.sleep(0.1)
        raise RuntimeError("token server did not start")

    def setUp(self):
        runtime_config_path = Path(self.tempdir.name) / "ai-runtime-config.json"
        runtime_config_path.unlink(missing_ok=True)

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        try:
            cls.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.process.kill()
            cls.process.wait(timeout=5)
        if cls.process.stdout:
            cls.process.stdout.close()
        cls.openmrs_server.shutdown()
        cls.openmrs_server.server_close()
        cls.ollama_server.shutdown()
        cls.ollama_server.server_close()
        cls.livekit_server.shutdown()
        cls.livekit_server.server_close()
        cls.agent_server.shutdown()
        cls.agent_server.server_close()
        cls.tempdir.cleanup()

    def test_health_reports_local_services_and_contracts(self):
        payload, _response = request_json(self.base_url, "/health")
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["services"]["livekitTokenSigning"]["status"], "configured")
        self.assertEqual(payload["services"]["livekitRoomMetadata"]["status"], "configured")
        self.assertEqual(payload["services"]["tokenServerAuth"]["status"], "enforced")
        self.assertTrue(payload["services"]["tokenServerAuth"]["openmrsSessionRequired"])
        self.assertEqual(payload["services"]["cors"]["status"], "configured")
        self.assertEqual(payload["services"]["cors"]["allowedOrigins"], ["https://openmrs.test"])
        self.assertEqual(payload["services"]["productionReadiness"]["status"], "enforced")
        self.assertEqual(payload["services"]["agent"]["status"], "ok")
        self.assertEqual(payload["services"]["agent"]["contract"], "LiveKit data-channel topic agent-data")
        self.assertEqual(payload["services"]["stt"]["scope"], "helper_endpoint")
        self.assertEqual(payload["services"]["tts"]["scope"], "helper_endpoint")
        self.assertEqual(payload["services"]["agentCapabilities"]["status"], "configured")
        self.assertEqual(payload["services"]["agentCapabilities"]["source"], "livekit-agent")
        self.assertEqual(payload["services"]["agentCapabilities"]["stt"]["provider"], "whisper")
        self.assertEqual(payload["services"]["agentCapabilities"]["stt"]["scope"], "livekit_agent")
        self.assertEqual(payload["services"]["agentCapabilities"]["tts"]["provider"], "piper")
        self.assertEqual(payload["services"]["agentCapabilities"]["llm"]["provider"], "ollama")
        self.assertEqual(payload["services"]["aiRuntimeConfig"]["status"], "configured")
        self.assertEqual(payload["services"]["aiRuntimeConfig"]["config"]["sttProvider"], "whisper")
        self.assertEqual(payload["services"]["aiRuntimeConfig"]["config"]["ttsProvider"], "piper")
        self.assertFalse(
            payload["services"]["aiRuntimeConfig"]["secrets"]["deepgramApiKeyConfigured"]
        )
        self.assertEqual(payload["stt"], "configured")
        self.assertEqual(payload["tts"], "configured")
        self.assertEqual(payload["helperStt"], "not_configured")
        self.assertEqual(payload["helperTts"], "not_configured")
        self.assertEqual(payload["services"]["openmrsDraftWrite"]["status"], "configured")
        self.assertEqual(payload["services"]["draftAudit"]["status"], "enabled")
        self.assertFalse(payload["services"]["draftAudit"]["rawClinicalTextStored"])
        self.assertTrue(payload["services"]["draftAudit"]["hashSaltConfigured"])
        self.assertIn("pediatric-respiratory", payload["services"]["syntheticData"]["cases"])
        self.assertEqual(payload["services"]["recording"]["status"], "manifest_only")
        self.assertEqual(payload["services"]["localStorage"]["status"], "private_files")
        self.assertEqual(payload["services"]["localStorage"]["fileMode"], "0600")
        self.assertTrue(payload["services"]["localStorage"]["auditLogPath"].endswith("audit.jsonl"))

    def test_token_requires_authenticated_openmrs_session_when_enabled(self):
        with self.assertRaises(urllib.error.HTTPError) as context:
            request_json(
                self.base_url,
                "/token",
                {"patientUuid": "patient-uuid", "roomPrefix": "openmrs-room-"},
                authenticated=False,
            )

        self.assertEqual(context.exception.code, 401)
        payload = read_http_error_json(context.exception)
        self.assertEqual(payload["code"], "openmrs_session_required")

    def test_synthetic_consultation_requires_authenticated_openmrs_session_when_enabled(self):
        with self.assertRaises(urllib.error.HTTPError) as context:
            request_json(
                self.base_url,
                "/synthetic-consultation",
                {"caseId": "pediatric-respiratory"},
                authenticated=False,
            )

        self.assertEqual(context.exception.code, 401)
        payload = read_http_error_json(context.exception)
        self.assertEqual(payload["code"], "openmrs_session_required")

    def test_admin_draft_get_endpoints_require_authenticated_openmrs_session(self):
        with self.assertRaises(urllib.error.HTTPError) as context:
            request_json(self.base_url, "/openmrs/draft/config", authenticated=False)

        self.assertEqual(context.exception.code, 401)
        payload = read_http_error_json(context.exception)
        self.assertEqual(payload["code"], "openmrs_session_required")

    def test_openmrs_probe_treats_login_html_as_reachable(self):
        server, base_url = start_server(FakeOpenMRSLoginHandler)
        try:
            payload = local_ai._probe_http(f"{base_url}/openmrs/ws/rest/v1/session", expect_json=True)
        finally:
            server.shutdown()
            server.server_close()

        self.assertEqual(payload["status"], "ok")
        self.assertFalse(payload["json"])
        self.assertEqual(payload["contentType"], "text/html")

    def test_token_is_hmac_signed_and_does_not_expose_secret(self):
        FakeLiveKitHandler.room_requests = []
        payload, _response = request_json(
            self.base_url,
            "/token",
            {
                "patientUuid": "patient-123",
                "roomPrefix": "openmrs-room-",
                "visitUuid": "active-visit-uuid",
                "doctorLanguage": "es",
                "patientLanguage": "en",
                "agentVoiceLanguage": "en",
            },
        )
        token = payload["token"]
        header_part, claims_part, signature_part = token.split(".")
        header = decode_jwt_json(header_part)
        claims = decode_jwt_json(claims_part)
        expected_signature = base64url_bytes(
            hmac.new(
                b"test-secret",
                f"{header_part}.{claims_part}".encode("ascii"),
                hashlib.sha256,
            ).digest()
        )

        self.assertEqual(header["alg"], "HS256")
        self.assertEqual(header["kid"], "test-key")
        self.assertEqual(claims["iss"], "test-key")
        self.assertEqual(claims["video"]["room"], payload["roomName"])
        self.assertEqual(claims["video"]["roomJoin"], True)
        participant_metadata = json.loads(claims["metadata"])
        self.assertEqual(participant_metadata["patientUuid"], "patient-123")
        self.assertEqual(participant_metadata["visitUuid"], "active-visit-uuid")
        self.assertEqual(participant_metadata["doctorLanguage"], "es")
        self.assertEqual(participant_metadata["patientLanguage"], "en")
        self.assertEqual(participant_metadata["agentVoiceLanguage"], "en")
        self.assertEqual(participant_metadata["captureRole"], "doctor")
        self.assertEqual(participant_metadata["participantRole"], "doctor")
        self.assertEqual(participant_metadata["speakerAttributionMode"], "source-role")
        self.assertEqual(participant_metadata["agentProviderOverrides"]["sttProvider"], "whisper")
        self.assertEqual(participant_metadata["agentProviderOverrides"]["ttsProvider"], "piper")
        self.assertEqual(signature_part, expected_signature)
        self.assertNotIn("test-secret", token)
        self.assertEqual(payload["roomMetadata"]["status"], "ok")

        self.assertEqual(len(FakeLiveKitHandler.room_requests), 1)
        room_request = FakeLiveKitHandler.room_requests[0]
        self.assertEqual(room_request["path"], "/twirp/livekit.RoomService/CreateRoom")
        self.assertTrue(room_request["authorization"].startswith("Bearer "))
        self.assertEqual(room_request["payload"]["name"], payload["roomName"])
        room_metadata = json.loads(room_request["payload"]["metadata"])
        self.assertEqual(room_metadata["patientUuid"], "patient-123")
        self.assertEqual(room_metadata["visitUuid"], "active-visit-uuid")
        self.assertEqual(room_metadata["roomPrefix"], "openmrs-room-")
        self.assertEqual(room_metadata["doctorLanguage"], "es")
        self.assertEqual(room_metadata["patientLanguage"], "en")
        self.assertEqual(room_metadata["agentVoiceLanguage"], "en")
        self.assertEqual(room_metadata["languageMode"], "bilingual")
        self.assertEqual(room_metadata["speakerAttributionMode"], "source-role")
        self.assertEqual(room_metadata["defaultHumanRole"], "doctor")
        self.assertEqual(room_metadata["agentProviderOverrides"]["sttProvider"], "whisper")
        self.assertEqual(room_metadata["agentProviderOverrides"]["ttsProvider"], "piper")

    def test_ai_runtime_config_rejects_unconfigured_cloud_provider(self):
        with self.assertRaises(urllib.error.HTTPError) as context:
            request_json(
                self.base_url,
                "/ai/runtime-config",
                {
                    "sttProvider": "deepgram",
                    "ttsProvider": "piper",
                    "deepgramModel": "nova-3",
                    "deepgramEnableDiarization": True,
                    "deepgramUseFlux": False,
                    "inworldModel": "inworld-tts-2",
                },
            )

        self.assertEqual(context.exception.code, 400)
        payload = read_http_error_json(context.exception)
        self.assertIn("DEEPGRAM_API_KEY is required", payload["error"])

    def test_ai_runtime_config_save_uses_private_json_file(self):
        payload, _response = request_json(
            self.base_url,
            "/ai/runtime-config",
            {
                "sttProvider": "whisper",
                "ttsProvider": "piper",
                "deepgramModel": "nova-3",
                "deepgramEnableDiarization": True,
                "deepgramUseFlux": False,
                "inworldModel": "inworld-tts-2",
            },
        )

        runtime_config_path = Path(self.tempdir.name) / "ai-runtime-config.json"
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(stat.S_IMODE(runtime_config_path.stat().st_mode), 0o600)
        stored = json.loads(runtime_config_path.read_text(encoding="utf-8"))
        self.assertEqual(stored["sttProvider"], "whisper")
        self.assertEqual(stored["ttsProvider"], "piper")

    def test_speaker_attribution_mode_requires_deepgram_diarization_without_flux(self):
        self.assertEqual(
            token_server.speaker_attribution_mode_for_config(
                {
                    "sttProvider": "deepgram",
                    "deepgramEnableDiarization": True,
                    "deepgramUseFlux": False,
                }
            ),
            "source-role+stt-speaker-id",
        )
        self.assertEqual(
            token_server.speaker_attribution_mode_for_config(
                {
                    "sttProvider": "deepgram",
                    "deepgramEnableDiarization": True,
                    "deepgramUseFlux": True,
                }
            ),
            "source-role",
        )

    def test_token_normalizes_unsupported_language_metadata(self):
        FakeLiveKitHandler.room_requests = []
        payload, _response = request_json(
            self.base_url,
            "/token",
            {
                "patientUuid": "patient-456",
                "roomPrefix": "openmrs-room-",
                "doctorLanguage": "es-PE",
                "patientLanguage": "fr",
                "agentVoiceLanguage": "en-US",
                "captureRole": "patient",
            },
        )

        token = payload["token"]
        _header_part, claims_part, _signature_part = token.split(".")
        claims = decode_jwt_json(claims_part)
        participant_metadata = json.loads(claims["metadata"])
        self.assertEqual(participant_metadata["doctorLanguage"], "es")
        self.assertEqual(participant_metadata["patientLanguage"], "es")
        self.assertEqual(participant_metadata["agentVoiceLanguage"], "en")
        self.assertEqual(participant_metadata["captureRole"], "patient")
        self.assertEqual(participant_metadata["participantRole"], "patient")
        self.assertEqual(participant_metadata["role"], "patient")

        room_metadata = json.loads(FakeLiveKitHandler.room_requests[0]["payload"]["metadata"])
        self.assertEqual(room_metadata["doctorLanguage"], "es")
        self.assertEqual(room_metadata["patientLanguage"], "es")
        self.assertEqual(room_metadata["agentVoiceLanguage"], "en")
        self.assertEqual(room_metadata["languageMode"], "single-language")
        self.assertEqual(room_metadata["defaultHumanRole"], "patient")

    def test_token_defaults_to_english_when_openmrs_locale_is_not_provided(self):
        FakeLiveKitHandler.room_requests = []
        payload, _response = request_json(
            self.base_url,
            "/token",
            {
                "patientUuid": "patient-789",
                "roomPrefix": "openmrs-room-",
            },
        )

        _header_part, claims_part, _signature_part = payload["token"].split(".")
        claims = decode_jwt_json(claims_part)
        participant_metadata = json.loads(claims["metadata"])
        self.assertEqual(participant_metadata["doctorLanguage"], "en")
        self.assertEqual(participant_metadata["patientLanguage"], "en")
        self.assertEqual(participant_metadata["agentVoiceLanguage"], "en")

        room_metadata = json.loads(FakeLiveKitHandler.room_requests[0]["payload"]["metadata"])
        self.assertEqual(room_metadata["doctorLanguage"], "en")
        self.assertEqual(room_metadata["patientLanguage"], "en")
        self.assertEqual(room_metadata["agentVoiceLanguage"], "en")
        self.assertEqual(room_metadata["languageMode"], "single-language")

    def test_compile_encounter_redacts_phi_and_uses_local_ollama_contract(self):
        payload, _response = request_json(
            self.base_url,
            "/compile-encounter",
            {
                "patientName": "Sofia Demo",
                "transcript": (
                    "Sofia Demo email sofia@example.test phone +51 999 888 777 "
                    "OpenMRS ID: 100008E has cough and fever. "
                    "Paciente: Maria Fernanda Quispe. H.C. A-998877. "
                    "Direccion Av. Los Incas 123, Cusco. Control el 5 de julio de 2026."
                ),
            },
        )
        self.assertEqual(payload["engine"], "ollama")
        self.assertIn("[REDACTED_NAME]", payload["redactedTranscript"])
        self.assertIn("[REDACTED_EMAIL]", payload["redactedTranscript"])
        self.assertIn("[REDACTED_PHONE]", payload["redactedTranscript"])
        self.assertIn("[REDACTED_ID]", payload["redactedTranscript"])
        self.assertIn("[REDACTED_ADDRESS]", payload["redactedTranscript"])
        self.assertIn("[REDACTED_DATE]", payload["redactedTranscript"])
        self.assertNotIn("Maria Fernanda Quispe", payload["redactedTranscript"])
        self.assertNotIn("A-998877", payload["redactedTranscript"])
        self.assertNotIn("Av. Los Incas 123", payload["redactedTranscript"])
        self.assertNotIn("5 de julio de 2026", payload["redactedTranscript"])
        self.assertEqual(payload["draft"]["symptoms"], ["cough", "fever"])

    def test_compile_encounter_preserves_obvious_medications_when_ollama_omits_them(self):
        payload, _response = request_json(
            self.base_url,
            "/compile-encounter",
            {
                "transcript": (
                    "empty-medication-extraction-test. "
                    "Doctor: Patient reports cough for five days. "
                    "Current medication is paracetamol 500 mg every 8 hours. "
                    "No known drug allergies."
                ),
            },
        )

        self.assertEqual(payload["engine"], "ollama")
        self.assertIn("paracetamol", payload["draft"]["medicationsMentioned"])

    def test_compile_encounter_requires_transcript(self):
        with self.assertRaises(urllib.error.HTTPError) as context:
            request_json(self.base_url, "/compile-encounter", {"patientName": "Sofia Demo"})

        self.assertEqual(context.exception.code, 400)
        payload = read_http_error_json(context.exception)
        self.assertEqual(payload["status"], "error")
        self.assertIn("Missing transcript or text", payload["error"])

    def test_synthetic_consultation_generates_safe_draft_request(self):
        payload, _response = request_json(
            self.base_url,
            "/synthetic-consultation",
            {"caseId": "pediatric-respiratory", "patientUuid": "synthetic-patient"},
        )
        self.assertTrue(payload["synthetic"])
        self.assertFalse(payload["privacy"]["containsRealPatientData"])
        self.assertIn("[REDACTED_NAME]", payload["redactedTranscript"])
        self.assertEqual(payload["openmrsDraftRequest"]["patientUuid"], "synthetic-patient")

    def test_recording_requires_consent_and_creates_manifest_only(self):
        denied, _response = request_json(self.base_url, "/recording/session", {"roomName": "openmrs-voice-demo"})
        self.assertEqual(denied["status"], "consent_required")

        allowed, _response = request_json(
            self.base_url,
            "/recording/session",
            {"roomName": "openmrs-voice-demo", "patientUuid": "synthetic-patient", "consentCaptured": True},
        )
        self.assertEqual(allowed["recordingStatus"], "manifest_recorded")
        self.assertFalse(allowed["rawAudioStored"])
        self.assertEqual(allowed["mediaRecording"], "not_configured")
        manifest_path = Path(self.tempdir.name) / "recordings.jsonl"
        self.assertEqual(stat.S_IMODE(manifest_path.stat().st_mode), 0o600)

    def test_openmrs_draft_writes_encounter_when_enabled_and_authenticated(self):
        auth = base64.b64encode(b"admin:Admin123").decode("ascii")
        payload, _response = request_json(
            self.base_url,
            "/openmrs/draft",
            {
                "patientUuid": "patient-uuid",
                "visitUuid": "active-visit-uuid",
                "writeToOpenmrs": True,
                "draft": {
                    "chiefComplaint": "cough",
                    "symptoms": ["cough"],
                    "medicationsMentioned": ["paracetamol"],
                    "allergiesMentioned": [],
                    "assessmentNotes": "review",
                    "patientInstructions": "fluids",
                },
                "redactedTranscript": "Doctor: cough",
            },
            headers={"Authorization": f"Basic {auth}"},
        )
        self.assertEqual(payload["status"], "saved")
        self.assertEqual(payload["openmrsWrite"], "created")
        self.assertEqual(payload["encounterUuid"], "encounter-created")
        created = FakeOpenMRSHandler.encounter_payloads[-1]
        self.assertEqual(created["patient"], "patient-uuid")
        self.assertEqual(created["visit"], "active-visit-uuid")
        self.assertEqual(created["encounterType"], "encounter-type-uuid")
        self.assertEqual(created["location"], "location-uuid")
        self.assertEqual(created["encounterProviders"][0]["provider"], "provider-uuid")
        self.assertIn("AI-generated clinical draft", created["obs"][0]["value"])
        structured_obs = {(obs["concept"], obs["value"]) for obs in created["obs"][1:]}
        self.assertIn(("chief-complaint-concept-uuid", "cough"), structured_obs)
        self.assertIn(("symptom-concept-uuid", "cough"), structured_obs)
        self.assertIn(("medication-concept-uuid", "paracetamol"), structured_obs)
        self.assertIn(("instructions-concept-uuid", "fluids"), structured_obs)
        draft_store_path = Path(self.tempdir.name) / "drafts.jsonl"
        self.assertEqual(stat.S_IMODE(draft_store_path.stat().st_mode), 0o600)
        audit_store_path = Path(self.tempdir.name) / "audit.jsonl"
        self.assertEqual(stat.S_IMODE(audit_store_path.stat().st_mode), 0o600)
        audit_event = next(event for event in read_jsonl(audit_store_path) if event["id"] == payload["auditEventId"])
        self.assertEqual(payload["auditEventType"], "draft_saved")
        self.assertEqual(audit_event["eventType"], "draft_saved")
        self.assertEqual(audit_event["draftId"], payload["draftId"])
        self.assertEqual(audit_event["openmrsWrite"], "created")
        self.assertEqual(audit_event["encounterUuid"], "encounter-created")
        self.assertEqual(audit_event["message"], "Draft encounter created in OpenMRS for clinician review.")
        self.assertEqual(audit_event["patientHash"], hashlib.sha256(b"test-audit-salt:patient-uuid").hexdigest())
        self.assertNotIn("draft", audit_event)
        self.assertNotIn("redactedTranscript", audit_event)
        self.assertNotIn("Doctor: cough", json.dumps(audit_event))

    def test_openmrs_draft_config_validates_write_metadata(self):
        payload, _response = request_json(self.base_url, "/openmrs/draft/config")

        self.assertEqual(payload["status"], "validated")
        self.assertTrue(payload["enabled"])
        self.assertEqual(payload["authSource"], "server_credentials")
        self.assertEqual(payload["requiredConfiguration"], [])
        self.assertEqual(payload["validationErrors"], [])
        self.assertEqual(payload["resources"]["encounterType"]["display"], "Visit Note")
        self.assertEqual(payload["resources"]["location"]["display"], "Outpatient Clinic")
        self.assertEqual(payload["resources"]["draftObsConcept"]["datatype"], "Text")
        self.assertFalse(payload["rawClinicalTextStored"])
        self.assertNotIn("Admin123", json.dumps(payload))

    def test_openmrs_draft_write_requires_active_visit(self):
        auth = base64.b64encode(b"admin:Admin123").decode("ascii")
        payload, _response = request_json(
            self.base_url,
            "/openmrs/draft",
            {
                "patientUuid": "patient-uuid",
                "writeToOpenmrs": True,
                "draft": {
                    "chiefComplaint": "cough",
                    "symptoms": ["cough"],
                    "medicationsMentioned": [],
                    "allergiesMentioned": [],
                    "assessmentNotes": "review",
                    "patientInstructions": "fluids",
                },
                "redactedTranscript": "Doctor: cough",
            },
            headers={"Authorization": f"Basic {auth}"},
        )

        self.assertEqual(payload["status"], "queued")
        self.assertEqual(payload["openmrsWrite"], "visit_required")
        self.assertEqual(payload["auditEventType"], "draft_write_rejected")
        audit_event = next(
            event for event in read_jsonl(Path(self.tempdir.name) / "audit.jsonl") if event["id"] == payload["auditEventId"]
        )
        self.assertEqual(audit_event["eventType"], "draft_write_rejected")
        self.assertEqual(audit_event["openmrsWrite"], "visit_required")

    def test_openmrs_draft_queue_creates_minimal_audit_event(self):
        payload, _response = request_json(
            self.base_url,
            "/openmrs/draft",
            {
                "patientUuid": "queued-patient-uuid",
                "draft": {
                    "chiefComplaint": "headache",
                    "symptoms": ["headache"],
                    "medicationsMentioned": [],
                    "allergiesMentioned": [],
                    "assessmentNotes": "review",
                    "patientInstructions": "return precautions",
                },
                "redactedTranscript": "Doctor: headache",
            },
        )

        self.assertEqual(payload["status"], "queued")
        self.assertEqual(payload["openmrsWrite"], "queued_only")
        self.assertEqual(payload["auditEventType"], "draft_queued")
        audit_event = next(
            event for event in read_jsonl(Path(self.tempdir.name) / "audit.jsonl") if event["id"] == payload["auditEventId"]
        )
        self.assertEqual(audit_event["eventType"], "draft_queued")
        self.assertEqual(audit_event["draftId"], payload["draftId"])
        self.assertEqual(audit_event["openmrsWrite"], "queued_only")
        self.assertFalse(audit_event["writeRequested"])
        self.assertEqual(audit_event["patientHash"], hashlib.sha256(b"test-audit-salt:queued-patient-uuid").hexdigest())
        self.assertNotIn("Doctor: headache", json.dumps(audit_event))

    def test_openmrs_draft_audit_endpoint_returns_sanitized_recent_events(self):
        payload, _response = request_json(
            self.base_url,
            "/openmrs/draft",
            {
                "patientUuid": "audit-patient-uuid",
                "writeToOpenmrs": True,
                "draft": {
                    "chiefComplaint": "headache",
                    "symptoms": ["headache"],
                    "medicationsMentioned": [],
                    "allergiesMentioned": [],
                    "assessmentNotes": "review",
                    "patientInstructions": "return precautions",
                },
                "redactedTranscript": "Doctor: headache with private clinical details",
            },
        )
        self.assertEqual(payload["auditEventType"], "draft_write_rejected")

        audit, _response = request_json(self.base_url, "/openmrs/draft/audit?limit=5")
        self.assertEqual(audit["status"], "ok")
        self.assertFalse(audit["rawClinicalTextStored"])
        event = next(event for event in audit["events"] if event["id"] == payload["auditEventId"])
        self.assertEqual(event["eventType"], "draft_write_rejected")
        self.assertEqual(event["openmrsWrite"], "visit_required")
        self.assertIn("active visitUuid", event["message"])
        self.assertNotIn("draft", event)
        self.assertNotIn("redactedTranscript", event)
        self.assertNotIn("Doctor: headache", json.dumps(audit))

    def test_cors_supports_credentialed_o3_requests(self):
        request = urllib.request.Request(
            f"{self.base_url}/openmrs/draft",
            method="OPTIONS",
            headers={"Origin": "https://openmrs.test", "Access-Control-Request-Method": "POST"},
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            self.assertEqual(response.status, 204)
            self.assertEqual(response.headers["Access-Control-Allow-Origin"], "https://openmrs.test")
            self.assertEqual(response.headers["Access-Control-Allow-Credentials"], "true")

    def test_cors_rejects_origins_outside_allowlist(self):
        request = urllib.request.Request(
            f"{self.base_url}/openmrs/draft",
            method="OPTIONS",
            headers={"Origin": "https://evil.test", "Access-Control-Request-Method": "POST"},
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            self.assertEqual(response.status, 204)
            self.assertIsNone(response.headers.get("Access-Control-Allow-Origin"))
            self.assertIsNone(response.headers.get("Access-Control-Allow-Credentials"))

    def test_token_rejects_invalid_json(self):
        request = urllib.request.Request(
            f"{self.base_url}/token",
            data=b"{not-json",
            headers={"Content-Type": "application/json", "Authorization": DEFAULT_AUTH_HEADER},
            method="POST",
        )

        with self.assertRaises(urllib.error.HTTPError) as context:
            urllib.request.urlopen(request, timeout=10)

        self.assertEqual(context.exception.code, 400)
        payload = read_http_error_json(context.exception)
        self.assertEqual(payload["status"], "error")
        self.assertIn("valid JSON", payload["error"])

    def test_production_mode_rejects_missing_credentials_and_cors_allowlist(self):
        returncode, output = run_token_server_startup(
            {
                "TOKEN_SERVER_PORT": str(free_port()),
                "TOKEN_SERVER_ENV": "production",
            },
            env_removals=(
                "LIVEKIT_API_KEY",
                "LIVEKIT_API_SECRET",
                "TOKEN_SERVER_ALLOWED_ORIGINS",
                "CORS_ALLOWED_ORIGINS",
            ),
        )

        self.assertNotEqual(returncode, 0)
        self.assertIn("Production readiness check failed", output)
        self.assertIn("LIVEKIT_API_KEY and LIVEKIT_API_SECRET", output)
        self.assertIn("TOKEN_SERVER_ALLOWED_ORIGINS", output)
        self.assertIn("TOKEN_SERVER_REQUIRE_OPENMRS_SESSION", output)

    def test_production_mode_rejects_livekit_dev_defaults(self):
        returncode, output = run_token_server_startup(
            {
                "TOKEN_SERVER_PORT": str(free_port()),
                "TOKEN_SERVER_ENV": "production",
                "TOKEN_SERVER_REQUIRE_OPENMRS_SESSION": "true",
                "TOKEN_SERVER_ALLOWED_ORIGINS": "https://openmrs.test",
                "LIVEKIT_API_KEY": "devkey",
                "LIVEKIT_API_SECRET": "secret",
            }
        )

        self.assertNotEqual(returncode, 0)
        self.assertIn("Production readiness check failed", output)
        self.assertIn("must not use LiveKit dev defaults", output)


if __name__ == "__main__":
    unittest.main(verbosity=2)
