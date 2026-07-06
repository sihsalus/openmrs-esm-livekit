# OpenMRS LiveKit Voice Assistant

OpenMRS LiveKit is a local-first clinical voice assistant for OpenMRS O3. It opens a LiveKit audio room from the patient chart, runs a doctor-patient voice workflow, redacts PHI-like text, and produces a structured OpenMRS encounter draft for clinician review.

The project is designed for clinics where internet connectivity is unreliable, privacy matters, and clinicians may need bilingual support during patient encounters.

## What it does

- Starts a patient-scoped LiveKit audio room from an OpenMRS O3 frontend extension.
- Supports a local AI workflow for speech-to-text, clinical translation, text-to-speech, and encounter drafting.
- Generates a redacted transcript and a structured draft with chief complaint, symptoms, medications, allergies, assessment notes, and patient instructions.
- Queues drafts for clinician review instead of writing autonomous documentation directly to the chart.
- Avoids storing raw audio by default.
- Includes deterministic synthetic consultation data for demos and end-to-end checks without real patient data.

## Architecture

The prototype has two parts:

- `src/`: OpenMRS O3 microfrontend that renders the voice button, modal, patient context, LiveKit room, local AI workflow, privacy status, and draft review UI.
- `token-server/`: local helper service that issues LiveKit tokens and exposes demo-ready AI endpoints for health checks, translation, STT/TTS contracts, PHI redaction, synthetic consultations, and OpenMRS draft queueing.

The conversational AI agent lives in the companion repository:

https://github.com/sihsalus/openmrs-livekit

That agent owns the real-time AI loop: STT, LLM reasoning/tool calls, TTS, data
channel publication, and OpenMRS draft events. This frontend uses Carbon UI for
the clinical review console and should not contain model secrets or run the
foundation model in the browser.

Typical local flow:

```text
OpenMRS O3 patient chart
  -> LiveKit room
  -> LiveKit AI agent
  -> local helper service
  -> configured model provider / Ollama-compatible drafting
  -> redacted encounter draft
  -> clinician review queue
```

## AI Model Boundary

The frontend does not hardcode a foundation model. It connects the OpenMRS chart
to LiveKit and consumes `agent-data` messages from the LiveKit agent.

Current model selection lives in the agent/helper configuration:

- Agent default LLM: `LLM_PROVIDER=openai` with `OPENAI_MODEL=gpt-4.1-mini`.
- Local-first demo LLM: `LLM_PROVIDER=ollama` with `OLLAMA_MODEL=qwen3:8b`, or
  another local model selected by the site.
- Helper `/compile-encounter`: uses local Ollama when available and falls back to
  deterministic heuristics for demos/tests.

The base agent prompt is Spanish because the current demo targets Spanish
clinical encounters in a Latin American OpenMRS setting. It improves the default
behavior for local clinical wording, negations, and identifiers such as `D.N.I.`
and `H.C.`. It can be replaced by site-specific session instructions in the
agent layer.

## Clinical safety model

The generated draft is not an autonomous diagnosis and is not written directly to the medical record by default. The helper queues the draft locally and returns an OpenMRS encounter payload preview. A real OpenMRS write requires explicit configuration and a write request.

Privacy defaults:

- Raw audio is not stored by default.
- PHI-like identifiers are redacted from generated text.
- Local-only processing is supported for offline-capable deployments.
- Clinician review is required before final charting.

## Getting started

Install frontend dependencies:

```bash
yarn install
```

Run the OpenMRS frontend:

```bash
yarn start
```

Install and run the local helper:

```bash
python3 -m venv token-server/.venv
token-server/.venv/bin/pip install -r token-server/requirements.txt
LIVEKIT_API_KEY=<key> LIVEKIT_API_SECRET=<secret> token-server/.venv/bin/python token-server/server.py
```

The helper listens on port `7890` by default. The frontend derives these defaults when config is left blank:

- LiveKit WebSocket: `ws(s)://<current-browser-host>:7880`
- Token endpoint: `http(s)://<current-browser-host>:7890/token`
- Room prefix: `openmrs-voice-`

For any shared demo, staging, or production deployment, enable the helper
readiness gate and configure browser origins explicitly:

```bash
TOKEN_SERVER_ENV=production
TOKEN_SERVER_ALLOWED_ORIGINS=https://openmrs.example.org
LIVEKIT_API_KEY=<site-livekit-api-key>
LIVEKIT_API_SECRET=<site-livekit-api-secret>
```

Production mode fails fast if LiveKit signing credentials or the CORS allowlist
are missing.

The helper also creates local draft and recording manifest files with owner-only
permissions (`0600`). That is enough for a semi-production demo host, but not a
replacement for encrypted storage in a regulated deployment.

## Configuration

The OpenMRS module config schema exposes:

- `livekitServerUrl`: LiveKit WebSocket URL.
- `tokenEndpoint`: helper endpoint used to request LiveKit room tokens.
- `roomPrefix`: LiveKit room prefix joined by the local agent.

The helper supports optional OpenMRS draft write configuration. See [token-server/README.md](token-server/README.md) for endpoint contracts, OpenMRS write safeguards, and environment variables.

## OpenMRS Base Deployment

The reproducible OpenMRS base stack lives in
[deploy/openmrs-base-livekit](deploy/openmrs-base-livekit). It adds the LiveKit
server, CPU agent, helper/token service, gateway routes, CSP, and frontend module
configuration without committing site secrets.

The normal frontend deployment path is npm:

```bash
npm view @sihsalus/esm-livekit-app version
```

Set `OPENMRS_LIVEKIT_FRONTEND_VERSION` only to a version that is actually
published on npm. If a release tag builds successfully but npm publish fails,
the OpenMRS frontend can temporarily serve a locally built `dist/` directory via
the importmap for demo recovery, but that hotfix is not the long-term
reproducible path.

## Tests

Run the frontend test suite:

```bash
yarn test
```

Run the helper contract tests:

```bash
yarn test:e2e:token-server
```

The helper e2e test starts fake local OpenMRS, Ollama, and LiveKit services, then validates health checks, PHI redaction, synthetic data generation, recording consent, CORS, and an authenticated OpenMRS encounter write against the fake REST API.

Run a smoke test against a real running helper:

```bash
yarn test:smoke:token-server
```

For the full browser, LiveKit, agent, and OpenMRS acceptance checklist, see [docs/e2e-smoke-test.md](docs/e2e-smoke-test.md).

For the 2026 open-source scribe benchmark and reuse decisions, see [docs/open-source-benchmark.md](docs/open-source-benchmark.md).

## Hackathon demo

For the OpenMRS AI Hackathon demo, the project shows OpenMRS, LiveKit, and local AI services running locally. It generates a synthetic bilingual consultation, redacts patient identifiers, and produces a reviewable OpenMRS encounter draft.

The submission focus is the Clinical Track: point-of-care voice support, offline-capable AI, translation, and clinician-reviewed documentation assistance.
