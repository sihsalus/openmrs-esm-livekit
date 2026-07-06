# OpenMRS LiveKit Helper Service

Local helper service for OpenMRS LiveKit. It keeps the existing LiveKit token
endpoint and exposes local AI contracts for validation and self-hosted
deployments.

Default gateway URL on the PowerEdge:

```text
https://sihsalus-main-server.allosaurus-squeaker.ts.net/openmrs/livekit
```

The helper still listens on container port `7890`, but the OpenMRS base compose
file exposes it only to the internal Docker network. Browser traffic should go
through the OpenMRS gateway. Base deployments place the browser token endpoint
under `/openmrs/livekit/token` so OpenMRS session cookies scoped to `/openmrs`
can be forwarded to the helper when `TOKEN_SERVER_REQUIRE_OPENMRS_SESSION=true`.

## Endpoints

### GET /health

Returns local service status for the frontend status panel.

```json
{
  "status": "ok",
  "roomPrefix": "openmrs-voice-",
  "offline": true,
  "livekit": "ok",
  "openmrs": "ok",
  "ollama": "ok",
  "stt": "configured",
  "tts": "configured",
  "helperStt": "not_configured",
  "helperTts": "not_configured"
}
```

Detailed service status is available under `services`, including `services.openmrsDraftWrite` for OpenMRS REST write readiness.
`services.agent` probes `LIVEKIT_AGENT_HEALTH_URL` when configured; in the
self-hosted stack it points at the LiveKit agent metrics endpoint. The helper's
`services.stt` and `services.tts` describe optional dedicated helper endpoints.
The real-time audio room uses `services.agentCapabilities.stt`,
`services.agentCapabilities.tts`, and `services.agentCapabilities.llm`, which
are populated from `LIVEKIT_AGENT_STT_PROVIDER`,
`LIVEKIT_AGENT_TTS_PROVIDER`, and `LIVEKIT_AGENT_LLM_PROVIDER`. The top-level
`stt` and `tts` fields summarize the real-time agent capability; `helperStt`
and `helperTts` summarize the optional helper endpoints.
`services.livekitTokenSigning` reports whether `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` are configured.
`services.tokenServerAuth` reports whether protected helper endpoints require
an authenticated OpenMRS session.
`services.cors` reports whether browser origins are allowlisted, and
`services.productionReadiness` reports whether production checks are enforced.
`services.draftAudit` reports the local draft lifecycle audit log contract.

## AI Boundary

This helper is not the real-time conversational agent. The LiveKit agent in
`sihsalus/openmrs-livekit` owns STT, LLM tool calls, TTS, and data-channel draft
events.

The helper provides local contracts that support validation and smoke tests:

- LiveKit token signing.
- Health/readiness reporting.
- PHI redaction for helper-generated text.
- Synthetic consultation generation.
- `/compile-encounter` local drafting.
- OpenMRS draft queue/write bridge.

`/compile-encounter` requires a `transcript` or `text` field. It uses local
Ollama when available and falls back to deterministic heuristics. Its model is
selected with `OLLAMA_MODEL`; examples use `medgemma:latest`, while the agent's
local-first CPU default uses `qwen2.5:1.5b`.
The frontend and helper do not embed model secrets in browser code.

## Production readiness gate

For shared evaluations, staging, or production, run with production checks
enabled:

```bash
TOKEN_SERVER_ENV=production
# or
TOKEN_SERVER_REQUIRE_PRODUCTION_CONFIG=true
```

When production checks are enabled, startup fails unless all required controls
are configured:

```bash
LIVEKIT_API_KEY=<site-livekit-api-key>
LIVEKIT_API_SECRET=<site-livekit-api-secret>
TOKEN_SERVER_ALLOWED_ORIGINS=https://openmrs.example.org
TOKEN_SERVER_REQUIRE_OPENMRS_SESSION=true
```

Production mode rejects missing LiveKit credentials, LiveKit development
defaults (`devkey` / `secret`), missing OpenMRS session validation, missing CORS
allowlists, and non-HTTPS allowlisted origins except localhost/loopback.

In development mode, CORS remains permissive for local development but `/health`
returns a warning until `TOKEN_SERVER_ALLOWED_ORIGINS` is configured.

## Local storage

Queued drafts and recording consent manifests are local JSONL files. The helper
creates or tightens those files with owner-only permissions (`0600`) and reports
the paths under `services.localStorage`.

This is a KISS semi-production safeguard, not encryption at rest. For regulated
production PHI, place `DRAFT_STORE_PATH` and `RECORDING_MANIFEST_PATH` on an
encrypted volume or replace the JSONL queue with a managed encrypted store.

Draft queue/save/reject audit events are written to a separate owner-only JSONL
file. Audit events intentionally exclude transcript and draft text. Patient
references are stored as salted SHA-256 hashes.

```bash
AUDIT_LOG_PATH=/tmp/openmrs-livekit-audit.jsonl
AUDIT_HASH_SALT=<site-managed-secret>
```

For shared or regulated deployments, `AUDIT_HASH_SALT` should come from the
site secrets manager. The default salt is only suitable for synthetic validation
data.

### POST /token

Existing LiveKit token endpoint.

For shared evaluations, staging, or production, configure LiveKit signing
credentials explicitly:

```bash
LIVEKIT_API_KEY=<livekit-api-key>
LIVEKIT_API_SECRET=<livekit-api-secret>
```

If both variables are missing, the helper falls back to LiveKit development defaults
`devkey` / `secret`, which are only appropriate for a local `livekit-server --dev`
environment. `/health` will report this as `services.livekitTokenSigning.status:
"dev_default"`.

When `LIVEKIT_HTTP_URL` is configured, the helper also performs a best-effort
LiveKit room metadata sync before returning the browser token:

```bash
LIVEKIT_HTTP_URL=http://livekit:7880
```

The metadata payload intentionally stays minimal:

```json
{
  "patientUuid": "aefc6e8d-fdc7-430f-9dae-a1dcbff2cdec",
  "roomPrefix": "openmrs-voice-",
  "doctorLanguage": "es",
  "patientLanguage": "en",
  "agentVoiceLanguage": "es",
  "languageMode": "bilingual",
  "speakerAttributionMode": "source-role",
  "defaultHumanRole": "doctor",
  "source": "openmrs-livekit-token-server"
}
```

`doctorLanguage`, `patientLanguage`, and `agentVoiceLanguage` are normalized to
the supported base codes `en` and `es`. Locale-shaped values such as `es-PE` are
accepted and stored as `es`; unsupported patient languages fall back to the
normalized clinician language. `agentVoiceLanguage` falls back to the clinician
language. If the frontend does not send language metadata, the helper defaults
to English.

The helper also signs participant metadata with:

```json
{
  "role": "clinician",
  "captureRole": "doctor",
  "participantRole": "doctor",
  "defaultHumanRole": "doctor",
  "speakerAttributionMode": "source-role"
}
```

The current OpenMRS browser client uses `captureRole=doctor`. Real role
attribution requires an STT `speaker_id`, a configured `speakerRoleMap`, or a
separate capture flow that supplies patient-role metadata. Without that source,
the agent publishes transcript payloads with a default-role attribution marker
instead of claiming automatic diarization.

If the LiveKit room already exists, the helper updates room metadata instead of
failing the token request. If metadata sync fails, `/token` still returns the
browser token and includes `roomMetadata.status: "error"` so the session can
continue while logs expose the missing metadata path.

```json
{
  "patientUuid": "aefc6e8d-fdc7-430f-9dae-a1dcbff2cdec",
  "roomPrefix": "openmrs-voice-",
  "doctorLanguage": "es",
  "patientLanguage": "en",
  "agentVoiceLanguage": "es",
  "captureRole": "doctor"
}
```

### POST /compile-encounter

Redacts PHI and compiles a clinician-reviewable OpenMRS draft. Uses local Ollama when available and falls back to deterministic heuristics. Requests without `transcript` or `text` return `400`.

Request:

```json
{
  "patientName": "Joshua Johnson",
  "transcript": "Doctor: Joshua Johnson has cough and fever. No known drug allergies. Take paracetamol and return if breathing worsens."
}
```

Response:

```json
{
  "status": "ok",
  "engine": "ollama",
  "model": "medgemma:latest",
  "redactedTranscript": "Doctor: [REDACTED_NAME] has cough and fever...",
  "draft": {
    "chiefComplaint": "cough and fever",
    "symptoms": ["cough", "fever"],
    "medicationsMentioned": ["paracetamol"],
    "allergiesMentioned": [],
    "assessmentNotes": "Requires clinician review.",
    "patientInstructions": "Return if breathing worsens."
  },
  "privacy": {
    "rawAudioStored": false,
    "redactionApplied": true,
    "localOnlyProcessing": true,
    "clinicianReviewRequired": true
  },
  "warnings": []
}
```

### POST /synthetic-consultation

Generates deterministic synthetic doctor-patient dialogue and a
clinician-reviewable draft. This is for validation and e2e tests without real
patient data.

```json
{
  "caseId": "pediatric-respiratory",
  "patientUuid": "synthetic-validation-patient"
}
```

Response includes `transcript`, `redactedTranscript`, `draft`, and `openmrsDraftRequest`, which can be sent to `/openmrs/draft`.

Available cases are exposed in `GET /health` under `services.syntheticData.cases`.

### POST /recording/session

Records a local consent manifest for a future recording workflow. It does not capture or store raw audio by default. Real audio recording should be enabled through LiveKit Egress or browser MediaRecorder only after retention, encryption, and consent rules are configured.

```json
{
  "patientUuid": "aefc6e8d-fdc7-430f-9dae-a1dcbff2cdec",
  "roomName": "openmrs-voice-aefc6e8d-fdc7-430f-9dae-a1dcbff2cdec",
  "consentCaptured": true
}
```

Without explicit consent the endpoint returns `consent_required` and does not create a manifest. Consent manifests are stored in `/tmp/openmrs-livekit-recordings.jsonl`.

### POST /openmrs/draft

Queues a draft locally for clinician review and can optionally create an OpenMRS encounter through the OpenMRS REST API at `/openmrs/ws/rest/v1`.

By default this endpoint is safe: it queues locally and returns a preview of the OpenMRS encounter payload without writing to OpenMRS.

```json
{
  "status": "queued",
  "draftId": "uuid",
  "auditEventId": "uuid",
  "auditEventType": "draft_queued",
  "clinicianReviewRequired": true,
  "openmrsWrite": "queued_only",
  "openmrs": {
    "writeRequested": false,
    "writeEnabled": false,
    "encounterPayload": {
      "encounterDatetime": "2026-06-20T18:10:00.000+0000",
      "patient": "aefc6e8d-fdc7-430f-9dae-a1dcbff2cdec",
      "encounterType": "...",
      "location": "...",
      "obs": [{ "concept": "...", "value": "AI-generated clinical draft..." }]
    }
  }
}
```

To request a real OpenMRS write, send `writeToOpenmrs: true` or `mode: "write"`. The server will only write when `OPENMRS_DRAFT_WRITE_ENABLED=true`, the required metadata is configured, and the request includes a `visitUuid` for an active visit belonging to the patient.

Required write configuration:

```bash
OPENMRS_DRAFT_WRITE_ENABLED=true
OPENMRS_ENCOUNTER_TYPE_UUID=<encounter-type-uuid>
OPENMRS_LOCATION_UUID=<location-uuid>
OPENMRS_DRAFT_OBS_CONCEPT_UUID=<text-concept-uuid-for-ai-draft>
```

Optional provider and structured obs metadata:

```bash
OPENMRS_PROVIDER_UUID=<provider-uuid>
OPENMRS_ENCOUNTER_ROLE_UUID=<encounter-role-uuid>
OPENMRS_STRUCTURED_OBS_CONCEPTS='{"chiefComplaint":"...","symptoms":"...","medicationsMentioned":"...","allergiesMentioned":"...","assessmentNotes":"...","patientInstructions":"..."}'
```

`OPENMRS_DRAFT_OBS_CONCEPT_UUID` keeps the full reviewable text note. Structured concept mappings are additive: when configured, the helper also emits one obs per mapped scalar or list item. A request can override or add mappings with a `structuredObsConcepts` object using the same keys.

Authentication can be supplied either by server environment or forwarded from the O3 frontend request:

```bash
OPENMRS_USERNAME=<username>
OPENMRS_PASSWORD=<password>
# or
OPENMRS_BASIC_AUTH=<base64-user-password-or-full-Basic-header>
```

For browser session forwarding, call the helper with `credentials: 'include'`. The helper accepts the OpenMRS session cookie and validates it against `GET /openmrs/ws/rest/v1/session` before attempting `POST /openmrs/ws/rest/v1/encounter`.

Queued drafts are stored in `/tmp/openmrs-livekit-drafts.jsonl`. They include
the redacted transcript and clinician-reviewable draft. Draft lifecycle audit
events are stored in `/tmp/openmrs-livekit-audit.jsonl` by default and do not
include transcript or draft text.

Audit event types:

- `draft_queued`: draft was queued locally without an OpenMRS write.
- `draft_saved`: OpenMRS accepted the encounter create request.
- `draft_write_rejected`: an OpenMRS write was requested but blocked or rejected
  by configuration, authentication, patient lookup, or the OpenMRS REST API.

### GET /openmrs/draft/config

Returns the current OpenMRS draft write configuration and validates the configured encounter type, location, and draft obs concept against the OpenMRS REST API. The endpoint does not return credentials or clinical text.

Expected healthy shape:

```json
{
  "status": "validated",
  "enabled": true,
  "requiredConfiguration": [],
  "resources": {
    "encounterType": { "status": "ok", "uuid": "...", "display": "Visit Note" },
    "location": { "status": "ok", "uuid": "...", "display": "Outpatient Clinic" },
    "draftObsConcept": {
      "status": "ok",
      "uuid": "...",
      "display": "Text of encounter note",
      "datatype": "Text"
    }
  },
  "validationErrors": []
}
```

Other statuses include `disabled`, `not_configured`, `auth_required`, and `invalid`.

### GET /openmrs/draft/audit

Returns recent draft lifecycle events for the administration page. This is intentionally sanitized: it includes event metadata, write status, encounter UUID, and operational messages, but excludes `draft` and `redactedTranscript`.

```json
{
  "status": "ok",
  "events": [
    {
      "eventType": "draft_write_rejected",
      "openmrsWrite": "visit_required",
      "message": "OpenMRS write requested, but no active visitUuid was supplied.",
      "rawClinicalTextStored": false
    }
  ]
}
```

Use `?limit=20` to bound the number of events returned. The server caps the limit at `100`.

## Tests

Run the frontend and helper contract checks locally:

```bash
yarn test
yarn test:e2e:token-server
```

The token-server e2e test starts fake local OpenMRS, Ollama, and LiveKit services, then validates `/health`, PHI redaction, synthetic data generation, recording consent, CORS, and an authenticated OpenMRS encounter write against the fake REST API.

Run a smoke test against a helper that is already running:

```bash
yarn test:smoke:token-server
```

Override the target URL when testing a remote helper:

```bash
TOKEN_SERVER_SMOKE_URL=https://helper.example.org yarn test:smoke:token-server
```
