import { describe, expect, it } from 'vitest';
import { shouldAttemptInitialMicrophoneEnable } from './microphone-control';

describe('microphone control', () => {
  it('auto-enables the microphone once after the room connects', () => {
    expect(
      shouldAttemptInitialMicrophoneEnable({
        connected: true,
        hasLocalParticipant: true,
        muted: true,
        attempted: false,
      }),
    ).toBe(true);
  });

  it('does not auto-enable again after the clinician manually mutes', () => {
    expect(
      shouldAttemptInitialMicrophoneEnable({
        connected: true,
        hasLocalParticipant: true,
        muted: true,
        attempted: true,
      }),
    ).toBe(false);
  });

  it('waits for an active connection and local participant', () => {
    expect(
      shouldAttemptInitialMicrophoneEnable({
        connected: false,
        hasLocalParticipant: true,
        muted: true,
        attempted: false,
      }),
    ).toBe(false);
    expect(
      shouldAttemptInitialMicrophoneEnable({
        connected: true,
        hasLocalParticipant: false,
        muted: true,
        attempted: false,
      }),
    ).toBe(false);
  });
});
