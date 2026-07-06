import { describe, expect, it } from 'vitest';
import { formatEndpointForDisplay } from './livekit-config';

describe('formatEndpointForDisplay', () => {
  it('expands relative endpoints against the browser URL', () => {
    expect(
      formatEndpointForDisplay('/openmrs/livekit/token', 'https://example.org/openmrs/spa/patient/123'),
    ).toBe('https://example.org/openmrs/livekit/token');
  });

  it('keeps absolute endpoints unchanged', () => {
    expect(formatEndpointForDisplay('https://voice.example.org/openmrs/livekit/token')).toBe(
      'https://voice.example.org/openmrs/livekit/token',
    );
  });
});
