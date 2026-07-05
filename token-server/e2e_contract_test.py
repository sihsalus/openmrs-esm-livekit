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
            self.send_json(
                {
                    "response": json.dumps(
                        {
                            "chiefComplaint": "cough and fever",
                            "symptoms": ["cough", "fever"],
                            "medicationsMentioned": ["paracetamol"],
                            "allergiesMentioned": [],
                            "assessmentNotes": "Clinician review required.",
                            "patientInstructions": "Return if breathing worsens.",
                        }
                    )
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
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *_args):
        return


def start_server(handler: type[BaseHTTPRequestHandler]) -> tuple[ThreadingHTTPServer, str]:
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port = int(server.server_address[1])
    import threading

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, f"http://127.0.0.1:{port}"


def request_json(base_url: str, path: str, payload: dict[str, Any] | None = None, headers: dict[str, str] | None = None):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        f"{base_url}{path}",
        data=data,
        headers={"Content-Type": "application/json", **(headers or {})},
        method="POST" if payload is not None else "GET",
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read().decode("utf-8")), response


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
        cls.openmrs_server, cls.openmrs_url = start_server(FakeOpenMRSHandler)
        cls.ollama_server, cls.ollama_url = start_server(FakeOllamaHandler)
        cls.livekit_server, cls.livekit_url = start_server(FakeLiveKitHandler)
        cls.tempdir = tempfile.TemporaryDirectory()
        cls.port = free_port()
        cls.base_url = f"http://127.0.0.1:{cls.port}"

        env = os.environ.copy()
        env.update(
            {
                "TOKEN_SERVER_PORT": str(cls.port),
                "TOKEN_SERVER_ENV": "production",
                "TOKEN_SERVER_ALLOWED_ORIGINS": "https://openmrs.test",
                "LIVEKIT_API_KEY": "test-key",
                "LIVEKIT_API_SECRET": "test-secret",
                "OLLAMA_URL": cls.ollama_url,
                "OLLAMA_MODEL": "medgemma:test",
                "OPENMRS_BASE_URL": f"{cls.openmrs_url}/openmrs",
                "LIVEKIT_HTTP_URL": cls.livekit_url,
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

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        try:
            cls.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.process.kill()
        cls.openmrs_server.shutdown()
        cls.ollama_server.shutdown()
        cls.livekit_server.shutdown()
        cls.tempdir.cleanup()

    def test_health_reports_local_services_and_contracts(self):
        payload, _response = request_json(self.base_url, "/health")
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["services"]["livekitTokenSigning"]["status"], "configured")
        self.assertEqual(payload["services"]["cors"]["status"], "configured")
        self.assertEqual(payload["services"]["cors"]["allowedOrigins"], ["https://openmrs.test"])
        self.assertEqual(payload["services"]["productionReadiness"]["status"], "enforced")
        self.assertEqual(payload["services"]["agent"]["contract"], "LiveKit data-channel topic agent-data")
        self.assertEqual(payload["services"]["openmrsDraftWrite"]["status"], "configured")
        self.assertEqual(payload["services"]["draftAudit"]["status"], "enabled")
        self.assertFalse(payload["services"]["draftAudit"]["rawClinicalTextStored"])
        self.assertTrue(payload["services"]["draftAudit"]["hashSaltConfigured"])
        self.assertIn("pediatric-respiratory", payload["services"]["syntheticData"]["cases"])
        self.assertEqual(payload["services"]["recording"]["status"], "manifest_only")
        self.assertEqual(payload["services"]["localStorage"]["status"], "private_files")
        self.assertEqual(payload["services"]["localStorage"]["fileMode"], "0600")
        self.assertTrue(payload["services"]["localStorage"]["auditLogPath"].endswith("audit.jsonl"))

    def test_openmrs_probe_treats_login_html_as_reachable(self):
        server, base_url = start_server(FakeOpenMRSLoginHandler)
        try:
            payload = local_ai._probe_http(f"{base_url}/openmrs/ws/rest/v1/session", expect_json=True)
        finally:
            server.shutdown()

        self.assertEqual(payload["status"], "ok")
        self.assertFalse(payload["json"])
        self.assertEqual(payload["contentType"], "text/html")

    def test_token_is_hmac_signed_and_does_not_expose_secret(self):
        payload, _response = request_json(
            self.base_url,
            "/token",
            {"patientUuid": "patient-123", "roomPrefix": "openmrs-room-"},
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
        self.assertEqual(signature_part, expected_signature)
        self.assertNotIn("test-secret", token)

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
        denied, _response = request_json(self.base_url, "/recording/session", {"roomName": "iot-device-demo"})
        self.assertEqual(denied["status"], "consent_required")

        allowed, _response = request_json(
            self.base_url,
            "/recording/session",
            {"roomName": "iot-device-demo", "patientUuid": "synthetic-patient", "consentCaptured": True},
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
        self.assertEqual(audit_event["patientHash"], hashlib.sha256(b"test-audit-salt:patient-uuid").hexdigest())
        self.assertNotIn("draft", audit_event)
        self.assertNotIn("redactedTranscript", audit_event)
        self.assertNotIn("Doctor: cough", json.dumps(audit_event))

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
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        with self.assertRaises(urllib.error.HTTPError) as context:
            urllib.request.urlopen(request, timeout=10)

        self.assertEqual(context.exception.code, 400)
        payload = json.loads(context.exception.read().decode("utf-8"))
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

    def test_production_mode_rejects_livekit_dev_defaults(self):
        returncode, output = run_token_server_startup(
            {
                "TOKEN_SERVER_PORT": str(free_port()),
                "TOKEN_SERVER_ENV": "production",
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
