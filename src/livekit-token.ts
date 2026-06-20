export async function fetchLivekitToken(
  patientUuid: string,
  tokenEndpoint: string,
  roomPrefix: string,
): Promise<{ token: string; roomName: string }> {
  const roomName = buildRoomName(patientUuid, roomPrefix);
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patientUuid, roomName, roomPrefix }),
  });
  if (!res.ok) {
    throw new Error(`Token request failed: ${res.status}`);
  }
  return res.json();
}

export function buildRoomName(patientUuid: string, roomPrefix: string): string {
  const prefix = roomPrefix?.trim() || 'iot-device-';
  const safePatientUuid = patientUuid.replace(/[^a-zA-Z0-9_-]/g, '-');
  return `${prefix}${safePatientUuid}`;
}

export function resolveLivekitServerUrl(configuredUrl?: string): string {
  if (configuredUrl?.trim()) {
    return configuredUrl.trim();
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.hostname}:7880`;
}

export function resolveTokenEndpoint(configuredEndpoint?: string): string {
  if (configuredEndpoint?.trim()) {
    return configuredEndpoint.trim();
  }

  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
  return `${protocol}//${window.location.hostname}:7890/token`;
}
