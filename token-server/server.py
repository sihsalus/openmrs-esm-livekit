"""Minimal LiveKit token server for development.

Generates JWT tokens for LiveKit rooms. In production, this should be
integrated into the OpenMRS backend as a module or secured endpoint.

Usage:
    LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... python server.py
"""

import json
import os
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import jwt

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
        if self.path != "/health":
            self.send_error(404)
            return

        self.send_response(200)
        self._cors_headers()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"status": "ok", "roomPrefix": ROOM_PREFIX}).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors_headers()
        self.end_headers()

    def do_POST(self):
        if self.path != "/token":
            self.send_error(404)
            return

        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}

        patient_uuid = sanitize_room_part(body.get("patientUuid", "unknown"))
        room_prefix = body.get("roomPrefix") or ROOM_PREFIX
        room_name = body.get("roomName") or f"{room_prefix}{patient_uuid}"
        if not room_name.startswith(room_prefix):
            room_name = f"{room_prefix}{sanitize_room_part(room_name)}"
        identity = f"clinician-{int(time.time())}"

        token = create_token(room_name, identity)

        self.send_response(200)
        self._cors_headers()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"token": token, "roomName": room_name}).encode())

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def log_message(self, format, *args):
        print(f"[token-server] {args[0]}")


def sanitize_room_part(value: str) -> str:
    return "".join(ch if ch.isalnum() or ch in ("-", "_") else "-" for ch in str(value))


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), TokenHandler)
    print(f"Token server listening on :{PORT}")
    server.serve_forever()
