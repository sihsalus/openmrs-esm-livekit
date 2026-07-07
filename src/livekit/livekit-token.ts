import type { ClinicalLanguageCode } from '../clinical/clinical-language';

export interface LivekitRoomLanguageConfig {
  doctorLanguage: ClinicalLanguageCode;
  patientLanguage: ClinicalLanguageCode;
  agentVoiceLanguage: ClinicalLanguageCode;
}

export interface LivekitRoomContext {
  visitUuid?: string;
}

type JsonRecord = Record<string, unknown>;

export async function fetchLivekitToken(
  patientUuid: string,
  tokenEndpoint: string,
  roomPrefix: string,
  languageConfig: LivekitRoomLanguageConfig,
  roomContext: LivekitRoomContext = {},
): Promise<{ token: string; roomName: string }> {
  const roomName = buildRoomName(patientUuid, roomPrefix);
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      patientUuid,
      roomName,
      roomPrefix,
      ...(roomContext.visitUuid ? { visitUuid: roomContext.visitUuid } : {}),
      ...languageConfig,
      captureRole: 'doctor',
      defaultHumanRole: 'doctor',
      speakerAttributionMode: 'source-role',
    }),
  });
  if (!res.ok) {
    throw new Error(await buildResponseErrorMessage(res, 'Token request failed'));
  }

  const payload = await readJsonResponse<{ token?: string; roomName?: string }>(
    res,
    'Token response was not valid JSON',
  );
  if (!payload?.token || !payload?.roomName) {
    throw new Error('Token response did not include a token and room name');
  }

  return {
    token: payload.token,
    roomName: payload.roomName,
  };
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
  visitUuid?: string;
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

export interface OpenmrsDraftConfigResource {
  uuid?: string | null;
  display?: string | null;
  name?: string | null;
  status?: string;
  datatype?: string | null;
  conceptClass?: string | null;
  retired?: boolean | null;
  httpStatus?: number | null;
  validationErrors?: string[];
}

export interface OpenmrsDraftWriteConfig {
  status: 'validated' | 'invalid' | 'not_configured' | 'auth_required' | 'disabled' | 'error';
  enabled: boolean;
  restBase?: string;
  authSource?: string;
  requiredConfiguration?: string[];
  requiredRequestContext?: string[];
  values?: Record<string, string | null>;
  resources?: {
    encounterType?: OpenmrsDraftConfigResource;
    location?: OpenmrsDraftConfigResource;
    draftObsConcept?: OpenmrsDraftConfigResource;
  };
  validationErrors?: string[];
  rawClinicalTextStored?: boolean;
  message?: string;
}

export interface OpenmrsDraftAuditEvent {
  id?: string;
  createdAt?: number;
  eventType?: string;
  draftId?: string;
  patientHash?: string | null;
  writeRequested?: boolean;
  writeEnabled?: boolean;
  openmrsWrite?: string;
  encounterUuid?: string | null;
  authSource?: string;
  message?: string;
  rawClinicalTextStored?: boolean;
}

export interface OpenmrsDraftAuditResponse {
  status: 'ok' | 'error';
  limit?: number;
  events: OpenmrsDraftAuditEvent[];
  rawClinicalTextStored?: boolean;
  message?: string;
}

export function buildQueuedOpenmrsDraftPayload(
  payload: Omit<OpenmrsDraftPayload, 'writeToOpenmrs'>,
): OpenmrsDraftPayload {
  return {
    ...payload,
    writeToOpenmrs: false,
  };
}

export function buildOpenmrsDraftWritePayload(
  payload: Omit<OpenmrsDraftPayload, 'writeToOpenmrs'>,
): OpenmrsDraftPayload {
  return {
    ...payload,
    writeToOpenmrs: true,
  };
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

  if (!res.ok) {
    throw new Error(await buildResponseErrorMessage(res, 'Draft save failed'));
  }

  return readJsonResponse<OpenmrsDraftResult>(res, 'Draft save response was not valid JSON');
}

export async function fetchOpenmrsDraftWriteConfig(tokenEndpoint: string): Promise<OpenmrsDraftWriteConfig> {
  const res = await fetch(resolveTokenServerPath(tokenEndpoint, '/openmrs/draft/config'), {
    method: 'GET',
    credentials: 'include',
  });

  if (!res.ok) {
    throw new Error(await buildResponseErrorMessage(res, 'Draft write config request failed'));
  }

  return readJsonResponse<OpenmrsDraftWriteConfig>(res, 'Draft write config response was not valid JSON');
}

export async function fetchOpenmrsDraftAudit(
  tokenEndpoint: string,
  limit = 20,
): Promise<OpenmrsDraftAuditResponse> {
  const url = new URL(resolveTokenServerPath(tokenEndpoint, '/openmrs/draft/audit'));
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
  });

  if (!res.ok) {
    throw new Error(await buildResponseErrorMessage(res, 'Draft audit request failed'));
  }

  return readJsonResponse<OpenmrsDraftAuditResponse>(res, 'Draft audit response was not valid JSON');
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
  return `${protocol}//${window.location.host}/livekit-sfu`;
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

async function readJsonResponse<T = JsonRecord>(res: Response, fallbackMessage: string): Promise<T> {
  try {
    const payload = await res.json();
    return (isRecord(payload) ? payload : {}) as T;
  } catch {
    throw new Error(fallbackMessage);
  }
}

async function buildResponseErrorMessage(res: Response, fallbackLabel: string): Promise<string> {
  const responseDetail = await readResponseDetail(res);
  const statusText = [res.status, res.statusText].filter(Boolean).join(' ');
  const prefix = statusText ? `${fallbackLabel}: ${statusText}` : fallbackLabel;
  return responseDetail ? `${prefix} - ${responseDetail}` : prefix;
}

async function readResponseDetail(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  const trimmed = text.trim();
  if (!trimmed) {
    return '';
  }

  const parsed = parseJsonObject(trimmed);
  if (parsed) {
    return compactMessage(
      [
        stringField(parsed, 'code'),
        stringField(parsed, 'error'),
        stringField(parsed, 'message'),
        stringField(parsed, 'detail'),
      ]
        .filter(Boolean)
        .join(': '),
    );
  }

  if (trimmed.startsWith('<')) {
    return 'non-JSON response from token server';
  }

  return compactMessage(trimmed);
}

function parseJsonObject(value: string): JsonRecord | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function stringField(payload: JsonRecord, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value.trim() : '';
}

function compactMessage(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
