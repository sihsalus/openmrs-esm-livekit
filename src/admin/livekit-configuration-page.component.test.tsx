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
    vi.unstubAllGlobals();
  });

  it('renders the operational LiveKit configuration and service health outside the clinical modal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          services: {
            livekit: { status: 'ok' },
            tokenServer: { status: 'ok' },
            agent: { status: 'ok' },
            openmrs: { status: 'ok' },
            openmrsDraftWrite: { status: 'disabled' },
            agentCapabilities: {
              stt: { status: 'configured' },
              tts: { status: 'configured' },
              llm: { status: 'ok' },
            },
            tokenServerAuth: { status: 'enforced' },
            productionReadiness: { status: 'ok' },
            cors: { status: 'ok' },
            localStorage: { status: 'private_files' },
          },
        }),
      }),
    );
    window.history.replaceState({}, '', '/openmrs/spa/livekit-configuration');

    render(<LivekitConfigurationPage />);

    expect(screen.getByRole('heading', { name: 'Voice consultation' })).toBeInTheDocument();
    expect(screen.getByText('wss://voice.example.org/livekit-sfu')).toBeInTheDocument();
    expect(screen.getByText('/openmrs/livekit/token')).toBeInTheDocument();
    expect(screen.getByText('http://localhost:3000/openmrs/livekit/token')).toBeInTheDocument();
    expect(screen.getByText('openmrs-voice-')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Privacy & service health' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Privacy guarantees' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Service health' })).toBeInTheDocument();
    expect(screen.getAllByText('Active via agent')).toHaveLength(3);
    expect(screen.getByText('Review queue')).toBeInTheDocument();
  });
});
