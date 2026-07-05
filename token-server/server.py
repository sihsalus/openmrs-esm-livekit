"""Local OpenMRS LiveKit helper service.

Generates JWT tokens for LiveKit rooms and exposes local-AI demo endpoints for
an offline doctor-patient translation workflow.

Usage:
    LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... python server.py
"""

import base64
import hashlib
import hmac
import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    import jwt
except ModuleNotFoundError:
    jwt = None
from local_ai import (
    build_health_response,
    compile_encounter,
    generate_synthetic_consultation,
    queue_openmrs_draft,
    recording_session,
    stt_response,
    translate_text,
    tts_response,
)

DEFAULT_DEV_API_KEY = "devkey"
DEFAULT_DEV_API_SECRET = "secret"

LIVEKIT_API_KEY_CONFIGURED = bool(os.environ.get("LIVEKIT_API_KEY"))
LIVEKIT_API_SECRET_CONFIGURED = bool(os.environ.get("LIVEKIT_API_SECRET"))
API_KEY = os.environ.get("LIVEKIT_API_KEY", DEFAULT_DEV_API_KEY)
API_SECRET = os.environ.get("LIVEKIT_API_SECRET", DEFAULT_DEV_API_SECRET)
PORT = int(os.environ.get("TOKEN_SERVER_PORT", "7890"))
ROOM_PREFIX = os.environ.get("LIVEKIT_ROOM_PREFIX", "iot-device-")


def create_token(room_name: str, identity: str) -> str:
    now = int(time.time())
    claims = {
        "iss": API_KEY,
        "sub": identity,
        "iat": now,
        "nbf": now,
        "exp": now + 3600,
        "video": {
            "room": room_name,
            "roomJoin": True,
            "canPublish": True,
            "canSubscribe": True,
            "canPublishData": True,
        },
        "metadata": json.dumps({"role": "clinician"}),
    }
    headers = {"kid": API_KEY}
    if jwt:
        token = jwt.encode(claims, API_SECRET, algorithm="HS256", headers=headers)
        return token.decode("ascii") if isinstance(token, bytes) else token

    return encode_hs256_jwt(claims, API_SECRET, headers)


def encode_hs256_jwt(claims: dict, secret: str, headers: dict | None = None) -> str:
    header = {"typ": "JWT", "alg": "HS256", **(headers or {})}
    header_part = base64url_json(header)
    claims_part = base64url_json(claims)
    signing_input = f"{header_part}.{claims_part}".encode("ascii")
    signature = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    return f"{header_part}.{claims_part}.{base64url_bytes(signature)}"


def base64url_json(payload: dict) -> str:
    return base64url_bytes(json.dumps(payload, separators=(",", ":")).encode("utf-8"))


def base64url_bytes(payload: bytes) -> str:
    return base64.urlsafe_b64encode(payload).rstrip(b"=").decode("ascii")


class TokenHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self._path()
        if path == "/health":
            self._send_json(build_token_server_health())
            return

        self.send_error(404)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def do_POST(self):
        path = self._path()

        if path == "/token":
            self._handle_token()
            return

        if path == "/openmrs/draft":
            try:
                self._send_json(queue_openmrs_draft(self._read_json(), self._request_context()))
            except Exception as error:
                self._send_json({"status": "error", "error": str(error)}, status=500)
            return

        handlers = {
            "/compile-encounter": compile_encounter,
            "/synthetic-consultation": generate_synthetic_consultation,
            "/recording/session": recording_session,
            "/translate": translate_text,
            "/stt": stt_response,
            "/tts": tts_response,
        }
        handler = handlers.get(path)
        if not handler:
            self.send_error(404)
            return

        try:
            self._send_json(handler(self._read_json()))
        except Exception as error:
            self._send_json({"status": "error", "error": str(error)}, status=500)

    def _handle_token(self):
        try:
            body = self._read_json()
        except ValueError as error:
            self._send_json({"status": "error", "error": str(error)}, status=400)
            return

        patient_uuid = sanitize_room_part(body.get("patientUuid", "unknown"))
        room_prefix = sanitize_room_prefix(body.get("roomPrefix") or ROOM_PREFIX)
        room_name = body.get("roomName") or f"{room_prefix}{patient_uuid}"
        room_name = sanitize_room_part(room_name)
        if not room_name.startswith(room_prefix):
            room_name = f"{room_prefix}{sanitize_room_part(room_name)}"
        identity = f"clinician-{int(time.time())}"

        token = create_token(room_name, identity)
        self._send_json({"token": token, "roomName": room_name})

    def _path(self):
        return self.path.split("?", 1)[0]

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length))
        except json.JSONDecodeError as error:
            raise ValueError("Request body must be valid JSON") from error

    def _request_context(self):
        return {
            "authorization": self.headers.get("Authorization"),
            "cookie": self.headers.get("Cookie"),
            "origin": self.headers.get("Origin"),
        }

    def _send_json(self, payload, status=200):
        self.send_response(status)
        self._cors_headers()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode())

    def _cors_headers(self):
        origin = self.headers.get("Origin")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Credentials", "true")
            self.send_header("Vary", "Origin")
        else:
            self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def log_message(self, format, *args):
        message = format % args if args else format
        print(f"[token-server] {message}")


def sanitize_room_part(value: str) -> str:
    return "".join(ch if ch.isalnum() or ch in ("-", "_") else "-" for ch in str(value))


def sanitize_room_prefix(value: str) -> str:
    prefix = sanitize_room_part(value)
    return prefix or ROOM_PREFIX


def build_token_server_health() -> dict:
    payload = build_health_response(ROOM_PREFIX)
    payload.setdefault("services", {})["livekitTokenSigning"] = livekit_token_signing_status()
    warning = livekit_token_signing_warning()
    if warning:
        payload.setdefault("warnings", []).append(warning)
    return payload


def livekit_token_signing_status() -> dict:
    if LIVEKIT_API_KEY_CONFIGURED and LIVEKIT_API_SECRET_CONFIGURED:
        status = "configured"
    elif LIVEKIT_API_KEY_CONFIGURED or LIVEKIT_API_SECRET_CONFIGURED:
        status = "partial_configuration"
    else:
        status = "dev_default"

    return {
        "status": status,
        "apiKeyConfigured": LIVEKIT_API_KEY_CONFIGURED,
        "apiSecretConfigured": LIVEKIT_API_SECRET_CONFIGURED,
        "usesDevDefaults": status != "configured",
    }


def livekit_token_signing_warning() -> str | None:
    if LIVEKIT_API_KEY_CONFIGURED and LIVEKIT_API_SECRET_CONFIGURED:
        return None
    if LIVEKIT_API_KEY_CONFIGURED or LIVEKIT_API_SECRET_CONFIGURED:
        return "LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be configured together for real LiveKit rooms."
    return "Using LiveKit dev token defaults. Set LIVEKIT_API_KEY and LIVEKIT_API_SECRET for any shared or production environment."


if __name__ == "__main__":
    warning = livekit_token_signing_warning()
    if warning:
        print(f"[token-server] WARNING: {warning}")
    server = ThreadingHTTPServer(("0.0.0.0", PORT), TokenHandler)
    print(f"OpenMRS LiveKit helper listening on :{PORT}")
    server.serve_forever()
