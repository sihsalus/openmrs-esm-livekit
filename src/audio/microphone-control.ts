interface InitialMicrophoneEnableState {
  connected: boolean;
  hasLocalParticipant: boolean;
  muted: boolean;
  attempted: boolean;
}

export function shouldAttemptInitialMicrophoneEnable({
  connected,
  hasLocalParticipant,
  muted,
  attempted,
}: InitialMicrophoneEnableState): boolean {
  return connected && hasLocalParticipant && muted && !attempted;
}
