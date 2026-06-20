export async function fetchLivekitToken(
  patientUuid: string,
  tokenEndpoint: string,
): Promise<{ token: string; roomName: string }> {
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patientUuid }),
  });
  if (!res.ok) {
    throw new Error(`Token request failed: ${res.status}`);
  }
  return res.json();
}
