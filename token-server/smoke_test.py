#!/usr/bin/env python3
"""Smoke test a running OpenMRS LiveKit helper.

This test intentionally targets a real helper URL instead of starting fake
services. It verifies the demo-critical helper contract without using real PHI.
"""

from __future__ import annotations

import base64
import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any

BASE_URL = os.environ.get("TOKEN_SERVER_SMOKE_URL", "http://127.0.0.1:7890").rstrip("/")
PATIENT_UUID = os.environ.get("TOKEN_SERVER_SMOKE_PATIENT_UUID", "synthetic-smoke-patient")
ROOM_PREFIX = os.environ.get("TOKEN_SERVER_SMOKE_ROOM_PREFIX", "openmrs-voice-")
AUTHORIZATION = os.environ.get("TOKEN_SERVER_SMOKE_AUTHORIZATION", "").strip()
if not AUTHORIZATION and os.environ.get("OPENMRS_USERNAME") and os.environ.get("OPENMRS_PASSWORD"):
    encoded = base64.b64encode(
        f"{os.environ['OPENMRS_USERNAME']}:{os.environ['OPENMRS_PASSWORD']}".encode("utf-8")
    ).decode("ascii")
    AUTHORIZATION = f"Basic {encoded}"


def request_json(path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if AUTHORIZATION:
        headers["Authorization"] = AUTHORIZATION
    request = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=data,
        headers=headers,
        method="POST" if payload is not None else "GET",
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def decode_jwt_json(part: str) -> dict[str, Any]:
    padding = "=" * (-len(part) % 4)
    return json.loads(base64.urlsafe_b64decode(f"{part}{padding}").decode("utf-8"))


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def smoke_health() -> dict[str, Any]:
    payload = request_json("/health")
    require(payload.get("status") in {"ok", "degraded"}, "health status must be ok or degraded")
    services = payload.get("services") or {}
    signing = services.get("livekitTokenSigning") or {}
    require(
        signing.get("status") in {"configured", "dev_default"},
        "LiveKit token signing status is missing",
    )
    require(
        services.get("agent", {}).get("contract") == "LiveKit data-channel topic agent-data",
        "agent data-channel contract is missing",
    )
    require(
        services.get("draftAudit", {}).get("rawClinicalTextStored") is False,
        "draft audit must report that raw clinical text is not stored",
    )
    print(f"ok health: signing={signing.get('status')}")
    return payload


def smoke_token() -> dict[str, Any]:
    payload = request_json(
        "/token",
        {
            "patientUuid": PATIENT_UUID,
            "roomPrefix": ROOM_PREFIX,
        },
    )
    token = payload.get("token")
    room_name = payload.get("roomName")
    require(isinstance(token, str) and token.count(".") == 2, "token must be a compact JWT")
    require(
        isinstance(room_name, str) and room_name.startswith(ROOM_PREFIX),
        "roomName must use the expected prefix",
    )

    header_part, claims_part, _signature_part = token.split(".")
    header = decode_jwt_json(header_part)
    claims = decode_jwt_json(claims_part)
    require(header.get("alg") == "HS256", "LiveKit token must be HS256 signed")
    require(
        claims.get("video", {}).get("room") == room_name,
        "LiveKit token room claim must match roomName",
    )
    require(claims.get("video", {}).get("roomJoin") is True, "LiveKit token must grant roomJoin")
    print(f"ok token: room={room_name}")
    return payload


def smoke_compile() -> dict[str, Any]:
    payload = request_json(
        "/compile-encounter",
        {
            "patientName": "Sofia Smoke",
            "transcript": (
                "Doctor: Sofia Smoke email sofia.smoke@example.test phone +51 999 888 777 "
                "OpenMRS ID: 100008E has cough and fever. No known drug allergies."
            ),
        },
    )
    redacted = payload.get("redactedTranscript", "")
    require("[REDACTED_NAME]" in redacted, "compiled transcript must redact patient name")
    require("[REDACTED_EMAIL]" in redacted, "compiled transcript must redact email")
    require("[REDACTED_PHONE]" in redacted, "compiled transcript must redact phone")
    require("[REDACTED_ID]" in redacted, "compiled transcript must redact OpenMRS ID")
    require("sofia.smoke@example.test" not in redacted, "compiled transcript must not leak raw email")
    require((payload.get("draft") or {}).get("chiefComplaint"), "compiled draft must include a chief complaint")
    print(f"ok compile: engine={payload.get('engine')}")
    return payload


def smoke_synthetic_and_queue() -> dict[str, Any]:
    synthetic = request_json(
        "/synthetic-consultation",
        {
            "caseId": "pediatric-respiratory",
            "patientUuid": PATIENT_UUID,
        },
    )
    require(synthetic.get("synthetic") is True, "synthetic consultation must be marked synthetic")
    require(
        synthetic.get("privacy", {}).get("containsRealPatientData") is False,
        "synthetic consultation must not contain real patient data",
    )
    require("[REDACTED_NAME]" in synthetic.get("redactedTranscript", ""), "synthetic transcript must be redacted")

    draft_request = synthetic.get("openmrsDraftRequest") or {}
    draft_request["writeToOpenmrs"] = False
    queued = request_json("/openmrs/draft", draft_request)
    require(queued.get("status") == "queued", "draft smoke path must queue without writing")
    require(queued.get("clinicianReviewRequired") is True, "queued draft must require clinician review")
    require(queued.get("openmrsWrite") == "queued_only", "draft smoke path must not write to OpenMRS")
    require(isinstance(queued.get("auditEventId"), str), "queued draft must include an audit event id")
    require(queued.get("auditEventType") == "draft_queued", "queued draft must emit a draft_queued audit event")
    print(f"ok draft queue: draftId={queued.get('draftId')}")
    return queued


def main() -> int:
    print(f"OpenMRS LiveKit helper smoke test: {BASE_URL}")
    try:
        smoke_health()
        smoke_token()
        smoke_compile()
        smoke_synthetic_and_queue()
    except urllib.error.URLError as error:
        print(f"smoke test failed: helper is not reachable at {BASE_URL}: {error}", file=sys.stderr)
        return 1
    except Exception as error:
        print(f"smoke test failed: {error}", file=sys.stderr)
        return 1

    print("smoke test passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
