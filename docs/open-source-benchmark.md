# 2026 Open-Source Scribe Benchmark

This note records the open-source projects reviewed before the hackathon test
freeze. The goal is to borrow practical product patterns without replacing the
OpenMRS-first architecture.

## Positioning

OpenMRS LiveKit is not trying to become a generic commercial ambient scribe. Its
specific product wedge is:

```text
OpenMRS O3 patient chart
  -> LiveKit realtime room
  -> local-first AI workflow
  -> PHI-like redaction
  -> evidence-backed encounter draft
  -> clinician review before OpenMRS write
```

That positioning remains distinct from larger 2026 scribes because it focuses on
OpenMRS deployments, local/offline operation, Spanish clinical encounters, and
reviewable OpenMRS payloads.

## Reviewed Projects

| Project | License | What matters | Reuse decision |
| --- | --- | --- | --- |
| [Berta AI Scribe](https://github.com/phairlab/berta-ai-scribe) | Apache 2.0 | Serious FastAPI + Next.js scribe with local/cloud model paths, templates, auth, AWS deployment, and a published deployment paper. | Use as architecture and deployment benchmark. Do not port wholesale before the demo. |
| [Open Medical Scribe](https://github.com/BirgerMoell/open-medical-scribe) | MIT | Clean provider registry for STT and note generation, local/cloud/hybrid modes, FHIR DocumentReference export, audit logging, and multiple note styles. | Reuse ideas for provider boundaries, audit events, and future FHIR export. |
| [scribeHC](https://github.com/trevorpfiz/scribeHC) | MIT | Mobile recording plus dashboard workflow using Expo, Next.js, FastAPI, and SOAP note editing. | Useful UX reference only; OpenMRS O3 already owns our frontend surface. |
| [AI-Scribe](https://github.com/1984Doc/AI-Scribe) | GPL-3.0 | Local Whisper and local LLM scribe pattern. | Reference only. Do not copy code into this repo because GPL would change licensing obligations. |

## Adopted Now

- Keep the current OpenMRS O3 frontend and LiveKit agent architecture.
- Keep local-first provider configuration instead of depending on one hosted
  model.
- Add helper-side draft lifecycle audit events for `draft_queued`,
  `draft_saved`, and `draft_write_rejected`.
- Keep audit events minimal: no transcript text, no draft text, and only hashed
  patient references.
- Keep the clinical safety claim narrow: assistive documentation with clinician
  review, not diagnosis or autonomous charting.

## Later Product Work

- Add a formal note-quality evaluation rubric, such as PDQI-9-style review, for
  clinician scoring of generated drafts.
- Add specialty-specific templates and OpenMRS concept mapping packs.
- Add local clinical NER with site dictionaries and a labeled Spanish PHI test
  corpus.
- Add encrypted storage and immutable audit storage for regulated deployments.
- Add optional FHIR export where OpenMRS implementations prefer FHIR resources
  over REST encounter payloads.
