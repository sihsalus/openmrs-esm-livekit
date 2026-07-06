export type MicrophoneTranslate = (key: string, fallback: string) => string;

type BrowserMicrophoneNavigator = {
  mediaDevices?: {
    getUserMedia?: unknown;
  };
};

const rawMissingMicrophoneApiPattern = /navigator\.mediaDevices|mediaDevices\.getUserMedia|getUserMedia/i;

const currentNavigator = (): BrowserMicrophoneNavigator | undefined => {
  return typeof navigator === 'undefined' ? undefined : navigator;
};

export const isBrowserMicrophoneAvailable = (
  navigatorLike: BrowserMicrophoneNavigator | undefined = currentNavigator(),
) => {
  return typeof navigatorLike?.mediaDevices?.getUserMedia === 'function';
};

export const microphoneUnavailableMessage = (t: MicrophoneTranslate) =>
  t(
    'microphoneUnavailable',
    'Microphone capture is unavailable in this browser context. Open the demo over HTTPS or localhost to enable clinical audio.',
  );

export const microphoneErrorMessage = (
  error: unknown,
  t: MicrophoneTranslate,
  navigatorLike: BrowserMicrophoneNavigator | undefined = currentNavigator(),
) => {
  if (!isBrowserMicrophoneAvailable(navigatorLike)) {
    return microphoneUnavailableMessage(t);
  }

  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (rawMissingMicrophoneApiPattern.test(message)) {
    return microphoneUnavailableMessage(t);
  }

  return message || t('microphoneAccessFailed', 'Microphone access failed');
};
