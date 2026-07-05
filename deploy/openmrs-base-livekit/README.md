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
and update the OpenMRS importmap as a temporary hotfix instead of relying on the
assembly version. Keep this as a short-lived demo workaround; the reproducible
path is still the npm package version above.

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
LIVEKIT_HOST="$LIVEKIT_HOST" \
python3 deploy/openmrs-base-livekit/configure_base_livekit.py
```

Set `LIVEKIT_CONFIG=/path/to/livekit.yaml` only when you want to seed
`deploy/livekit/livekit-docker.yaml` from a separate source config. On reruns,
the script can reuse the installed `deploy/livekit/livekit-docker.yaml`.

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

For a frontend hotfix deployment, also verify that the OpenMRS importmap points
at the uploaded bundle and that nginx serves it:

```bash
curl http://<openmrs-host>/openmrs/spa/importmap.json
curl -I http://<openmrs-host>/openmrs/spa/<uploaded-bundle-dir>/openmrs-esm-livekit-app.js
```

The deployed bundle should include the OpenMRS base FHIR workaround: it fetches
`MedicationRequest?patient=<uuid>&_count=20` and filters active medication
requests locally, instead of sending `status=active` to the base distro FHIR
endpoint.
