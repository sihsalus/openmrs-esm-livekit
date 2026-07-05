export interface FhirEntry {
  resource: Record<string, unknown>;
}

export interface PatientSummary {
  conditions: string[];
  allergies: string[];
  medications: string[];
}

export function buildPatientContextPaths(patientId: string): {
  conditions: string;
  allergies: string;
  medications: string;
} {
  const encodedPatientId = encodeURIComponent(patientId);
  return {
    conditions: `/ws/fhir2/R4/Condition?patient=${encodedPatientId}&_count=20`,
    allergies: `/ws/fhir2/R4/AllergyIntolerance?patient=${encodedPatientId}&_count=20`,
    medications: `/ws/fhir2/R4/MedicationRequest?patient=${encodedPatientId}&_count=20`,
  };
}

export function buildPatientSummary(
  conditions: FhirEntry[],
  allergies: FhirEntry[],
  medicationRequests: FhirEntry[],
): PatientSummary {
  return {
    conditions: conditions.map(extractConditionDisplay),
    allergies: allergies.map(extractAllergyDisplay),
    medications: medicationRequests.filter(isActiveMedicationRequest).map(extractMedicationDisplay),
  };
}

export function isActiveMedicationRequest(entry: FhirEntry): boolean {
  return String(entry.resource.status ?? '').toLowerCase() === 'active';
}

export function extractConditionDisplay(entry: FhirEntry): string {
  const r = entry.resource as Record<string, unknown>;
  const code = r.code as { coding?: Array<{ display?: string }>; text?: string } | undefined;
  return code?.text || code?.coding?.[0]?.display || 'Unknown condition';
}

export function extractAllergyDisplay(entry: FhirEntry): string {
  const r = entry.resource as Record<string, unknown>;
  const code = r.code as { coding?: Array<{ display?: string }>; text?: string } | undefined;
  return code?.text || code?.coding?.[0]?.display || 'Unknown allergy';
}

export function extractMedicationDisplay(entry: FhirEntry): string {
  const r = entry.resource as Record<string, unknown>;
  const medCode = r.medicationCodeableConcept as
    | {
        coding?: Array<{ display?: string }>;
        text?: string;
      }
    | undefined;
  return medCode?.text || medCode?.coding?.[0]?.display || 'Unknown medication';
}
