export type ServiceStatus = 'ok' | 'error' | 'pending' | 'checking';

export interface ServiceHealth {
  livekit: ServiceStatus;
  tokenServer: ServiceStatus;
  agent: ServiceStatus;
  openmrs: ServiceStatus;
  openmrsDraftWrite: ServiceStatus;
  stt: ServiceStatus;
  tts: ServiceStatus;
  llm: ServiceStatus;
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
  tts: 'pending',
  llm: 'pending',
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
    tts: 'checking',
    llm: 'checking',
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
  return {
    livekit: serviceHealthToStatus(serviceStatus(services.livekit)),
    tokenServer: serviceHealthToStatus(serviceStatus(services.tokenServer)),
    agent: serviceHealthToStatus(serviceStatus(services.agent) ?? serviceStatus(services.livekitAgent)),
    openmrs: serviceHealthToStatus(serviceStatus(services.openmrs)),
    openmrsDraftWrite: serviceHealthToStatus(serviceStatus(services.openmrsDraftWrite)),
    stt: serviceHealthToStatus(serviceStatus(services.stt)),
    tts: serviceHealthToStatus(serviceStatus(services.tts)),
    llm: serviceHealthToStatus(
      serviceStatus(services.llm) ?? serviceStatus(services.ollama) ?? serviceStatus(services.parser),
    ),
    productionReadiness: serviceHealthToStatus(serviceStatus(services.productionReadiness)),
    cors: serviceHealthToStatus(serviceStatus(services.cors)),
    localStorage: serviceHealthToStatus(serviceStatus(services.localStorage)),
  };
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

function serviceStatus(service: unknown): unknown {
  return isRecord(service) ? service.status : undefined;
}

function isRecord(payload: unknown): payload is Record<string, unknown> {
  return typeof payload === 'object' && payload !== null;
}
