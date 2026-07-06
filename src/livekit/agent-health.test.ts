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
          tokenServerAuth: { status: 'enforced' },
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
      sttSource: 'helper',
      tts: 'ok',
      ttsSource: 'helper',
      llm: 'ok',
      llmSource: 'helper',
      tokenServerAuth: 'ok',
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
          tokenServerAuth: { status: 'disabled' },
        },
      }),
    ).toMatchObject({
      agent: 'error',
      openmrs: 'error',
      openmrsDraftWrite: 'pending',
      stt: 'pending',
      sttSource: 'helper',
      tts: 'ok',
      ttsSource: 'helper',
      llm: 'error',
      llmSource: 'helper',
      tokenServerAuth: 'pending',
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

  it('uses LiveKit agent capabilities before helper endpoint status', () => {
    expect(
      normalizeTokenServerHealth({
        services: {
          livekit: { status: 'ok' },
          tokenServer: { status: 'ok' },
          agent: { status: 'ok' },
          openmrs: { status: 'ok' },
          openmrsDraftWrite: { status: 'disabled' },
          stt: { status: 'not_configured', scope: 'helper_endpoint' },
          tts: { status: 'not_configured', scope: 'helper_endpoint' },
          ollama: { status: 'ok' },
          agentCapabilities: {
            status: 'configured',
            source: 'livekit-agent',
            stt: { status: 'configured', provider: 'whisper', scope: 'livekit_agent' },
            tts: { status: 'configured', provider: 'piper', scope: 'livekit_agent' },
            llm: { status: 'configured', provider: 'ollama', scope: 'livekit_agent' },
          },
          tokenServerAuth: { status: 'enforced' },
          productionReadiness: { status: 'demo_mode' },
          cors: { status: 'configured' },
          localStorage: { status: 'private_files' },
        },
      }),
    ).toMatchObject({
      stt: 'ok',
      sttSource: 'agent',
      tts: 'ok',
      ttsSource: 'agent',
      llm: 'ok',
      llmSource: 'agent',
    });
  });

  it('rejects malformed health payloads', () => {
    expect(normalizeTokenServerHealth(null)).toBeNull();
    expect(normalizeTokenServerHealth({})).toBeNull();
  });
});
