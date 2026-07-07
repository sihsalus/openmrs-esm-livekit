// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { buildPatientEncountersUrl } from './openmrs-url';

describe('buildPatientEncountersUrl', () => {
  afterEach(() => {
    delete (window as Window & { getOpenmrsSpaBase?: () => string }).getOpenmrsSpaBase;
    delete (window as Window & { spaBase?: string }).spaBase;
  });

  it('builds a patient encounter URL from the OpenMRS SPA base', () => {
    (window as Window & { getOpenmrsSpaBase?: () => string }).getOpenmrsSpaBase = () => '/openmrs/spa/';

    expect(buildPatientEncountersUrl('patient-uuid', 'encounter-uuid')).toBe(
      '/openmrs/spa/patient/patient-uuid/chart/encounters?encounterUuid=encounter-uuid',
    );
  });

  it('falls back to window.spaBase and encodes URL parts', () => {
    (window as Window & { spaBase?: string }).spaBase = '/custom/spa';

    expect(buildPatientEncountersUrl('patient/uuid', 'encounter uuid')).toBe(
      '/custom/spa/patient/patient%2Fuuid/chart/encounters?encounterUuid=encounter%20uuid',
    );
  });
});
