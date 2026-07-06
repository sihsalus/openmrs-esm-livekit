// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import VoiceButton from './voice-button.component';

const frameworkMocks = vi.hoisted(() => ({
  showModal: vi.fn(),
  usePatient: vi.fn(),
  useVisit: vi.fn(),
}));

vi.mock('@openmrs/esm-framework', () => frameworkMocks);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

describe('VoiceButton', () => {
  const mutateVisit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    frameworkMocks.showModal.mockReturnValue(vi.fn());
    frameworkMocks.usePatient.mockReturnValue({
      patient: { id: 'patient-uuid' },
      isLoading: false,
    });
    frameworkMocks.useVisit.mockReturnValue({
      activeVisit: { uuid: 'active-visit-uuid' },
      isLoading: false,
      mutate: mutateVisit,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('opens the voice consultation modal when the patient already has an active visit', async () => {
    render(<VoiceButton />);

    await userEvent.click(screen.getByRole('button', { name: /voice consultation/i }));

    expect(frameworkMocks.showModal).toHaveBeenCalledWith(
      'livekit-voice-modal',
      { size: 'lg' },
      expect.any(Function),
    );
  });

  it('uses the standard OpenMRS start visit prompt before opening voice consultation', async () => {
    const closeStartVisitPrompt = vi.fn();
    frameworkMocks.showModal.mockImplementation((modalName: string) => {
      return modalName === 'start-visit-dialog' ? closeStartVisitPrompt : vi.fn();
    });
    frameworkMocks.useVisit.mockReturnValue({
      activeVisit: null,
      isLoading: false,
      mutate: mutateVisit,
    });

    render(<VoiceButton />);

    await userEvent.click(screen.getByRole('button', { name: /voice consultation/i }));

    expect(frameworkMocks.showModal).toHaveBeenCalledTimes(1);
    expect(frameworkMocks.showModal).toHaveBeenCalledWith(
      'start-visit-dialog',
      expect.objectContaining({
        patientUuid: 'patient-uuid',
        closeModal: expect.any(Function),
        onVisitStarted: expect.any(Function),
      }),
    );

    const startVisitProps = frameworkMocks.showModal.mock.calls[0][1] as {
      closeModal: () => void;
      onVisitStarted: () => void;
    };

    startVisitProps.closeModal();
    expect(closeStartVisitPrompt).toHaveBeenCalled();

    startVisitProps.onVisitStarted();

    expect(mutateVisit).toHaveBeenCalled();
    expect(frameworkMocks.showModal).toHaveBeenCalledWith(
      'livekit-voice-modal',
      { size: 'lg' },
      expect.any(Function),
    );
  });

  it('keeps the action disabled until patient and visit context are loaded', () => {
    frameworkMocks.usePatient.mockReturnValue({
      patient: { id: 'patient-uuid' },
      isLoading: false,
    });
    frameworkMocks.useVisit.mockReturnValue({
      activeVisit: null,
      isLoading: true,
      mutate: mutateVisit,
    });

    render(<VoiceButton />);

    expect(screen.getByRole('button', { name: /voice consultation/i })).toBeDisabled();
  });
});
