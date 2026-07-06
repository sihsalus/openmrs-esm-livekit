// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import PatientContext from './patient-context.component';

const frameworkMocks = vi.hoisted(() => ({
  openmrsFetch: vi.fn(),
  usePatient: vi.fn(),
}));

vi.mock('@openmrs/esm-framework', () => frameworkMocks);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, options?: Record<string, unknown>) =>
      typeof options?.count === 'number' ? fallback.replace('{{count}}', String(options.count)) : fallback,
  }),
}));

describe('PatientContext', () => {
  beforeEach(() => {
    frameworkMocks.usePatient.mockReturnValue({
      patient: {
        id: 'patient-uuid',
        name: [{ given: ['Joshua'], family: 'Johnson' }],
        gender: 'male',
        birthDate: '2021-09-25',
        identifier: [{ type: { text: 'OpenMRS ID' }, value: '100008E' }],
      },
      isLoading: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows unavailable for a failed FHIR section instead of claiming no data is on file', async () => {
    frameworkMocks.openmrsFetch.mockImplementation((path: string) => {
      if (path.includes('/Condition?')) {
        return Promise.resolve({
          data: { entry: [{ resource: { code: { text: 'Hypertension' } } }] },
        });
      }
      if (path.includes('/AllergyIntolerance?')) {
        return Promise.resolve({
          data: { entry: [{ resource: { code: { text: 'Penicillin' } } }] },
        });
      }
      if (path.includes('/MedicationRequest?')) {
        return Promise.reject(new Error('FHIR MedicationRequest failed'));
      }
      return Promise.resolve({ data: { entry: [] } });
    });

    render(<PatientContext />);

    expect(await screen.findByText('Hypertension')).toBeInTheDocument();
    expect(screen.getByText('Penicillin')).toBeInTheDocument();
    expect(screen.getByText('Unable to load')).toBeInTheDocument();
    expect(
      screen.queryByText('No active conditions, allergies, or medications on file.'),
    ).not.toBeInTheDocument();
  });
});
