import { describe, expect, it } from 'vitest';
import { buildPatientContextPaths, buildPatientSummary, isActiveMedicationRequest } from './patient-context';

describe('patient context FHIR helpers', () => {
  it('does not use the MedicationRequest status search parameter', () => {
    const paths = buildPatientContextPaths('patient uuid/with space');

    expect(paths.medications).toBe(
      '/ws/fhir2/R4/MedicationRequest?patient=patient%20uuid%2Fwith%20space&_count=20',
    );
    expect(paths.medications).not.toContain('status=');
  });

  it('filters active MedicationRequest resources locally', () => {
    expect(isActiveMedicationRequest({ resource: { status: 'active' } })).toBe(true);
    expect(isActiveMedicationRequest({ resource: { status: 'completed' } })).toBe(false);
    expect(isActiveMedicationRequest({ resource: {} })).toBe(false);
  });

  it('builds a patient summary from active medications only', () => {
    expect(
      buildPatientSummary(
        [{ resource: { code: { text: 'Hypertension' } } }],
        [{ resource: { code: { coding: [{ display: 'Penicillin' }] } } }],
        [
          {
            resource: {
              status: 'active',
              medicationCodeableConcept: { text: 'Metformin' },
            },
          },
          {
            resource: {
              status: 'stopped',
              medicationCodeableConcept: { text: 'Ibuprofen' },
            },
          },
        ],
      ),
    ).toEqual({
      conditions: ['Hypertension'],
      allergies: ['Penicillin'],
      medications: ['Metformin'],
    });
  });
});
