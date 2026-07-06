export interface FhirEntry {
  resource: Record<string, unknown>;
}

export interface PatientSummary {
  conditions: string[];
  allergies: string[];
  medications: string[];
}

export interface PatientDemographics {
  name: string;
  age?: number;
  gender?: string;
  birthDate?: string;
  identifiers: Array<{
    label: string;
    value: string;
  }>;
  patientUuid?: string;
}

interface PatientNameLike {
  text?: string;
  given?: string[];
  family?: string;
}

interface PatientIdentifierLike {
  value?: string;
  type?: {
    text?: string;
    coding?: Array<{
      display?: string;
    }>;
  };
}

interface PatientLike {
  id?: string;
  name?: PatientNameLike[];
  gender?: string;
  birthDate?: string;
  identifier?: PatientIdentifierLike[];
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

export function buildPatientDemographics(
  patient: PatientLike | null | undefined,
  now = new Date(),
): PatientDemographics {
  const identifiers = patient?.identifier ?? [];
  const birthDate = patient?.birthDate;

  return {
    name: extractPatientName(patient?.name?.[0]),
    age: birthDate ? calculateAge(birthDate, now) : undefined,
    gender: formatGender(patient?.gender),
    birthDate,
    patientUuid: patient?.id,
    identifiers: identifiers
      .filter((identifier) => identifier.value)
      .map((identifier) => ({
        label: identifier.type?.text || identifier.type?.coding?.[0]?.display || 'Identifier',
        value: identifier.value ?? '',
      })),
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

function extractPatientName(name: PatientNameLike | undefined): string {
  if (!name) return '';
  if (name.text) return name.text;

  const parts = [...(name.given ?? []), name.family].filter(Boolean);
  return parts.join(' ');
}

function formatGender(gender: string | undefined): string | undefined {
  if (!gender) return undefined;
  return gender.charAt(0).toUpperCase() + gender.slice(1);
}

function calculateAge(birthDate: string, now: Date): number | undefined {
  const parsedBirthDate = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(parsedBirthDate.getTime())) return undefined;

  let age = now.getUTCFullYear() - parsedBirthDate.getUTCFullYear();
  const currentMonth = now.getUTCMonth();
  const birthMonth = parsedBirthDate.getUTCMonth();
  const hasHadBirthday =
    currentMonth > birthMonth ||
    (currentMonth === birthMonth && now.getUTCDate() >= parsedBirthDate.getUTCDate());

  if (!hasHadBirthday) {
    age -= 1;
  }

  return age >= 0 ? age : undefined;
}
