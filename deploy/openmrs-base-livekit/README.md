# OpenMRS Base LiveKit Stack

These files make the hackathon demo reproducible against the OpenMRS base
Reference Application stack without committing site secrets.

## Inputs

Set these values in the OpenMRS distro `.env` or export them before running
Docker Compose:

```bash
OPENMRS_DISTRO_ROOT=/path/to/openmrs-distro-referenceapplication
OPENMRS_ESM_LIVEKIT_PATH=/path/to/openmrs-esm-livekit
OPENMRS_LIVEKIT_AGENT_PATH=/path/to/openmrs-livekit
LIVEKIT_HOST=<browser-reachable-host>
LIVEKIT_API_KEY=<site-livekit-api-key>
LIVEKIT_API_SECRET=<site-livekit-api-secret>
AUDIT_HASH_SALT=<site-managed-random-salt>
OPENMRS_PASSWORD=<openmrs-admin-password>
```

The OpenMRS frontend assembly installs the microfrontend from npm. Set
`OPENMRS_LIVEKIT_FRONTEND_VERSION` to the published package version that
contains the commit you want to deploy:

```bash
OPENMRS_LIVEKIT_FRONTEND_VERSION=0.1.9
```

If the current source has not been published to npm yet, build the local bundle
and update the OpenMRS importmap as a temporary hotfix instead of relying on the
assembly version.

Optional CPU-only AI settings:

```bash
OLLAMA_MODEL=qwen2.5:1.5b
WHISPER_MODEL_SIZE=base
```

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
LIVEKIT_CONFIG=/path/to/livekit.yaml \
LIVEKIT_HOST="$LIVEKIT_HOST" \
python3 deploy/openmrs-base-livekit/configure_base_livekit.py
```

The script updates:

- `frontend/spa-assemble-config.json` with `@sihsalus/esm-livekit-app`.
- `frontend/config-core_demo.json` with the `/livekit/token` endpoint.
- gateway templates with `/livekit/*` proxy and LiveKit CSP entries.
- `deploy/livekit/livekit-docker.yaml` with the constrained UDP port range.
- `.env` with LiveKit credentials, allowed origins, audit salt, and paths.

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
curl http://localhost:7890/health
docker logs openmrs-distro-referenceapplication-livekit-helper-1
docker logs openmrs-distro-referenceapplication-livekit-agent-cpu-1
```

Expected helper logs include `LiveKit room metadata created` or `updated` when a
room is opened from OpenMRS. Expected agent logs include `Metadata parsed` or
`Room metadata derived from room name`.
