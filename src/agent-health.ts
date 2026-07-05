export type ServiceStatus = 'ok' | 'error' | 'pending' | 'checking';

export interface ServiceHealth {
  livekit: ServiceStatus;
  tokenServer: ServiceStatus;
  agent: ServiceStatus;
  openmrs: ServiceStatus;
  stt: ServiceStatus;
  tts: ServiceStatus;
  llm: ServiceStatus;
}

export const initialHealth: ServiceHealth = {
  livekit: 'pending',
  tokenServer: 'pending',
  agent: 'pending',
  openmrs: 'pending',
  stt: 'pending',
  tts: 'pending',
  llm: 'pending',
};

export function checkingHealth(): ServiceHealth {
  return {
    livekit: 'checking',
    tokenServer: 'checking',
    agent: 'checking',
    openmrs: 'checking',
    stt: 'checking',
    tts: 'checking',
    llm: 'checking',
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
    stt: serviceHealthToStatus(serviceStatus(services.stt)),
    tts: serviceHealthToStatus(serviceStatus(services.tts)),
    llm: serviceHealthToStatus(
      serviceStatus(services.llm) ?? serviceStatus(services.ollama) ?? serviceStatus(services.parser),
    ),
  };
}

export function serviceHealthToStatus(status: unknown): ServiceStatus {
  if (status === 'ok' || status === 'configured') {
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
