# OpenMRS LiveKit Helper Service

Local helper used by the OpenMRS LiveKit prototype. It keeps the existing LiveKit token endpoint and exposes demo-ready local AI contracts for the hackathon flow.

Default base URL on the PowerEdge:

```text
http://100.120.80.60:7890
```

## Endpoints

### GET /health

Returns local service status for the frontend status panel.

```json
{
  "status": "ok",
  "roomPrefix": "iot-device-",
  "offline": true,
  "livekit": "ok",
  "openmrs": "ok",
  "ollama": "ok",
  "stt": "not_configured",
  "tts": "not_configured"
}
```

Detailed service status is available under `services`, including `services.openmrsDraftWrite` for OpenMRS REST write readiness.
`services.livekitTokenSigning` reports whether `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` are configured.
`services.cors` reports whether browser origins are allowlisted, and
`services.productionReadiness` reports whether production checks are enforced.

## Production readiness gate

For shared demos, staging, or production, run with production checks enabled:

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
```

Production mode rejects missing LiveKit credentials, LiveKit development
defaults (`devkey` / `secret`), missing CORS allowlists, and non-HTTPS
allowlisted origins except localhost/loopback.

In development mode, CORS remains permissive for local demos but `/health`
returns a warning until `TOKEN_SERVER_ALLOWED_ORIGINS` is configured.

### POST /token

Existing LiveKit token endpoint.

For shared demos, staging, or production, configure LiveKit signing credentials explicitly:

```bash
LIVEKIT_API_KEY=<livekit-api-key>
LIVEKIT_API_SECRET=<livekit-api-secret>
```

If both variables are missing, the helper falls back to LiveKit development defaults
`devkey` / `secret`, which are only appropriate for a local `livekit-server --dev`
environment. `/health` will report this as `services.livekitTokenSigning.status:
"dev_default"`.

```json
{
  "patientUuid": "aefc6e8d-fdc7-430f-9dae-a1dcbff2cdec",
  "roomPrefix": "iot-device-"
}
```

### POST /compile-encounter

Redacts PHI and compiles a clinician-reviewable OpenMRS draft. Uses local Ollama when available and falls back to deterministic heuristics.

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

Generates deterministic synthetic doctor-patient dialogue and a clinician-reviewable draft. This is for demos and e2e tests without real patient data.

```json
{
  "caseId": "pediatric-respiratory",
  "patientUuid": "synthetic-demo-patient"
}
```

Response includes `transcript`, `redactedTranscript`, `draft`, and `openmrsDraftRequest`, which can be sent to `/openmrs/draft`.

Available cases are exposed in `GET /health` under `services.syntheticData.cases`.

### POST /recording/session

Records a local consent manifest for a future recording workflow. It does not capture or store raw audio by default. Real audio recording should be enabled through LiveKit Egress or browser MediaRecorder only after retention, encryption, and consent rules are configured.

```json
{
  "patientUuid": "aefc6e8d-fdc7-430f-9dae-a1dcbff2cdec",
  "roomName": "iot-device-aefc6e8d-fdc7-430f-9dae-a1dcbff2cdec",
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

To request a real OpenMRS write, send `writeToOpenmrs: true` or `mode: "write"`. The server will only write when `OPENMRS_DRAFT_WRITE_ENABLED=true` and the required metadata is configured.

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

Queued drafts are stored in `/tmp/openmrs-livekit-drafts.jsonl`.

## Tests

Run the frontend and helper contract checks locally:

```bash
yarn test
yarn test:e2e:token-server
```

The token-server e2e test starts fake local OpenMRS, Ollama, and LiveKit services, then validates `/health`, PHI redaction, synthetic data generation, recording consent, CORS, and an authenticated OpenMRS encounter write against the fake REST API.
