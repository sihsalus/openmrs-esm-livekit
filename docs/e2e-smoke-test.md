# End-to-End Smoke Test

This checklist is the minimum bar before presenting the prototype as tested in
a real environment. It complements automated unit and contract tests; it does
not make the project production-ready by itself.

## Automated Helper Smoke

Start the helper with the same environment used by the demo:

```bash
LIVEKIT_API_KEY=<key> LIVEKIT_API_SECRET=<secret> python3 token-server/server.py
```

Run the smoke test against the helper:

```bash
yarn test:smoke:token-server
```

For a remote helper:

```bash
TOKEN_SERVER_SMOKE_URL=https://helper.example.org yarn test:smoke:token-server
```

The smoke test verifies:

- `/health` reports the agent data-channel contract.
- `/token` returns an HS256 LiveKit JWT with a room-scoped join grant.
- `/compile-encounter` redacts name, email, phone, local document IDs, and
  OpenMRS ID values.
- `/synthetic-consultation` returns synthetic, redacted demo data.
- `/openmrs/draft` queues a clinician-reviewed draft without writing to OpenMRS.

## Real Environment Preflight

Use only synthetic patient data.

Record these values before the browser smoke:

```text
OpenMRS URL:
LiveKit WebSocket URL:
Token endpoint:
Agent command/container:
Room prefix:
Synthetic patient UUID:
OpenMRS encounter type UUID:
OpenMRS location UUID:
Draft obs concept UUID:
```

Required preflight checks:

1. OpenMRS is served over HTTPS, or every service is localhost-only.
2. `livekitServerUrl` is `wss://` for shared environments.
3. `tokenEndpoint` is `https://` for shared environments.
4. Helper runs with `TOKEN_SERVER_ENV=production` or
   `TOKEN_SERVER_REQUIRE_PRODUCTION_CONFIG=true` for shared demos.
5. Helper `/health` shows configured LiveKit token signing and a non-permissive
   CORS allowlist for the OpenMRS browser origin.
6. Frontend `roomPrefix`, helper `LIVEKIT_ROOM_PREFIX`, and agent
   `LIVEKIT_ROOM_PREFIX` match exactly.
7. Agent process is running with the intended STT, LLM, and TTS providers.
8. Browser microphone permission is granted and visible in the browser site
   settings.

## Manual Browser Smoke

1. Open a synthetic patient chart and launch the LiveKit voice panel.
2. Confirm the health panel shows LiveKit, token server, local storage, agent,
   OpenMRS, and draft write readiness.
3. Confirm the agent publishes an `agent_connected` or `agent_listening` status
   on the `agent-data` data-channel topic before the first transcript.
4. Speak this synthetic utterance through the browser microphone:

   ```text
   Paciente: Maria Fernanda Quispe, H.C. A-998877, vive en Av. Los Incas 123.
   Tiene tos seca desde hace cinco dias. Niega alergias a medicamentos.
   Toma paracetamol 500 mg cada ocho horas.
   ```

5. Confirm the live transcript arrives on the `agent-data` data-channel topic.
6. Confirm patient identifiers are redacted before display or draft persistence:
   `Maria Fernanda Quispe`, `A-998877`, and `Av. Los Incas 123` must not appear
   in frontend transcript text, stored evidence snippets, queued draft text, or
   helper logs.
7. Confirm negation is preserved: `niega alergias` must not become a positive
   allergy.
8. Confirm medication and dose are preserved for review:
   `paracetamol 500 mg cada ocho horas`.
9. Confirm the draft shows missing fields and review queue items.
10. Queue the draft and verify no OpenMRS write occurs unless explicitly enabled.
11. Confirm the helper writes a `draft_queued`, `draft_saved`, or
    `draft_write_rejected` audit event without transcript or draft text.
12. If write mode is enabled, verify the created encounter uses the expected patient,
    encounter type, location, provider, role, and concept UUIDs.
13. Reload the patient chart and verify the saved/queued draft state is
    explainable to a clinician reviewer.

## Demo Logs

For the self-hosted demo stack, use container logs to verify the browser,
LiveKit, helper, and agent path without storing raw clinical audio or transcript
text:

```bash
docker logs -f openmrs-distro-referenceapplication-gateway-1
docker logs -f openmrs-distro-referenceapplication-livekit-helper-1
docker logs -f openmrs-distro-referenceapplication-livekit-1
docker logs -f openmrs-distro-referenceapplication-livekit-agent-cpu-1
docker logs -f openmrs-distro-referenceapplication-backend-1
```

Useful signals:

- Gateway: static microfrontend chunks, `/livekit/token`, `/livekit/health`, and
  OpenMRS REST/FHIR status codes.
- Helper: token, health, synthetic consultation, compile, and draft queue
  requests.
- LiveKit: browser participant joins, agent assignment, ICE/UDP connection type,
  track publication, and room close reason.
- Agent: room connection, metadata parsing, prompt budgeting, readiness status,
  TTS/STT/LLM timing, and transcript-save policy.

The expected demo logging posture is metadata and operational status only.
Helper and agent logs must not include raw transcript text, draft text, or
unredacted patient identifiers.

### Known Weakness Validation

Room metadata validation:

```bash
docker logs openmrs-distro-referenceapplication-livekit-helper-1 \
  | grep -E "LiveKit room metadata (created|updated)"
docker logs openmrs-distro-referenceapplication-livekit-agent-cpu-1 \
  | grep -E "Metadata parsed|Room metadata derived from room name|Room metadata empty|Sending initial greeting"
```

Expected result:

- Helper logs `LiveKit room metadata created` or `updated` for rooms opened
  from the OpenMRS microfrontend when `LIVEKIT_HTTP_URL` is configured.
- Agent logs `Metadata parsed` when LiveKit room metadata is available.
- The helper room metadata includes normalized `doctorLanguage`,
  `patientLanguage`, `agentVoiceLanguage`, `languageMode`,
  `speakerAttributionMode`, and `defaultHumanRole`.
- English is the expected default when OpenMRS does not expose a Spanish locale.
  Spanish OpenMRS locales such as `es`, `es-PE`, or `es_MX` should produce
  Spanish room metadata.
- The agent uses `doctorLanguage` for STT language hints, `agentVoiceLanguage`
  for the initial greeting and assistant transcript language labels, and
  `patientLanguage` for patient-facing translation context.
- Agent may log `Room metadata derived from room name` as a non-blocking
  fallback for rooms named with the configured prefix, for example
  `openmrs-voice-<patientUuid>`.
- `Room metadata empty` should only appear for rooms that do not match the
  configured agent room prefix or cannot expose a patient UUID safely.
- Transcript payloads should include `speakerId` and
  `attributionMode=stt-speaker-id` when the STT provider emits speaker IDs. If
  no speaker ID is available, the payload should include
  `attributionSource=missing-speaker-id` and fall back to `defaultHumanRole`.
  That fallback is intentionally not presented as automatic diarization.

OpenMRS base FHIR MedicationRequest validation:

```bash
curl -I "$OPENMRS_BASE_URL/ws/fhir2/R4/MedicationRequest?patient=<uuid>&_count=20"
curl -I "$OPENMRS_BASE_URL/ws/fhir2/R4/MedicationRequest?patient=<uuid>&status=active&_count=20"
```

Expected result:

- The first request should return `200`.
- On the observed OpenMRS base distro with `fhir2-api-4.1.0`, the second
  request can return `500` due to a backend `NullPointerException`.
- The microfrontend avoids that backend bug by fetching MedicationRequest
  without the `status` search parameter and filtering `status === "active"`
  locally.

## Go / No-Go Criteria

Go for hackathon demo only if all are true:

- Browser joins the room without mixed-content errors.
- Microphone publishes audio and the agent receives it.
- Agent publishes readiness status over `agent-data`.
- At least one transcript and one draft arrive in the frontend.
- Synthetic identifiers are redacted before display or persistence.
- Draft remains reviewable and does not write to OpenMRS unless explicitly
  enabled.
- Draft lifecycle audit events are present and exclude raw transcript/draft
  content.
- If OpenMRS write is enabled, the encounter appears under the synthetic
  patient with the configured metadata and concept UUIDs.

No-go if any are true:

- Browser requires cleartext `ws://` or `http://` outside localhost.
- Token server accepts an unexpected browser origin in shared environments.
- Agent joins a different room prefix than the frontend.
- Raw synthetic identifiers appear in transcript, draft, logs, or JSONL queues.
- Audit JSONL events contain transcript text or draft text.
- `niega alergias` becomes a positive allergy.
- OpenMRS write occurs without explicit operator action and configuration.

## Not Covered

- Browser-to-agent media quality across real clinic networks.
- LiveKit SFU TLS termination and certificate rotation.
- Application-level end-to-end media encryption.
- Encryption at rest for queued drafts, transcripts, logs, or recording manifests.
- Full OpenMRS role-based access review.
- Clinical validation by a clinician.
- Local clinical NER with site dictionaries. Current redaction is deterministic
  pattern matching with local Spanish healthcare identifiers.
