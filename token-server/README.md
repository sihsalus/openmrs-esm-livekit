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

Detailed service status is available under `services`.

### POST /token

Existing LiveKit token endpoint.

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

### POST /openmrs/draft

Queues a draft locally for clinician review. This intentionally does not write to OpenMRS yet.

```json
{
  "status": "queued",
  "draftId": "uuid",
  "clinicianReviewRequired": true,
  "openmrsWrite": "disabled"
}
```

Queued drafts are stored in `/tmp/openmrs-livekit-drafts.jsonl`.
