export function buildPatientEncountersUrl(patientUuid: string, encounterUuid: string): string {
  const patient = encodeURIComponent(patientUuid);
  const encounter = encodeURIComponent(encounterUuid);
  const spaBase = openmrsSpaBase();
  return `${spaBase}patient/${patient}/chart/encounters?encounterUuid=${encounter}`;
}

function openmrsSpaBase(): string {
  const openmrsWindow = window as Window & {
    getOpenmrsSpaBase?: () => string;
    spaBase?: string;
  };
  const configuredBase = openmrsWindow.getOpenmrsSpaBase?.() ?? openmrsWindow.spaBase ?? '/openmrs/spa/';
  return configuredBase.replace(/\/?$/, '/');
}
