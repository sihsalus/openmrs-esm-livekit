"""Local OpenMRS LiveKit helper service.

Generates JWT tokens for LiveKit rooms and exposes local-AI demo endpoints for
an offline doctor-patient translation workflow.

Usage:
    LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... python server.py
"""

import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import jwt
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

API_KEY = os.environ.get("LIVEKIT_API_KEY", "APICSg8zBzkj8ip")
API_SECRET = os.environ.get("LIVEKIT_API_SECRET", "EKXBwcBozWQbzBbZqLyf9MGtvptpE59E884wwfwe5qcA")
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
    return jwt.encode(claims, API_SECRET, algorithm="HS256", headers={"kid": API_KEY})


class TokenHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self._path()
        if path == "/health":
            self._send_json(build_health_response(ROOM_PREFIX))
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
        body = self._read_json()

        patient_uuid = sanitize_room_part(body.get("patientUuid", "unknown"))
        room_prefix = body.get("roomPrefix") or ROOM_PREFIX
        room_name = body.get("roomName") or f"{room_prefix}{patient_uuid}"
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
        return json.loads(self.rfile.read(length))

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


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), TokenHandler)
    print(f"OpenMRS LiveKit helper listening on :{PORT}")
    server.serve_forever()
