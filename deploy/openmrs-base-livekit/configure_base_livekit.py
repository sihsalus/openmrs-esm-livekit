from __future__ import annotations

import json
import os
import re
import secrets
from pathlib import Path


ROOT = Path(os.environ.get("OPENMRS_DISTRO_ROOT", Path.cwd())).resolve()
LIVEKIT_CONFIG = Path(
    os.environ.get("LIVEKIT_CONFIG", ROOT / "deploy" / "livekit" / "livekit.yaml")
).resolve()
LIVEKIT_DOCKER_CONFIG = ROOT / "deploy" / "livekit" / "livekit-docker.yaml"
FRONTEND_MODULE_VERSION = os.environ.get("OPENMRS_LIVEKIT_FRONTEND_VERSION", "0.1.28")
FRONTEND_LIVEKIT_SERVER_URL = os.environ.get("OPENMRS_LIVEKIT_SERVER_URL", "").strip()
LIVEKIT_HOST = os.environ.get("LIVEKIT_HOST", "localhost")
TOKEN_SERVER_ALLOWED_ORIGINS = os.environ.get("TOKEN_SERVER_ALLOWED_ORIGINS", "").strip()


def update_frontend() -> None:
    assemble_path = ROOT / "frontend" / "spa-assemble-config.json"
    assemble = json.loads(assemble_path.read_text())
    assemble.setdefault("frontendModules", {})["@sihsalus/esm-livekit-app"] = FRONTEND_MODULE_VERSION
    assemble_path.write_text(json.dumps(assemble, indent=2) + "\n")

    config_path = ROOT / "frontend" / "config-core_demo.json"
    config = json.loads(config_path.read_text())
    config["@sihsalus/esm-livekit-app"] = {
        "livekitServerUrl": FRONTEND_LIVEKIT_SERVER_URL,
        "tokenEndpoint": "/openmrs/livekit/token",
        "roomPrefix": "openmrs-voice-",
    }
    config_path.write_text(json.dumps(config, indent=2) + "\n")


def update_frontend_dockerfile() -> None:
    dockerfile_path = ROOT / "frontend" / "Dockerfile"
    text = dockerfile_path.read_text()
    if "NPM_CONFIG_FETCH_TIMEOUT" in text:
        return

    npm_retry_env = """ENV NPM_CONFIG_FETCH_RETRIES=5 \\
    NPM_CONFIG_FETCH_RETRY_FACTOR=2 \\
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \\
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \\
    NPM_CONFIG_FETCH_TIMEOUT=300000
"""
    text = text.replace("COPY spa-build-config.json .\n", f"COPY spa-build-config.json .\n\n{npm_retry_env}", 1)
    dockerfile_path.write_text(text)


def update_gateway() -> None:
    old_location = """  location /livekit/token {
    set $token_server http://${LIVEKIT_TOKEN_HOST}:7890;
    proxy_pass $token_server/token;
    proxy_set_header Content-Type "application/json";
  }
"""
    new_location = """  location /livekit/ {
    set $token_server http://${LIVEKIT_TOKEN_HOST}:7890;
    rewrite ^/livekit/(.*)$ /$1 break;
    proxy_pass $token_server;
  }
"""
    openmrs_livekit_location = """  location /openmrs/livekit/ {
    set $token_server http://${LIVEKIT_TOKEN_HOST}:7890;
    rewrite ^/openmrs/livekit/(.*)$ /$1 break;
    proxy_pass $token_server;
  }
"""
    livekit_sfu_location = """  location /livekit-sfu/ {
    set $livekit_server http://livekit:7880;
    rewrite ^/livekit-sfu/(.*)$ /$1 break;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
    proxy_pass $livekit_server;
  }
"""

    for relative in ("gateway/default.conf.template", "gateway/default-ssl.conf.template"):
        path = ROOT / relative
        text = path.read_text()
        if old_location in text:
            text = text.replace(old_location, new_location, 1)
        elif "location /livekit/" not in text:
            text = text.replace("  location = / {", new_location + "\n  location = / {", 1)

        if "location /openmrs/livekit/" not in text:
            text = text.replace("  location = / {", openmrs_livekit_location + "\n  location = / {", 1)

        if "location /livekit-sfu/" not in text:
            text = text.replace("  location = / {", livekit_sfu_location + "\n  location = / {", 1)

        if relative.endswith("default-ssl.conf.template") and "${LIVEKIT_HOST}:7880" not in text:
            text = text.replace(
                "default \"default-src 'self' 'unsafe-inline' 'unsafe-eval' localhost localhost:*; base-uri",
                "default \"default-src 'self' 'unsafe-inline' 'unsafe-eval' localhost localhost:* "
                "ws://localhost:* wss://localhost:* ws://${LIVEKIT_HOST}:7880 wss://${LIVEKIT_HOST}:7880; "
                "connect-src 'self' ws://localhost:* wss://localhost:* "
                "ws://${LIVEKIT_HOST}:7880 wss://${LIVEKIT_HOST}:7880; base-uri",
                1,
            )
        path.write_text(text)


def write_livekit_config() -> None:
    text = read_livekit_config()
    text = re.sub(r"(?m)^(\s*port_range_start:\s*)\d+", r"\g<1>56000", text)
    text = re.sub(r"(?m)^(\s*port_range_end:\s*)\d+", r"\g<1>56100", text)
    LIVEKIT_DOCKER_CONFIG.write_text(text)


def parse_livekit_credentials() -> tuple[str, str]:
    match = re.search(r"(?m)^keys:\s*\n\s+([^:\s]+):\s*(\S+)\s*$", read_livekit_config())
    if not match:
        raise RuntimeError("Could not parse LiveKit credentials")
    return match.group(1), match.group(2)


def read_livekit_config() -> str:
    if LIVEKIT_CONFIG.exists():
        return LIVEKIT_CONFIG.read_text()
    if LIVEKIT_DOCKER_CONFIG.exists():
        return LIVEKIT_DOCKER_CONFIG.read_text()
    raise FileNotFoundError(
        f"LiveKit config not found at {LIVEKIT_CONFIG} or {LIVEKIT_DOCKER_CONFIG}"
    )


def update_env() -> None:
    api_key, api_secret = parse_livekit_credentials()
    env_path = ROOT / ".env"
    values: dict[str, str] = {}
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                values[key] = value

    values["LIVEKIT_API_KEY"] = values.get("LIVEKIT_API_KEY") or api_key
    values["LIVEKIT_API_SECRET"] = values.get("LIVEKIT_API_SECRET") or api_secret
    values["AUDIT_HASH_SALT"] = values.get("AUDIT_HASH_SALT") or secrets.token_hex(32)
    values["LIVEKIT_HOST"] = values.get("LIVEKIT_HOST") or LIVEKIT_HOST
    values["TOKEN_SERVER_ALLOWED_ORIGINS"] = (
        TOKEN_SERVER_ALLOWED_ORIGINS
        or values.get("TOKEN_SERVER_ALLOWED_ORIGINS")
        or default_allowed_origins(values["LIVEKIT_HOST"])
    )
    values["OPENMRS_DISTRO_ROOT"] = values.get("OPENMRS_DISTRO_ROOT") or str(ROOT)

    managed = {
        "LIVEKIT_API_KEY",
        "LIVEKIT_API_SECRET",
        "AUDIT_HASH_SALT",
        "LIVEKIT_HOST",
        "TOKEN_SERVER_ALLOWED_ORIGINS",
        "OPENMRS_DISTRO_ROOT",
    }
    lines = env_path.read_text().splitlines() if env_path.exists() else []
    next_lines: list[str] = []
    seen: set[str] = set()
    for line in lines:
        if "=" not in line or line.lstrip().startswith("#"):
            next_lines.append(line)
            continue
        key = line.split("=", 1)[0]
        if key in managed:
            next_lines.append(f"{key}={values[key]}")
            seen.add(key)
        else:
            next_lines.append(line)

    for key in sorted(managed - seen):
        next_lines.append(f"{key}={values[key]}")

    env_path.write_text("\n".join(next_lines).rstrip() + "\n")


def default_allowed_origins(host: str) -> str:
    origins = ["http://localhost:8080", "http://127.0.0.1:8080"]
    if host not in {"localhost", "127.0.0.1", ""}:
        origins.extend([f"http://{host}", f"https://{host}"])
    return ",".join(origins)


def main() -> None:
    update_frontend()
    update_frontend_dockerfile()
    update_gateway()
    write_livekit_config()
    update_env()
    print("OpenMRS base LiveKit deployment files updated")


if __name__ == "__main__":
    main()
