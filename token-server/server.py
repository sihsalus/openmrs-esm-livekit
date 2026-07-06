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
from urllib import error as urllib_error
from urllib import request as urllib_request
from urllib.parse import urlparse

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
PRODUCTION_ENVIRONMENTS = {"production", "prod", "staging", "shared"}
LOCAL_HOSTNAMES = {"localhost", "127.0.0.1", "::1", "[::1]"}
SUPPORTED_CLINICAL_LANGUAGES = {"en", "es"}
DEFAULT_CLINICAL_LANGUAGE = "en"
SUPPORTED_CAPTURE_ROLES = {"doctor", "patient"}
DEFAULT_CAPTURE_ROLE = "doctor"


def env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


def parse_allowed_origins(value: str) -> set[str]:
    origins: set[str] = set()
    for item in value.split(","):
        origin = normalize_origin(item.strip())
        if origin:
            origins.add(origin)
    return origins


def normalize_origin(origin: str) -> str:
    if not origin:
        return ""
    parsed = urlparse(origin)
    if not parsed.scheme or not parsed.netloc:
        return ""
    return f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"


LIVEKIT_API_KEY_CONFIGURED = bool(os.environ.get("LIVEKIT_API_KEY"))
LIVEKIT_API_SECRET_CONFIGURED = bool(os.environ.get("LIVEKIT_API_SECRET"))
API_KEY = os.environ.get("LIVEKIT_API_KEY", DEFAULT_DEV_API_KEY)
API_SECRET = os.environ.get("LIVEKIT_API_SECRET", DEFAULT_DEV_API_SECRET)
PORT = int(os.environ.get("TOKEN_SERVER_PORT", "7890"))
ROOM_PREFIX = os.environ.get("LIVEKIT_ROOM_PREFIX", "openmrs-voice-")
OPENMRS_BASE_URL = os.environ.get("OPENMRS_BASE_URL", "http://127.0.0.1/openmrs").strip().rstrip("/")
LIVEKIT_HTTP_URL = os.environ.get("LIVEKIT_HTTP_URL", "").strip().rstrip("/")
LIVEKIT_ROOM_METADATA_TIMEOUT_SECONDS = float(
    os.environ.get("LIVEKIT_ROOM_METADATA_TIMEOUT_SECONDS", "2")
)
TOKEN_SERVER_ENV = os.environ.get("TOKEN_SERVER_ENV", "development").strip().lower()
REQUIRE_PRODUCTION_CONFIG = TOKEN_SERVER_ENV in PRODUCTION_ENVIRONMENTS or env_flag(
    "TOKEN_SERVER_REQUIRE_PRODUCTION_CONFIG"
)
ALLOWED_ORIGINS = parse_allowed_origins(
    os.environ.get("TOKEN_SERVER_ALLOWED_ORIGINS") or os.environ.get("CORS_ALLOWED_ORIGINS") or ""
)
TOKEN_SERVER_REQUIRE_OPENMRS_SESSION = env_flag("TOKEN_SERVER_REQUIRE_OPENMRS_SESSION")
OPENMRS_SESSION_AUTH_PATHS = {
    "/token",
    "/openmrs/draft",
    "/compile-encounter",
    "/recording/session",
    "/synthetic-consultation",
    "/translate",
    "/stt",
    "/tts",
}


def create_token(
    room_name: str,
    identity: str,
    participant_metadata: dict | None = None,
) -> str:
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
        "metadata": json.dumps(participant_metadata or {"role": "clinician"}),
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
        if self._requires_openmrs_session(path) and not self._require_openmrs_session():
            return

        if path == "/token":
            self._handle_token()
            return

        if path == "/openmrs/draft":
            try:
                self._send_json(queue_openmrs_draft(self._read_json(), self._request_context()))
            except ValueError as error:
                self._send_json({"status": "error", "error": str(error)}, status=400)
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
        except ValueError as error:
            self._send_json({"status": "error", "error": str(error)}, status=400)
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
        doctor_language = sanitize_language_code(
            body.get("doctorLanguage"), DEFAULT_CLINICAL_LANGUAGE
        )
        patient_language = sanitize_language_code(body.get("patientLanguage"), doctor_language)
        agent_voice_language = sanitize_language_code(
            body.get("agentVoiceLanguage"), doctor_language
        )
        capture_role = sanitize_capture_role(
            body.get("captureRole") or body.get("participantRole"),
            DEFAULT_CAPTURE_ROLE,
        )
        default_human_role = sanitize_capture_role(
            body.get("defaultHumanRole"),
            capture_role,
        )
        visit_uuid = sanitize_openmrs_reference(body.get("visitUuid"))
        identity_prefix = "clinician" if capture_role == "doctor" else "patient"
        identity = f"{identity_prefix}-{int(time.time())}"

        room_metadata = build_room_metadata(
            patient_uuid,
            room_prefix,
            doctor_language,
            patient_language,
            agent_voice_language,
            default_human_role,
            visit_uuid,
        )
        metadata_result = sync_livekit_room_metadata(room_name, room_metadata)
        token = create_token(
            room_name,
            identity,
            {
                "role": "clinician" if capture_role == "doctor" else "patient",
                "captureRole": capture_role,
                "participantRole": capture_role,
                "defaultHumanRole": default_human_role,
                "speakerAttributionMode": "source-role",
                "patientUuid": patient_uuid,
                **({"visitUuid": visit_uuid} if visit_uuid else {}),
                "doctorLanguage": doctor_language,
                "patientLanguage": patient_language,
                "agentVoiceLanguage": agent_voice_language,
            },
        )
        self._send_json(
            {"token": token, "roomName": room_name, "roomMetadata": metadata_result}
        )

    def _requires_openmrs_session(self, path: str) -> bool:
        return TOKEN_SERVER_REQUIRE_OPENMRS_SESSION and path in OPENMRS_SESSION_AUTH_PATHS

    def _require_openmrs_session(self) -> bool:
        headers = {}
        if self.headers.get("Authorization"):
            headers["Authorization"] = self.headers["Authorization"]
        if self.headers.get("Cookie"):
            headers["Cookie"] = self.headers["Cookie"]

        if not headers:
            self._send_json(
                {
                    "status": "error",
                    "code": "openmrs_session_required",
                    "error": "OpenMRS session credentials are required",
                },
                status=401,
            )
            return False

        request = urllib_request.Request(
            f"{OPENMRS_BASE_URL}/ws/rest/v1/session",
            headers=headers,
            method="GET",
        )
        try:
            with urllib_request.urlopen(request, timeout=5) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib_error.HTTPError as error:
            status = 401 if error.code in {401, 403} else 503
            code = "openmrs_session_required" if status == 401 else "openmrs_session_unavailable"
            self._send_json(
                {
                    "status": "error",
                    "code": code,
                    "error": f"OpenMRS rejected session validation with HTTP {error.code}",
                },
                status=status,
            )
            return False
        except (urllib_error.URLError, TimeoutError, json.JSONDecodeError) as error:
            self._send_json(
                {
                    "status": "error",
                    "code": "openmrs_session_unavailable",
                    "error": f"Could not validate OpenMRS session: {type(error).__name__}",
                },
                status=503,
            )
            return False

        if isinstance(payload, dict) and payload.get("authenticated") is True:
            return True

        self._send_json(
            {
                "status": "error",
                "code": "openmrs_session_required",
                "error": "OpenMRS session is not authenticated",
            },
            status=401,
        )
        return False

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
            allowed_origin = cors_allowed_origin(origin)
            if allowed_origin:
                self.send_header("Access-Control-Allow-Origin", allowed_origin)
                self.send_header("Access-Control-Allow-Credentials", "true")
            self.send_header("Vary", "Origin")
        elif not REQUIRE_PRODUCTION_CONFIG:
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


def sanitize_language_code(value: object, fallback: str = DEFAULT_CLINICAL_LANGUAGE) -> str:
    normalized = str(value or "").strip().lower().replace("_", "-").split("-", 1)[0]
    if normalized in SUPPORTED_CLINICAL_LANGUAGES:
        return normalized
    return fallback if fallback in SUPPORTED_CLINICAL_LANGUAGES else DEFAULT_CLINICAL_LANGUAGE


def sanitize_capture_role(value: object, fallback: str = DEFAULT_CAPTURE_ROLE) -> str:
    normalized = str(value or "").strip().lower().replace("_", "-")
    if normalized in {"clinician", "provider"}:
        normalized = "doctor"
    if normalized in SUPPORTED_CAPTURE_ROLES:
        return normalized
    return fallback if fallback in SUPPORTED_CAPTURE_ROLES else DEFAULT_CAPTURE_ROLE


def sanitize_openmrs_reference(value: object) -> str:
    return "".join(ch if ch.isalnum() or ch in ("-", "_") else "-" for ch in str(value or "").strip())


def build_room_metadata(
    patient_uuid: str,
    room_prefix: str,
    doctor_language: str = DEFAULT_CLINICAL_LANGUAGE,
    patient_language: str = DEFAULT_CLINICAL_LANGUAGE,
    agent_voice_language: str | None = None,
    default_human_role: str = DEFAULT_CAPTURE_ROLE,
    visit_uuid: str = "",
) -> dict:
    doctor_language = sanitize_language_code(doctor_language, DEFAULT_CLINICAL_LANGUAGE)
    patient_language = sanitize_language_code(patient_language, doctor_language)
    agent_voice_language = sanitize_language_code(agent_voice_language, doctor_language)
    default_human_role = sanitize_capture_role(default_human_role, DEFAULT_CAPTURE_ROLE)
    metadata = {
        "patientUuid": patient_uuid,
        "roomPrefix": room_prefix,
        "doctorLanguage": doctor_language,
        "patientLanguage": patient_language,
        "agentVoiceLanguage": agent_voice_language,
        "languageMode": "bilingual" if doctor_language != patient_language else "single-language",
        "speakerAttributionMode": "source-role",
        "defaultHumanRole": default_human_role,
        "source": "openmrs-livekit-token-server",
    }
    if visit_uuid:
        metadata["visitUuid"] = visit_uuid
    return metadata


def sync_livekit_room_metadata(room_name: str, metadata: dict) -> dict:
    if not LIVEKIT_HTTP_URL:
        return {"status": "skipped", "reason": "livekit_http_url_not_configured"}

    metadata_json = json.dumps(metadata, separators=(",", ":"))
    try:
        post_livekit_room_service(
            "CreateRoom",
            {
                "name": room_name,
                "metadata": metadata_json,
            },
        )
        print(f"[token-server] LiveKit room metadata created for {room_name}")
        return {"status": "ok", "operation": "create"}
    except urllib_error.HTTPError as error:
        body = read_http_error_body(error)
        if error.code == 409 or "already" in body.lower():
            try:
                post_livekit_room_service(
                    "UpdateRoomMetadata",
                    {
                        "room": room_name,
                        "metadata": metadata_json,
                    },
                )
                print(f"[token-server] LiveKit room metadata updated for {room_name}")
                return {"status": "ok", "operation": "update"}
            except Exception as update_error:
                print(
                    "[token-server] LiveKit room metadata update failed: "
                    f"{type(update_error).__name__}: {update_error}"
                )
                return {"status": "error", "operation": "update", "error": str(update_error)}
        print(
            "[token-server] LiveKit room metadata create failed: "
            f"HTTP {error.code} {body[:180]}"
        )
        return {"status": "error", "operation": "create", "httpStatus": error.code}
    except Exception as error:
        print(
            "[token-server] LiveKit room metadata sync failed: "
            f"{type(error).__name__}: {error}"
        )
        return {"status": "error", "operation": "create", "error": str(error)}


def post_livekit_room_service(method: str, payload: dict) -> None:
    url = f"{LIVEKIT_HTTP_URL}/twirp/livekit.RoomService/{method}"
    request = urllib_request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {create_room_admin_token(payload.get('room') or payload.get('name') or '')}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib_request.urlopen(request, timeout=LIVEKIT_ROOM_METADATA_TIMEOUT_SECONDS) as response:
        response.read()


def create_room_admin_token(room_name: str) -> str:
    now = int(time.time())
    claims = {
        "iss": API_KEY,
        "sub": f"token-server-{now}",
        "iat": now,
        "nbf": now,
        "exp": now + 60,
        "video": {
            "room": room_name,
            "roomAdmin": True,
            "roomCreate": True,
        },
    }
    headers = {"kid": API_KEY}
    if jwt:
        token = jwt.encode(claims, API_SECRET, algorithm="HS256", headers=headers)
        return token.decode("ascii") if isinstance(token, bytes) else token
    return encode_hs256_jwt(claims, API_SECRET, headers)


def read_http_error_body(error: urllib_error.HTTPError) -> str:
    try:
        return error.read().decode("utf-8", errors="replace")
    except Exception:
        return ""


def build_token_server_health() -> dict:
    payload = build_health_response(ROOM_PREFIX)
    services = payload.setdefault("services", {})
    services["livekitTokenSigning"] = livekit_token_signing_status()
    services["livekitRoomMetadata"] = livekit_room_metadata_status()
    services["tokenServerAuth"] = token_server_auth_status()
    services["cors"] = cors_status()
    services["productionReadiness"] = production_readiness_status()
    for warning in token_server_warnings():
        payload.setdefault("warnings", []).append(warning)
    return payload


def token_server_auth_status() -> dict:
    return {
        "status": "enforced" if TOKEN_SERVER_REQUIRE_OPENMRS_SESSION else "disabled",
        "openmrsSessionRequired": TOKEN_SERVER_REQUIRE_OPENMRS_SESSION,
        "protectedPaths": sorted(OPENMRS_SESSION_AUTH_PATHS),
        "contract": "When enabled, protected helper endpoints require an authenticated OpenMRS session via Cookie or Authorization header.",
    }


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


def livekit_room_metadata_status() -> dict:
    return {
        "status": "configured" if LIVEKIT_HTTP_URL else "disabled",
        "livekitHttpUrlConfigured": bool(LIVEKIT_HTTP_URL),
        "contract": "Best-effort LiveKit room metadata with patientUuid, roomPrefix, languages, agent voice, and source-role attribution",
    }


def livekit_token_signing_warning() -> str | None:
    if LIVEKIT_API_KEY_CONFIGURED and LIVEKIT_API_SECRET_CONFIGURED:
        if API_KEY == DEFAULT_DEV_API_KEY or API_SECRET == DEFAULT_DEV_API_SECRET:
            return "LiveKit dev token credentials are configured. Use site-specific LIVEKIT_API_KEY and LIVEKIT_API_SECRET outside local development."
        return None
    if LIVEKIT_API_KEY_CONFIGURED or LIVEKIT_API_SECRET_CONFIGURED:
        return "LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be configured together for real LiveKit rooms."
    return "Using LiveKit dev token defaults. Set LIVEKIT_API_KEY and LIVEKIT_API_SECRET for any shared or production environment."


def cors_allowed_origin(origin: str) -> str | None:
    normalized = normalize_origin(origin)
    if not normalized:
        return None
    if normalized in ALLOWED_ORIGINS:
        return normalized
    if not ALLOWED_ORIGINS and not REQUIRE_PRODUCTION_CONFIG:
        return normalized
    return None


def is_local_origin(origin: str) -> bool:
    parsed = urlparse(origin)
    return parsed.hostname in LOCAL_HOSTNAMES or bool(parsed.hostname and parsed.hostname.endswith(".localhost"))


def is_secure_shared_origin(origin: str) -> bool:
    parsed = urlparse(origin)
    return parsed.scheme == "https" or is_local_origin(origin)


def cors_status() -> dict:
    if ALLOWED_ORIGINS:
        status = "configured"
    elif REQUIRE_PRODUCTION_CONFIG:
        status = "not_configured"
    else:
        status = "permissive_dev"
    return {
        "status": status,
        "allowedOrigins": sorted(ALLOWED_ORIGINS),
        "allowCredentials": True,
        "contract": "TOKEN_SERVER_ALLOWED_ORIGINS comma-separated origins",
    }


def production_config_errors() -> list[str]:
    errors: list[str] = []
    if not LIVEKIT_API_KEY_CONFIGURED or not LIVEKIT_API_SECRET_CONFIGURED:
        errors.append("LIVEKIT_API_KEY and LIVEKIT_API_SECRET must both be configured")
    elif API_KEY == DEFAULT_DEV_API_KEY or API_SECRET == DEFAULT_DEV_API_SECRET:
        errors.append("LIVEKIT_API_KEY and LIVEKIT_API_SECRET must not use LiveKit dev defaults")

    if not ALLOWED_ORIGINS:
        errors.append("TOKEN_SERVER_ALLOWED_ORIGINS must include the OpenMRS browser origin")

    if not TOKEN_SERVER_REQUIRE_OPENMRS_SESSION:
        errors.append("TOKEN_SERVER_REQUIRE_OPENMRS_SESSION=true is required")

    insecure_origins = [origin for origin in ALLOWED_ORIGINS if not is_secure_shared_origin(origin)]
    if insecure_origins:
        errors.append(
            "TOKEN_SERVER_ALLOWED_ORIGINS must use https:// for non-local origins: "
            + ", ".join(sorted(insecure_origins))
        )
    return errors


def production_readiness_status() -> dict:
    errors = production_config_errors()
    if REQUIRE_PRODUCTION_CONFIG:
        status = "enforced" if not errors else "error"
    else:
        status = "demo_mode"
    return {
        "status": status,
        "environment": TOKEN_SERVER_ENV or "development",
        "required": REQUIRE_PRODUCTION_CONFIG,
        "errors": errors if REQUIRE_PRODUCTION_CONFIG else [],
        "contract": "Set TOKEN_SERVER_ENV=production or TOKEN_SERVER_REQUIRE_PRODUCTION_CONFIG=true",
    }


def token_server_warnings() -> list[str]:
    warnings = []
    signing_warning = livekit_token_signing_warning()
    if signing_warning:
        warnings.append(signing_warning)
    if not ALLOWED_ORIGINS and not REQUIRE_PRODUCTION_CONFIG:
        warnings.append(
            "CORS is permissive for demo mode. Set TOKEN_SERVER_ALLOWED_ORIGINS before any shared or production deployment."
        )
    if not TOKEN_SERVER_REQUIRE_OPENMRS_SESSION and not REQUIRE_PRODUCTION_CONFIG:
        warnings.append(
            "OpenMRS session validation is disabled for demo mode. Set TOKEN_SERVER_REQUIRE_OPENMRS_SESSION=true before any shared or production deployment."
        )
    return warnings


def validate_startup_config() -> None:
    if not REQUIRE_PRODUCTION_CONFIG:
        return
    errors = production_config_errors()
    if errors:
        raise RuntimeError("Production readiness check failed: " + "; ".join(errors))


if __name__ == "__main__":
    validate_startup_config()
    for warning in token_server_warnings():
        print(f"[token-server] WARNING: {warning}")
    server = ThreadingHTTPServer(("0.0.0.0", PORT), TokenHandler)
    print(f"OpenMRS LiveKit helper listening on :{PORT}")
    server.serve_forever()
