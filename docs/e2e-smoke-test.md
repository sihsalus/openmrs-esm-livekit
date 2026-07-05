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
- `/compile-encounter` redacts name, email, phone, and OpenMRS ID values.
- `/synthetic-consultation` returns synthetic, redacted demo data.
- `/openmrs/draft` queues a clinician-reviewed draft without writing to OpenMRS.

## Manual Browser Smoke

Use only synthetic patient data.

1. Serve OpenMRS over HTTPS or localhost.
2. Configure `livekitServerUrl` with `wss://` for shared environments.
3. Configure `tokenEndpoint` with `https://` for shared environments.
4. Open a synthetic patient chart and launch the LiveKit voice panel.
5. Confirm the health panel shows LiveKit, token server, agent, and OpenMRS status.
6. Join the room with the agent using the same room prefix.
7. Speak a synthetic clinician-patient utterance through the browser microphone.
8. Confirm the live transcript arrives on the `agent-data` data-channel topic.
9. Confirm patient identifiers are redacted before display or draft persistence.
10. Confirm the draft shows missing fields and review queue items.
11. Queue the draft and verify no OpenMRS write occurs unless explicitly enabled.
12. If write mode is enabled, verify the created encounter uses the expected patient,
    encounter type, location, provider, role, and concept UUIDs.

## Not Covered

- Browser-to-agent media quality across real clinic networks.
- LiveKit SFU TLS termination and certificate rotation.
- Application-level end-to-end media encryption.
- Encryption at rest for queued drafts, transcripts, logs, or recording manifests.
- Full OpenMRS role-based access review.
- Clinical validation by a clinician.
