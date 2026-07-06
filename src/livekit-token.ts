import type { ClinicalLanguageCode } from './clinical-language';

export interface LivekitRoomLanguageConfig {
  doctorLanguage: ClinicalLanguageCode;
  patientLanguage: ClinicalLanguageCode;
}

export async function fetchLivekitToken(
  patientUuid: string,
  tokenEndpoint: string,
  roomPrefix: string,
  languageConfig: LivekitRoomLanguageConfig,
): Promise<{ token: string; roomName: string }> {
  const roomName = buildRoomName(patientUuid, roomPrefix);
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ patientUuid, roomName, roomPrefix, ...languageConfig }),
  });
  if (!res.ok) {
    throw new Error(`Token request failed: ${res.status}`);
  }

  const payload = await res.json();
  if (!payload?.token || !payload?.roomName) {
    throw new Error('Token response did not include a token and room name');
  }

  return payload;
}

export interface OpenmrsDraftPayload {
  patientUuid: string;
  draft: {
    patientUuid?: string | null;
    chiefComplaint: string;
    symptoms: string[];
    medicationsMentioned: string[];
    allergiesMentioned: string[];
    assessmentNotes: string;
    patientInstructions: string;
    facts?: unknown[];
    reviewQueue?: unknown[];
    missingFields?: string[];
    clinicianReviewRequired?: boolean;
  };
  redactedTranscript?: string;
  structuredObsConcepts?: Record<string, string>;
  writeToOpenmrs?: boolean;
}

export interface OpenmrsDraftResult {
  status: 'saved' | 'queued' | 'error';
  draftId?: string;
  openmrsWrite?: string;
  encounterUuid?: string;
  message?: string;
}

export async function saveOpenmrsDraft(
  tokenEndpoint: string,
  payload: OpenmrsDraftPayload,
): Promise<OpenmrsDraftResult> {
  const res = await fetch(resolveTokenServerPath(tokenEndpoint, '/openmrs/draft'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(body?.error || body?.message || `Draft save failed: ${res.status}`);
  }

  return body;
}

export function buildRoomName(patientUuid: string, roomPrefix: string): string {
  const prefix = roomPrefix?.trim() || 'openmrs-voice-';
  const safePatientUuid = patientUuid.replace(/[^a-zA-Z0-9_-]/g, '-');
  return `${prefix}${safePatientUuid}`;
}

export function resolveLivekitServerUrl(configuredUrl?: string): string {
  if (configuredUrl?.trim()) {
    return requireSecureBrowserTransport(configuredUrl.trim(), 'LiveKit server URL', ['wss:'], ['ws:']);
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.hostname}:7880`;
}

export function resolveTokenEndpoint(configuredEndpoint?: string): string {
  if (configuredEndpoint?.trim()) {
    return requireSecureBrowserTransport(configuredEndpoint.trim(), 'Token endpoint', ['https:'], ['http:']);
  }

  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
  return `${protocol}//${window.location.hostname}:7890/token`;
}

export function resolveTokenServerPath(tokenEndpoint: string, path: string): string {
  const endpoint = new URL(tokenEndpoint, window.location.href);
  const nextPath = endpoint.pathname.replace(/\/token\/?$/, path);
  endpoint.pathname = nextPath === endpoint.pathname ? path : nextPath;
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint.toString();
}

function requireSecureBrowserTransport(
  endpoint: string,
  label: string,
  secureProtocols: string[],
  localCleartextProtocols: string[],
): string {
  if (window.location.protocol !== 'https:') {
    return endpoint;
  }

  const url = new URL(endpoint, window.location.href);
  const isSecure = secureProtocols.includes(url.protocol);
  const isLocalCleartext = localCleartextProtocols.includes(url.protocol) && isLocalHostname(url.hostname);

  if (!isSecure && !isLocalCleartext) {
    const expectedProtocols = secureProtocols.map((protocol) => `${protocol}//`).join(' or ');
    throw new Error(`${label} must use ${expectedProtocols} when OpenMRS is served over HTTPS`);
  }

  return endpoint;
}

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.localhost')
  );
}
