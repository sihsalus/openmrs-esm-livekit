import { describe, expect, it } from 'vitest';
import { normalizeTokenServerHealth, serviceHealthToStatus } from './agent-health';

describe('agent health normalization', () => {
  it('maps helper service statuses into frontend status tags', () => {
    expect(serviceHealthToStatus('ok')).toBe('ok');
    expect(serviceHealthToStatus('configured')).toBe('ok');
    expect(serviceHealthToStatus('enforced')).toBe('ok');
    expect(serviceHealthToStatus('private_files')).toBe('ok');
    expect(serviceHealthToStatus('error')).toBe('error');
    expect(serviceHealthToStatus('unreachable')).toBe('error');
    expect(serviceHealthToStatus('not_configured')).toBe('pending');
    expect(serviceHealthToStatus('demo_mode')).toBe('pending');
    expect(serviceHealthToStatus('permissive_dev')).toBe('pending');
  });

  it('uses the canonical llm service when present', () => {
    expect(
      normalizeTokenServerHealth({
        services: {
          livekit: { status: 'ok' },
          tokenServer: { status: 'ok' },
          agent: { status: 'ok' },
          openmrs: { status: 'ok' },
          openmrsDraftWrite: { status: 'configured' },
          stt: { status: 'configured' },
          tts: { status: 'configured' },
          llm: { status: 'configured' },
          ollama: { status: 'error' },
          productionReadiness: { status: 'enforced' },
          cors: { status: 'configured' },
          localStorage: { status: 'private_files' },
        },
      }),
    ).toEqual({
      livekit: 'ok',
      tokenServer: 'ok',
      agent: 'ok',
      openmrs: 'ok',
      openmrsDraftWrite: 'ok',
      stt: 'ok',
      tts: 'ok',
      llm: 'ok',
      productionReadiness: 'ok',
      cors: 'ok',
      localStorage: 'ok',
    });
  });

  it('falls back to ollama or parser status for older helper health payloads', () => {
    expect(
      normalizeTokenServerHealth({
        services: {
          livekit: { status: 'ok' },
          tokenServer: { status: 'ok' },
          livekitAgent: { status: 'unreachable' },
          openmrs: { status: 'unreachable' },
          openmrsDraftWrite: { status: 'disabled' },
          stt: { status: 'not_configured' },
          tts: { status: 'configured' },
          ollama: { status: 'error' },
        },
      }),
    ).toMatchObject({
      agent: 'error',
      openmrs: 'error',
      openmrsDraftWrite: 'pending',
      stt: 'pending',
      tts: 'ok',
      llm: 'error',
    });

    expect(
      normalizeTokenServerHealth({
        services: {
          livekit: { status: 'ok' },
          tokenServer: { status: 'ok' },
          openmrs: { status: 'ok' },
          stt: { status: 'configured' },
          tts: { status: 'configured' },
          parser: { status: 'fallback' },
        },
      }),
    ).toMatchObject({ llm: 'pending' });
  });

  it('rejects malformed health payloads', () => {
    expect(normalizeTokenServerHealth(null)).toBeNull();
    expect(normalizeTokenServerHealth({})).toBeNull();
  });
});
