// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import LivekitConfigurationPage from './livekit-configuration-page.component';

vi.mock('@openmrs/esm-framework', () => ({
  useConfig: () => ({
    livekitServerUrl: 'wss://voice.example.org/livekit-sfu',
    tokenEndpoint: '/openmrs/livekit/token',
    roomPrefix: 'openmrs-voice-',
    enableDemoFlow: false,
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

describe('LivekitConfigurationPage', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the operational LiveKit configuration outside the clinical modal', () => {
    window.history.replaceState({}, '', '/openmrs/spa/livekit-configuration');

    render(<LivekitConfigurationPage />);

    expect(screen.getByRole('heading', { name: 'Voice consultation' })).toBeInTheDocument();
    expect(screen.getByText('wss://voice.example.org/livekit-sfu')).toBeInTheDocument();
    expect(screen.getByText('/openmrs/livekit/token')).toBeInTheDocument();
    expect(screen.getByText('http://localhost:3000/openmrs/livekit/token')).toBeInTheDocument();
    expect(screen.getByText('openmrs-voice-')).toBeInTheDocument();
  });
});
