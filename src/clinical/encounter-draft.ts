import type { AgentClinicalFact, AgentDraft } from '../livekit/use-agent-data';

const chiefComplaintKinds = ['chief_complaint', 'complaint', 'reason_for_visit'];
const symptomKinds = ['symptom', 'symptoms'];
const medicationKinds = ['medication', 'medications', 'medication_mentioned', 'current_medication'];
const allergyKinds = ['allergy', 'allergies', 'drug_allergy'];
const assessmentKinds = ['assessment', 'diagnosis', 'clinical_assessment'];
const instructionKinds = ['instruction', 'instructions', 'patient_instruction', 'plan', 'recommendation'];

export function materializeEncounterDraft(draft: AgentDraft): AgentDraft {
  const facts = collectDraftFacts(draft);

  return {
    ...draft,
    chiefComplaint: draft.chiefComplaint.trim() || firstFactValue(facts, chiefComplaintKinds) || '',
    symptoms: draft.symptoms.length > 0 ? draft.symptoms : factValues(facts, symptomKinds),
    medicationsMentioned:
      draft.medicationsMentioned.length > 0 ? draft.medicationsMentioned : factValues(facts, medicationKinds),
    allergiesMentioned:
      draft.allergiesMentioned.length > 0 ? draft.allergiesMentioned : factValues(facts, allergyKinds),
    assessmentNotes: draft.assessmentNotes.trim() || factValues(facts, assessmentKinds).join('\n'),
    patientInstructions: draft.patientInstructions.trim() || factValues(facts, instructionKinds).join('\n'),
  };
}

export function mergeEncounterDraft(current: AgentDraft | null, incoming: AgentDraft): AgentDraft {
  const next = materializeEncounterDraft(incoming);
  if (!current) {
    return next;
  }

  return {
    ...current,
    ...next,
    chiefComplaint: next.chiefComplaint.trim() || current.chiefComplaint,
    symptoms: next.symptoms.length > 0 ? next.symptoms : current.symptoms,
    medicationsMentioned:
      next.medicationsMentioned.length > 0 ? next.medicationsMentioned : current.medicationsMentioned,
    allergiesMentioned:
      next.allergiesMentioned.length > 0 ? next.allergiesMentioned : current.allergiesMentioned,
    assessmentNotes: next.assessmentNotes.trim() || current.assessmentNotes,
    patientInstructions: next.patientInstructions.trim() || current.patientInstructions,
    missingFields: next.missingFields ?? current.missingFields,
    facts: next.facts ?? current.facts,
    reviewQueue: next.reviewQueue ?? current.reviewQueue,
    clinicianReviewRequired: next.clinicianReviewRequired ?? current.clinicianReviewRequired,
  };
}

function collectDraftFacts(draft: AgentDraft): AgentClinicalFact[] {
  const seen = new Set<string>();
  return [...(draft.facts ?? []), ...(draft.reviewQueue ?? [])].filter((fact) => {
    const key = `${fact.kind}:${fact.value}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function firstFactValue(facts: AgentClinicalFact[], kinds: string[]): string | undefined {
  return factValues(facts, kinds)[0];
}

function factValues(facts: AgentClinicalFact[], kinds: string[]): string[] {
  const allowedKinds = new Set(kinds.map(normalizeFactKind));
  return facts
    .filter((fact) => allowedKinds.has(normalizeFactKind(fact.kind)))
    .map((fact) => fact.value.trim())
    .filter(Boolean);
}

function normalizeFactKind(kind: string): string {
  return kind
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, '_');
}
