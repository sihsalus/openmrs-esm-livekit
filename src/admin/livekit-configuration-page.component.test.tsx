// @vitest-environment happy-dom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/ai/runtime-config')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: 'ok',
            config: {
              localAiFirst: true,
              sttProvider: 'whisper',
              ttsProvider: 'piper',
              deepgramModel: 'nova-3',
              deepgramEnableDiarization: true,
              deepgramUseFlux: false,
              inworldModel: 'inworld-tts-2',
            },
            providers: {
              stt: [
                {
                  id: 'whisper',
                  label: 'Local Whisper',
                  locality: 'local',
                  configured: true,
                  supportsDiarization: false,
                },
                {
                  id: 'deepgram',
                  label: 'Deepgram Nova',
                  locality: 'cloud',
                  configured: true,
                  supportsDiarization: true,
                },
              ],
              tts: [
                { id: 'piper', label: 'Local Piper', locality: 'local', configured: true },
                { id: 'inworld', label: 'Inworld TTS', locality: 'cloud', configured: false },
              ],
            },
            warnings: [],
          }),
        });
      }

      if (url.includes('/openmrs/draft/config')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: 'validated',
            enabled: true,
            message: 'OpenMRS draft write configuration is valid.',
            values: {
              encounterTypeUuid: 'encounter-type-uuid',
              locationUuid: 'location-uuid',
              draftObsConceptUuid: 'obs-concept-uuid',
            },
            resources: {
              encounterType: {
                status: 'ok',
                uuid: 'encounter-type-uuid',
                display: 'Visit Note',
              },
              location: {
                status: 'ok',
                uuid: 'location-uuid',
                display: 'Outpatient Clinic',
              },
              draftObsConcept: {
                status: 'ok',
                uuid: 'obs-concept-uuid',
                display: 'Text of encounter note',
                datatype: 'Text',
              },
            },
            validationErrors: [],
          }),
        });
      }

      if (url.includes('/openmrs/draft/audit')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: 'ok',
            events: [
              {
                id: 'audit-event-1',
                createdAt: 1783296000,
                eventType: 'draft_write_rejected',
                openmrsWrite: 'visit_required',
                message: 'OpenMRS write requested, but no active visitUuid was supplied.',
                rawClinicalTextStored: false,
              },
            ],
          }),
        });
      }

      return Promise.resolve({
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
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState({}, '', '/openmrs/spa/livekit-configuration');

    render(<LivekitConfigurationPage />);

    expect(screen.getByRole('heading', { name: 'Voice consultation' })).toBeInTheDocument();
    expect(screen.getByText('wss://voice.example.org/livekit-sfu')).toBeInTheDocument();
    expect(screen.getByText('/openmrs/livekit/token')).toBeInTheDocument();
    expect(screen.getByText('http://localhost:3000/openmrs/livekit/token')).toBeInTheDocument();
    expect(screen.getByText('openmrs-voice-')).toBeInTheDocument();
    expect(await screen.findByLabelText('STT provider')).toBeInTheDocument();
    expect(screen.getByLabelText('TTS provider')).toBeInTheDocument();
    expect(screen.getAllByText('Local first').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('tab', { name: 'Service health' }));
    expect(await screen.findByRole('heading', { name: 'Privacy & service health' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Privacy guarantees' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Service health' })).toBeInTheDocument();
    expect(screen.getAllByText('Active via agent')).toHaveLength(3);
    expect(screen.getByText('Review queue')).toBeInTheDocument();

    expect(screen.queryByRole('tab', { name: 'Draft audit' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Drafts' }));
    expect(
      await screen.findByRole('heading', { name: 'OpenMRS draft write configuration' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Validated')).toBeInTheDocument();
    expect(screen.getByText('Visit Note')).toBeInTheDocument();
    expect(screen.getByText('Outpatient Clinic')).toBeInTheDocument();
    expect(screen.getByText('Text of encounter note')).toBeInTheDocument();

    expect(await screen.findByRole('heading', { name: 'Draft audit' })).toBeInTheDocument();
    expect(screen.getByText('draft_write_rejected')).toBeInTheDocument();
    expect(screen.getByText('visit_required')).toBeInTheDocument();
  });

  it('keeps validated draft write configuration visible when audit loading fails', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/ai/runtime-config')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: 'ok',
            config: {
              localAiFirst: true,
              sttProvider: 'whisper',
              ttsProvider: 'piper',
              deepgramModel: 'nova-3',
              deepgramEnableDiarization: true,
              deepgramUseFlux: false,
              inworldModel: 'inworld-tts-2',
            },
            warnings: [],
          }),
        });
      }

      if (url.includes('/openmrs/draft/config')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: 'validated',
            enabled: true,
            values: {
              encounterTypeUuid: 'encounter-type-uuid',
              locationUuid: 'location-uuid',
              draftObsConceptUuid: 'obs-concept-uuid',
            },
            resources: {
              encounterType: {
                status: 'ok',
                uuid: 'encounter-type-uuid',
                display: 'Visit Note',
              },
              location: {
                status: 'ok',
                uuid: 'location-uuid',
                display: 'Outpatient Clinic',
              },
              draftObsConcept: {
                status: 'ok',
                uuid: 'obs-concept-uuid',
                display: 'Text of encounter note',
                datatype: 'Text',
              },
            },
            validationErrors: [],
          }),
        });
      }

      if (url.includes('/openmrs/draft/audit')) {
        return Promise.resolve(
          new Response(JSON.stringify({ message: 'Audit store unavailable' }), {
            status: 500,
            statusText: 'Internal Server Error',
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({
          services: {
            livekit: { status: 'ok' },
            tokenServer: { status: 'ok' },
            agent: { status: 'ok' },
            openmrs: { status: 'ok' },
            openmrsDraftWrite: { status: 'configured' },
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
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState({}, '', '/openmrs/spa/livekit-configuration');

    render(<LivekitConfigurationPage />);

    fireEvent.click(screen.getByRole('tab', { name: 'Drafts' }));
    expect(await screen.findByText('Visit Note')).toBeInTheDocument();
    expect(screen.getByText('Outpatient Clinic')).toBeInTheDocument();
    expect(screen.getByText('Text of encounter note')).toBeInTheDocument();
    expect(
      await screen.findByText(
        'Draft audit request failed: 500 Internal Server Error - Audit store unavailable',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Draft audit unavailable.')).toBeInTheDocument();
  });

  it('shows cloud provider state and keeps Deepgram Flux mutually exclusive with diarization', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes('/ai/runtime-config')) {
        const config =
          init?.method === 'POST'
            ? JSON.parse(String(init.body))
            : {
                localAiFirst: true,
                sttProvider: 'deepgram',
                ttsProvider: 'piper',
                deepgramModel: 'nova-3',
                deepgramEnableDiarization: true,
                deepgramUseFlux: false,
                inworldModel: 'inworld-tts-2',
              };
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: 'ok',
            config,
            effectiveConfig: config,
            providers: {
              stt: [
                { id: 'whisper', label: 'Local Whisper', locality: 'local', configured: true },
                {
                  id: 'deepgram',
                  label: 'Deepgram Nova',
                  locality: 'cloud',
                  configured: true,
                  supportsDiarization: true,
                },
              ],
              tts: [
                { id: 'piper', label: 'Local Piper', locality: 'local', configured: true },
                { id: 'inworld', label: 'Inworld TTS', locality: 'cloud', configured: false },
              ],
            },
            warnings: [],
          }),
        });
      }

      if (url.includes('/openmrs/draft/config')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ status: 'disabled', enabled: false, validationErrors: [] }),
        });
      }

      if (url.includes('/openmrs/draft/audit')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ status: 'ok', events: [] }),
        });
      }

      return Promise.resolve({
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
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState({}, '', '/openmrs/spa/livekit-configuration');

    render(<LivekitConfigurationPage />);

    expect((await screen.findAllByText('Cloud STT active')).length).toBeGreaterThan(0);
    expect(screen.getByText('Deepgram STT')).toBeInTheDocument();
    expect(screen.getByText('STT speaker IDs')).toBeInTheDocument();

    const fluxToggle = screen.getByLabelText('Deepgram Flux') as HTMLInputElement;
    const diarizationToggle = screen.getByLabelText('Deepgram diarization') as HTMLInputElement;
    expect(diarizationToggle).toBeChecked();
    expect(fluxToggle).not.toBeChecked();

    fireEvent.click(fluxToggle);

    expect(fluxToggle).toBeChecked();
    expect(diarizationToggle).not.toBeChecked();
    expect(screen.getByText('Deepgram Flux STT')).toBeInTheDocument();
    expect(screen.getByText('Source-role fallback')).toBeInTheDocument();
  });
});
