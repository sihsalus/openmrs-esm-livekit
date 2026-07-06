import type { Config } from '../config-schema';
import { resolveLivekitServerUrl, resolveTokenEndpoint } from './livekit-token';

export interface LivekitOperationalConfig {
  livekitServerUrl: string;
  tokenEndpoint: string;
  tokenEndpointDisplay: string;
  roomPrefix: string;
}

export function resolveLivekitOperationalConfig(
  config: Pick<Config, 'livekitServerUrl' | 'tokenEndpoint' | 'roomPrefix'>,
): LivekitOperationalConfig {
  const tokenEndpoint = resolveTokenEndpoint(config.tokenEndpoint);

  return {
    livekitServerUrl: resolveLivekitServerUrl(config.livekitServerUrl),
    tokenEndpoint,
    tokenEndpointDisplay: formatEndpointForDisplay(tokenEndpoint),
    roomPrefix: config.roomPrefix || 'openmrs-voice-',
  };
}

export function formatEndpointForDisplay(endpoint: string, baseUrl?: string): string {
  try {
    const resolvedBaseUrl =
      baseUrl ?? (typeof window !== 'undefined' ? window.location.href : 'http://localhost/');
    return new URL(endpoint, resolvedBaseUrl).toString();
  } catch {
    return endpoint;
  }
}
