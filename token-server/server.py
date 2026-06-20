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

        patient_uuid = body.get("patientUuid", "unknown")
        room_name = f"consultation-{patient_uuid}"
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


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), TokenHandler)
    print(f"Token server listening on :{PORT}")
    server.serve_forever()
