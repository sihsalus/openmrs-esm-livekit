import { describe, expect, it } from 'vitest';
import { materializeEncounterDraft, mergeEncounterDraft } from './encounter-draft';

describe('encounter draft display normalization', () => {
  it('fills visible draft fields from agent facts when top-level fields are empty', () => {
    expect(
      materializeEncounterDraft({
        chiefComplaint: '',
        symptoms: [],
        medicationsMentioned: [],
        allergiesMentioned: [],
        assessmentNotes: '',
        patientInstructions: '',
        reviewQueue: [
          {
            kind: 'assessment',
            value: 'Likely viral upper respiratory tract infection',
            confidence: 0.72,
            status: 'detected',
            needsReview: true,
          },
          {
            kind: 'symptom',
            value: 'persistent cough',
            confidence: 0.91,
            status: 'detected',
          },
        ],
        missingFields: ['Respiratory rate'],
        clinicianReviewRequired: true,
      }),
    ).toMatchObject({
      symptoms: ['persistent cough'],
      assessmentNotes: 'Likely viral upper respiratory tract infection',
      missingFields: ['Respiratory rate'],
    });
  });

  it('does not overwrite visible draft fields with an empty incremental agent draft', () => {
    expect(
      mergeEncounterDraft(
        {
          chiefComplaint: 'Persistent cough and low-grade fever for 5 days',
          symptoms: ['cough', 'low-grade fever'],
          medicationsMentioned: ['paracetamol 500mg q8h'],
          allergiesMentioned: [],
          assessmentNotes: 'Likely viral upper respiratory tract infection.',
          patientInstructions: 'Return if breathing worsens.',
        },
        {
          chiefComplaint: '',
          symptoms: [],
          medicationsMentioned: [],
          allergiesMentioned: [],
          assessmentNotes: '',
          patientInstructions: '',
          reviewQueue: [
            {
              kind: 'assessment',
              value: 'Needs clinician review',
              confidence: 0.7,
              status: 'detected',
              needsReview: true,
            },
          ],
        },
      ),
    ).toMatchObject({
      chiefComplaint: 'Persistent cough and low-grade fever for 5 days',
      symptoms: ['cough', 'low-grade fever'],
      medicationsMentioned: ['paracetamol 500mg q8h'],
      assessmentNotes: 'Needs clinician review',
      patientInstructions: 'Return if breathing worsens.',
    });
  });
});
