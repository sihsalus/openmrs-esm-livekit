import { resolveTokenServerPath } from './livekit-token';

export type ServiceStatus = 'ok' | 'error' | 'pending' | 'checking';
export type CapabilitySource = 'agent' | 'helper' | 'unknown';

export interface ServiceHealth {
  livekit: ServiceStatus;
  tokenServer: ServiceStatus;
  agent: ServiceStatus;
  openmrs: ServiceStatus;
  openmrsDraftWrite: ServiceStatus;
  stt: ServiceStatus;
  sttSource: CapabilitySource;
  tts: ServiceStatus;
  ttsSource: CapabilitySource;
  llm: ServiceStatus;
  llmSource: CapabilitySource;
  tokenServerAuth: ServiceStatus;
  productionReadiness: ServiceStatus;
  cors: ServiceStatus;
  localStorage: ServiceStatus;
}

export const initialHealth: ServiceHealth = {
  livekit: 'pending',
  tokenServer: 'pending',
  agent: 'pending',
  openmrs: 'pending',
  openmrsDraftWrite: 'pending',
  stt: 'pending',
  sttSource: 'unknown',
  tts: 'pending',
  ttsSource: 'unknown',
  llm: 'pending',
  llmSource: 'unknown',
  tokenServerAuth: 'pending',
  productionReadiness: 'pending',
  cors: 'pending',
  localStorage: 'pending',
};

export function checkingHealth(): ServiceHealth {
  return {
    livekit: 'checking',
    tokenServer: 'checking',
    agent: 'checking',
    openmrs: 'checking',
    openmrsDraftWrite: 'checking',
    stt: 'checking',
    sttSource: 'unknown',
    tts: 'checking',
    ttsSource: 'unknown',
    llm: 'checking',
    llmSource: 'unknown',
    tokenServerAuth: 'checking',
    productionReadiness: 'checking',
    cors: 'checking',
    localStorage: 'checking',
  };
}

export function normalizeTokenServerHealth(payload: unknown): ServiceHealth | null {
  if (!isRecord(payload) || !isRecord(payload.services)) {
    return null;
  }

  const services = payload.services;
  const agentCapabilities = isRecord(services.agentCapabilities) ? services.agentCapabilities : {};
  const agentSttStatus = serviceStatus(agentCapabilities.stt);
  const helperSttStatus = serviceStatus(services.stt);
  const agentTtsStatus = serviceStatus(agentCapabilities.tts);
  const helperTtsStatus = serviceStatus(services.tts);
  const agentLlmStatus = serviceStatus(agentCapabilities.llm);
  const helperLlmStatus =
    serviceStatus(services.llm) ?? serviceStatus(services.ollama) ?? serviceStatus(services.parser);

  return {
    livekit: serviceHealthToStatus(serviceStatus(services.livekit)),
    tokenServer: serviceHealthToStatus(serviceStatus(services.tokenServer)),
    agent: serviceHealthToStatus(serviceStatus(services.agent) ?? serviceStatus(services.livekitAgent)),
    openmrs: serviceHealthToStatus(serviceStatus(services.openmrs)),
    openmrsDraftWrite: serviceHealthToStatus(serviceStatus(services.openmrsDraftWrite)),
    stt: serviceHealthToStatus(agentSttStatus ?? helperSttStatus),
    sttSource: capabilitySource(agentSttStatus, helperSttStatus),
    tts: serviceHealthToStatus(agentTtsStatus ?? helperTtsStatus),
    ttsSource: capabilitySource(agentTtsStatus, helperTtsStatus),
    llm: serviceHealthToStatus(agentLlmStatus ?? helperLlmStatus),
    llmSource: capabilitySource(agentLlmStatus, helperLlmStatus),
    tokenServerAuth: serviceHealthToStatus(serviceStatus(services.tokenServerAuth)),
    productionReadiness: serviceHealthToStatus(serviceStatus(services.productionReadiness)),
    cors: serviceHealthToStatus(serviceStatus(services.cors)),
    localStorage: serviceHealthToStatus(serviceStatus(services.localStorage)),
  };
}

export async function fetchServiceHealth(livekitUrl: string, tokenEndpoint: string): Promise<ServiceHealth> {
  try {
    const res = await fetch(resolveTokenServerPath(tokenEndpoint, '/health'), {
      method: 'GET',
      credentials: 'include',
      signal: AbortSignal.timeout(5000),
    });
    const payload = await res.json().catch(() => null);
    const health = normalizeTokenServerHealth(payload);
    if (!res.ok || !health) {
      throw new Error('Token server health response was not available');
    }

    return health;
  } catch {
    let fallbackHealth: ServiceHealth = {
      ...initialHealth,
      tokenServer: 'error',
      livekit: 'checking',
      openmrs: 'checking',
    };
    const httpLivekit = livekitUrl.replace(/^ws/, 'http');
    const checks: Array<{ key: 'livekit' | 'openmrs'; url: string }> = [
      { key: 'livekit', url: httpLivekit },
      { key: 'openmrs', url: '/openmrs/ws/fhir2/R4/metadata' },
    ];

    await Promise.all(
      checks.map(async ({ key, url }) => {
        try {
          const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(5000) });
          fallbackHealth = { ...fallbackHealth, [key]: res.ok ? 'ok' : 'error' };
        } catch {
          fallbackHealth = { ...fallbackHealth, [key]: 'error' };
        }
      }),
    );

    return fallbackHealth;
  }
}

export function serviceHealthToStatus(status: unknown): ServiceStatus {
  if (status === 'ok' || status === 'configured' || status === 'enforced' || status === 'private_files') {
    return 'ok';
  }
  if (status === 'unreachable' || status === 'error') {
    return 'error';
  }
  return 'pending';
}

function capabilitySource(agentStatus: unknown, helperStatus: unknown): CapabilitySource {
  if (agentStatus) {
    return 'agent';
  }
  if (helperStatus) {
    return 'helper';
  }
  return 'unknown';
}

function serviceStatus(service: unknown): unknown {
  return isRecord(service) ? service.status : undefined;
}

function isRecord(payload: unknown): payload is Record<string, unknown> {
  return typeof payload === 'object' && payload !== null;
}
