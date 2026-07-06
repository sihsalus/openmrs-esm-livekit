import { describe, expect, it } from 'vitest';
import {
  isBrowserMicrophoneAvailable,
  microphoneErrorMessage,
  microphoneUnavailableMessage,
} from './microphone-availability';

const t = (_key: string, fallback: string) => fallback;

describe('microphone availability', () => {
  it('detects when the browser context does not expose getUserMedia', () => {
    expect(isBrowserMicrophoneAvailable(undefined)).toBe(false);
    expect(isBrowserMicrophoneAvailable({})).toBe(false);
    expect(isBrowserMicrophoneAvailable({ mediaDevices: {} })).toBe(false);
  });

  it('detects when getUserMedia is available', () => {
    expect(
      isBrowserMicrophoneAvailable({
        mediaDevices: {
          getUserMedia: () => Promise.resolve({}),
        },
      }),
    ).toBe(true);
  });

  it('maps Safari and insecure-context getUserMedia errors to a clinician-readable message', () => {
    const message = microphoneErrorMessage(
      new Error("undefined is not an object (evaluating 'navigator.mediaDevices.getUserMedia')"),
      t,
      {},
    );

    expect(message).toBe(microphoneUnavailableMessage(t));
    expect(message).not.toContain('undefined is not an object');
  });

  it('preserves permission-denied errors when the microphone API exists', () => {
    expect(
      microphoneErrorMessage(new Error('Permission denied by user'), t, {
        mediaDevices: { getUserMedia: () => Promise.resolve({}) },
      }),
    ).toBe('Permission denied by user');
  });
});
