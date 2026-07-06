# OpenMRS Base LiveKit Stack

These files make the self-hosted OpenMRS LiveKit stack reproducible against the
OpenMRS base Reference Application stack without committing site secrets.

## Inputs

Set these values in the OpenMRS distro `.env` or export them before running
Docker Compose:

```bash
OPENMRS_DISTRO_ROOT=/path/to/openmrs-distro-referenceapplication
OPENMRS_ESM_LIVEKIT_PATH=/path/to/openmrs-esm-livekit
OPENMRS_LIVEKIT_AGENT_PATH=/path/to/openmrs-livekit
LIVEKIT_HOST=<browser-reachable-host>
OPENMRS_LIVEKIT_SERVER_URL=<optional-browser-wss-livekit-url>
LIVEKIT_API_KEY=<site-livekit-api-key>
LIVEKIT_API_SECRET=<site-livekit-api-secret>
AUDIT_HASH_SALT=<site-managed-random-salt>
OPENMRS_PASSWORD=<openmrs-admin-password>
```

To make the helper capable of writing reviewed draft encounters into the
OpenMRS base backend, configure the encounter metadata explicitly. The base
reference application includes these useful defaults:

```bash
OPENMRS_DRAFT_WRITE_ENABLED=true
OPENMRS_ENCOUNTER_TYPE_UUID=d7151f82-c1f3-4152-a605-2f9ea7414a79 # Visit Note
OPENMRS_LOCATION_UUID=44c3efb0-2583-4c80-a79e-1f756a03c0a1 # Outpatient Clinic
OPENMRS_DRAFT_OBS_CONCEPT_UUID=162169AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA # Text of encounter note
```

The UI still queues drafts by default unless a reviewed save action requests an
OpenMRS write. This prevents accidental encounter creation during demos.

The OpenMRS frontend assembly installs the microfrontend from npm. Set
`OPENMRS_LIVEKIT_FRONTEND_VERSION` to the published package version that
contains the commit you want to deploy:

```bash
OPENMRS_LIVEKIT_FRONTEND_VERSION=0.1.31
```

Verify the package before rebuilding the OpenMRS frontend:

```bash
npm view @sihsalus/esm-livekit-app version
```

Tag pushes publish the frontend package through GitHub Actions. If the publish
job fails with `npm ERR! 404 Not Found - PUT` for the existing
`@sihsalus/esm-livekit-app` package, the `NPM_TOKEN` secret does not have publish
permission for the `@sihsalus` scope. Rotate that secret with a token owned by an
npm account that can publish the package, then publish a new patch version or
rerun the failed tag job only after confirming the token permission.

If the current source has not been published to npm yet, build the local bundle
and update the OpenMRS importmap and route registry as a temporary hotfix
instead of relying on the assembly version. Keep this as a short-lived
deployment workaround; the reproducible path is still the npm package version
above.

If the package has been published but a full OpenMRS frontend rebuild fails on
unrelated `@openmrs/*` registry timeouts, deploy the published npm tarball as the
temporary importmap hotfix instead of using a local build:

```bash
npm pack @sihsalus/esm-livekit-app@0.1.31
tar -xzf sihsalus-esm-livekit-app-0.1.31.tgz
```

Copy `package/dist/*` into the frontend nginx document root under
`sihsalus-esm-livekit-app-0.1.31/`, then point `importmap.json` at:

```text
./sihsalus-esm-livekit-app-0.1.31/openmrs-esm-livekit-app.js
```

Also replace the `@sihsalus/esm-livekit-app` entry in `routes.registry.json`
with the package `routes.json`. OpenMRS reads this registry to discover pages,
modals, and extension cards such as the system administration configuration
link. Updating only the importmap loads the new bundle but leaves old route
metadata in place.

Keep `frontend/spa-assemble-config.json` on the same published version so the
next successful full frontend rebuild converges back to the normal assembly
path.

Optional CPU-only AI settings:

```bash
OLLAMA_MODEL=qwen2.5:1.5b
WHISPER_MODEL_SIZE=base
PIPER_MODEL_PATH_EN=/srv/piper/voices/en_US-lessac-medium.onnx
```

Production-like shared deployments should also set:

```bash
TOKEN_SERVER_ENV=production
TOKEN_SERVER_REQUIRE_OPENMRS_SESSION=true
TOKEN_SERVER_ALLOWED_ORIGINS=https://openmrs.example.org
```

The base gateway exposes helper endpoints at both `/openmrs/livekit/*` and
`/livekit/*`. The frontend is configured to use `/openmrs/livekit/token` so
OpenMRS session cookies scoped to `/openmrs` can reach the helper when session
validation is enabled. Keep `/livekit/*` for compatibility and direct health
probes through the gateway.

The helper mirrors the real-time agent provider names with
`LIVEKIT_AGENT_LLM_PROVIDER`, `LIVEKIT_AGENT_STT_PROVIDER`, and
`LIVEKIT_AGENT_TTS_PROVIDER`. Keep those values aligned with the agent
`LLM_PROVIDER`, `STT_PROVIDER`, and `TTS_PROVIDER`; `/health` uses them under
`services.agentCapabilities` so the frontend does not confuse optional helper
`/stt` and `/tts` endpoints with the active LiveKit agent pipeline.

The CPU agent image bundles the Spanish Piper voice used by
`PIPER_MODEL_PATH_ES` and downloads the English `en_US-lessac-medium` Piper
voice during the agent image build. `PIPER_MODEL_PATH` is a legacy fallback and
is not set by the compose file.

## Install Into The OpenMRS Distro

Copy the files in this directory into the distro deployment directory, for
example:

```bash
mkdir -p "$OPENMRS_DISTRO_ROOT/deploy/livekit"
cp deploy/openmrs-base-livekit/*.yml "$OPENMRS_DISTRO_ROOT/deploy/livekit/"
cp deploy/openmrs-base-livekit/*.Dockerfile "$OPENMRS_DISTRO_ROOT/deploy/livekit/"
```

Then configure the base distro:

```bash
OPENMRS_DISTRO_ROOT="$OPENMRS_DISTRO_ROOT" \
LIVEKIT_HOST="$LIVEKIT_HOST" \
python3 deploy/openmrs-base-livekit/configure_base_livekit.py
```

Set `LIVEKIT_CONFIG=/path/to/livekit.yaml` only when you want to seed
`deploy/livekit/livekit-docker.yaml` from a separate source config. On reruns,
the script can reuse the installed `deploy/livekit/livekit-docker.yaml`.

The script updates:

- `frontend/spa-assemble-config.json` with `@sihsalus/esm-livekit-app`.
- `frontend/config-core_demo.json` with the `/openmrs/livekit/token` endpoint.
- `frontend/config-core_demo.json` with `OPENMRS_LIVEKIT_SERVER_URL` when set,
  for example `wss://openmrs.example.org/livekit-sfu`.
- `frontend/Dockerfile` with npm registry retry settings for slower servers.
- gateway templates with `/openmrs/livekit/*`, `/livekit/*`, `/livekit-sfu/*`,
  and LiveKit CSP entries.
- `deploy/livekit/livekit-docker.yaml` with the constrained UDP port range.
- `.env` with LiveKit credentials, allowed origins, audit salt, and paths.

For HTTPS deployments, use the OpenMRS distro SSL compose file and route LiveKit
through the gateway WebSocket proxy:

```bash
SSL_MODE=dev
CERT_WEB_DOMAINS=openmrs.example.org,localhost
CERT_WEB_DOMAIN_COMMON_NAME=openmrs.example.org
OPENMRS_LIVEKIT_SERVER_URL=wss://openmrs.example.org/livekit-sfu
TOKEN_SERVER_ALLOWED_ORIGINS=https://openmrs.example.org,http://openmrs.example.org
```

The direct `https://<tailscale-ip>/...` URL only works if the gateway exposes
port `443` and the browser accepts the certificate for that IP. Prefer the
Tailscale MagicDNS hostname for microphone tests.

## Run

From the OpenMRS distro root:

```bash
docker compose \
  -f docker-compose.yml \
  -f deploy/livekit/build.yml \
  -f deploy/livekit/livekit.yml \
  up -d --build
```

## Verify

```bash
docker compose ps
curl http://<openmrs-host>/openmrs/livekit/health
docker logs openmrs-distro-referenceapplication-livekit-helper-1
docker logs openmrs-distro-referenceapplication-livekit-agent-cpu-1
```

Expected helper logs include `LiveKit room metadata created` or `updated` when a
room is opened from OpenMRS. Expected agent logs include `Metadata parsed` or
`Room metadata derived from room name`.

For a frontend hotfix deployment, also verify that the OpenMRS importmap points
at the uploaded bundle, nginx serves it, and the OpenMRS route registry includes
the package route metadata:

```bash
curl http://<openmrs-host>/openmrs/spa/importmap.json
curl -I http://<openmrs-host>/openmrs/spa/<uploaded-bundle-dir>/openmrs-esm-livekit-app.js
curl http://<openmrs-host>/openmrs/spa/routes.registry.json
```

The deployed bundle should include the OpenMRS base FHIR workaround: it fetches
`MedicationRequest?patient=<uuid>&_count=20` and filters active medication
requests locally, instead of sending `status=active` to the base distro FHIR
endpoint.
