import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildOpenmrsDraftWritePayload,
  buildQueuedOpenmrsDraftPayload,
  buildRoomName,
  fetchLivekitToken,
  fetchOpenmrsDraftAudit,
  fetchOpenmrsDraftWriteConfig,
  resolveLivekitServerUrl,
  resolveTokenEndpoint,
  resolveTokenServerPath,
  saveOpenmrsDraft,
} from './livekit-token';

describe('LiveKit token endpoint transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('derives secure transport URLs when OpenMRS is served over HTTPS', () => {
    stubBrowserLocation('https://openmrs.example/spa/home');

    expect(resolveLivekitServerUrl()).toBe('wss://openmrs.example/livekit-sfu');
    expect(resolveTokenEndpoint()).toBe('https://openmrs.example:7890/token');
  });

  it('derives the LiveKit gateway URL from the current browser host', () => {
    stubBrowserLocation('https://100.120.80.60/openmrs/spa/home');

    expect(resolveLivekitServerUrl()).toBe('wss://100.120.80.60/livekit-sfu');

    stubBrowserLocation('https://192.168.200.231:8443/openmrs/spa/home');

    expect(resolveLivekitServerUrl()).toBe('wss://192.168.200.231:8443/livekit-sfu');
  });

  it('rejects configured cleartext endpoints from an HTTPS OpenMRS page', () => {
    stubBrowserLocation('https://openmrs.example/spa/home');

    expect(() => resolveLivekitServerUrl('ws://gateway.example:7880')).toThrow(
      'LiveKit server URL must use wss:// when OpenMRS is served over HTTPS',
    );
    expect(() => resolveTokenEndpoint('http://gateway.example:7890/token')).toThrow(
      'Token endpoint must use https:// when OpenMRS is served over HTTPS',
    );
  });

  it('allows loopback cleartext endpoints for local HTTPS demos', () => {
    stubBrowserLocation('https://openmrs.example/spa/home');

    expect(resolveLivekitServerUrl('ws://127.0.0.1:7880')).toBe('ws://127.0.0.1:7880');
    expect(resolveTokenEndpoint('http://localhost:7890/token')).toBe('http://localhost:7890/token');
    expect(resolveTokenEndpoint('http://[::1]:7890/token')).toBe('http://[::1]:7890/token');
  });

  it('resolves token-server helper paths without downgrading HTTPS', () => {
    stubBrowserLocation('https://openmrs.example/spa/home');

    expect(resolveTokenServerPath('https://openmrs.example:7890/token', '/health')).toBe(
      'https://openmrs.example:7890/health',
    );
    expect(resolveTokenServerPath('/openmrs/livekit/token', '/openmrs/draft')).toBe(
      'https://openmrs.example/openmrs/livekit/openmrs/draft',
    );
  });

  it('uses a clinical OpenMRS room prefix when none is configured', () => {
    expect(buildRoomName('patient/uuid', '')).toBe('openmrs-voice-patient-uuid');
  });

  it('builds queued draft payloads without requesting an OpenMRS write', () => {
    expect(
      buildQueuedOpenmrsDraftPayload({
        patientUuid: 'patient-123',
        draft: {
          chiefComplaint: 'Cough',
          symptoms: ['cough'],
          medicationsMentioned: [],
          allergiesMentioned: [],
          assessmentNotes: 'Review required.',
          patientInstructions: 'Return if symptoms worsen.',
        },
        redactedTranscript: 'Doctor: cough',
        visitUuid: 'active-visit-123',
      }),
    ).toMatchObject({
      patientUuid: 'patient-123',
      visitUuid: 'active-visit-123',
      writeToOpenmrs: false,
    });
  });

  it('builds reviewed draft payloads that explicitly request an OpenMRS write', () => {
    expect(
      buildOpenmrsDraftWritePayload({
        patientUuid: 'patient-123',
        draft: {
          chiefComplaint: 'Cough',
          symptoms: ['cough'],
          medicationsMentioned: [],
          allergiesMentioned: [],
          assessmentNotes: 'Reviewed.',
          patientInstructions: 'Return if symptoms worsen.',
        },
        redactedTranscript: 'Doctor: cough',
        visitUuid: 'active-visit-123',
      }),
    ).toMatchObject({
      patientUuid: 'patient-123',
      visitUuid: 'active-visit-123',
      writeToOpenmrs: true,
    });
  });

  it('sends selected clinical languages when requesting a room token', async () => {
    stubBrowserLocation('https://openmrs.example/spa/home');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'signed-token', roomName: 'openmrs-voice-patient-123' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchLivekitToken('patient-123', 'https://openmrs.example/livekit/token', 'openmrs-voice-', {
        doctorLanguage: 'es',
        patientLanguage: 'en',
        agentVoiceLanguage: 'es',
      }),
    ).resolves.toEqual({ token: 'signed-token', roomName: 'openmrs-voice-patient-123' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const requestBody = JSON.parse(init.body as string);
    expect(init.credentials).toBe('include');
    expect(requestBody).toEqual({
      patientUuid: 'patient-123',
      roomName: 'openmrs-voice-patient-123',
      roomPrefix: 'openmrs-voice-',
      doctorLanguage: 'es',
      patientLanguage: 'en',
      agentVoiceLanguage: 'es',
      captureRole: 'doctor',
      defaultHumanRole: 'doctor',
      speakerAttributionMode: 'source-role',
    });
  });

  it('sends the active visit uuid when requesting a room token', async () => {
    stubBrowserLocation('https://openmrs.example/spa/home');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'signed-token', roomName: 'openmrs-voice-patient-123' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchLivekitToken(
      'patient-123',
      'https://openmrs.example/livekit/token',
      'openmrs-voice-',
      {
        doctorLanguage: 'en',
        patientLanguage: 'en',
        agentVoiceLanguage: 'en',
      },
      { visitUuid: 'visit-123' },
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      patientUuid: 'patient-123',
      visitUuid: 'visit-123',
    });
  });

  it('can request a patient capture token for single-browser role simulation', async () => {
    stubBrowserLocation('https://openmrs.example/spa/home');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'signed-token', roomName: 'openmrs-voice-patient-123' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchLivekitToken(
      'patient-123',
      'https://openmrs.example/livekit/token',
      'openmrs-voice-',
      {
        doctorLanguage: 'en',
        patientLanguage: 'es',
        agentVoiceLanguage: 'es',
      },
      { visitUuid: 'visit-123', captureRole: 'patient' },
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      captureRole: 'patient',
      defaultHumanRole: 'patient',
    });
  });

  it('includes JSON error details from token requests', async () => {
    stubBrowserLocation('https://openmrs.example/spa/home');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            code: 'livekit_metadata_error',
            error: 'LiveKit room metadata create failed',
            detail: 'Room service returned 500',
          },
          500,
          'Internal Server Error',
        ),
      ),
    );

    await expect(
      fetchLivekitToken('patient-123', 'https://openmrs.example/livekit/token', 'openmrs-voice-', {
        doctorLanguage: 'en',
        patientLanguage: 'en',
        agentVoiceLanguage: 'en',
      }),
    ).rejects.toThrow(
      'Token request failed: 500 Internal Server Error - livekit_metadata_error: LiveKit room metadata create failed: Room service returned 500',
    );
  });

  it('reports non-JSON token errors without leaking an HTML page', async () => {
    stubBrowserLocation('https://openmrs.example/spa/home');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<!doctype html><title>Bad Gateway</title>', {
          status: 502,
          statusText: 'Bad Gateway',
        }),
      ),
    );

    await expect(
      fetchLivekitToken('patient-123', 'https://openmrs.example/livekit/token', 'openmrs-voice-', {
        doctorLanguage: 'en',
        patientLanguage: 'en',
        agentVoiceLanguage: 'en',
      }),
    ).rejects.toThrow('Token request failed: 502 Bad Gateway - non-JSON response from token server');
  });

  it('includes JSON error details when saving an OpenMRS draft fails', async () => {
    stubBrowserLocation('https://openmrs.example/spa/home');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            code: 'openmrs_draft_config_missing',
            message: 'OPENMRS_ENCOUNTER_TYPE_UUID is required',
          },
          409,
          'Conflict',
        ),
      ),
    );

    await expect(
      saveOpenmrsDraft('https://openmrs.example/livekit/token', {
        patientUuid: 'patient-123',
        draft: {
          chiefComplaint: 'Cough',
          symptoms: ['cough'],
          medicationsMentioned: [],
          allergiesMentioned: [],
          assessmentNotes: 'Needs review.',
          patientInstructions: 'Return if worse.',
        },
      }),
    ).rejects.toThrow(
      'Draft save failed: 409 Conflict - openmrs_draft_config_missing: OPENMRS_ENCOUNTER_TYPE_UUID is required',
    );

    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe('include');
  });

  it('fetches OpenMRS draft write configuration from the helper gateway path', async () => {
    stubBrowserLocation('https://openmrs.example/spa/home');
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          status: 'validated',
          enabled: true,
          resources: {
            encounterType: { status: 'ok', uuid: 'encounter-type-uuid', display: 'Visit Note' },
          },
        },
        200,
        'OK',
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchOpenmrsDraftWriteConfig('/openmrs/livekit/token')).resolves.toMatchObject({
      status: 'validated',
      enabled: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://openmrs.example/openmrs/livekit/openmrs/draft/config',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });

  it('fetches sanitized OpenMRS draft audit events with a bounded limit', async () => {
    stubBrowserLocation('https://openmrs.example/spa/home');
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          status: 'ok',
          events: [
            {
              eventType: 'draft_write_rejected',
              openmrsWrite: 'visit_required',
              rawClinicalTextStored: false,
            },
          ],
        },
        200,
        'OK',
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchOpenmrsDraftAudit('/openmrs/livekit/token', 10)).resolves.toMatchObject({
      status: 'ok',
      events: [{ eventType: 'draft_write_rejected' }],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://openmrs.example/openmrs/livekit/openmrs/draft/audit?limit=10',
      expect.objectContaining({ method: 'GET', credentials: 'include' }),
    );
  });
});

function stubBrowserLocation(href: string) {
  const url = new URL(href);
  vi.stubGlobal('window', {
    location: {
      href: url.href,
      host: url.host,
      hostname: url.hostname,
      protocol: url.protocol,
    },
  });
}

function jsonResponse(payload: unknown, status: number, statusText: string): Response {
  return new Response(JSON.stringify(payload), {
    status,
    statusText,
    headers: { 'Content-Type': 'application/json' },
  });
}
