import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveLivekitServerUrl, resolveTokenEndpoint, resolveTokenServerPath } from './livekit-token';

describe('LiveKit token endpoint transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('derives secure transport URLs when OpenMRS is served over HTTPS', () => {
    stubBrowserLocation('https://openmrs.example/spa/home');

    expect(resolveLivekitServerUrl()).toBe('wss://openmrs.example:7880');
    expect(resolveTokenEndpoint()).toBe('https://openmrs.example:7890/token');
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
  });
});

function stubBrowserLocation(href: string) {
  const url = new URL(href);
  vi.stubGlobal('window', {
    location: {
      href: url.href,
      hostname: url.hostname,
      protocol: url.protocol,
    },
  });
}
