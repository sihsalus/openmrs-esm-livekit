import React, { useCallback, useEffect, useState } from 'react';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useConnectionState,
  useLocalParticipant,
  useTracks,
} from '@livekit/components-react';
import { ConnectionState, Track } from 'livekit-client';
import { Button, InlineLoading, Tag, Tile } from '@carbon/react';
import { Microphone, MicrophoneOff, StopFilled } from '@carbon/react/icons';
import { useConfig, usePatient } from '@openmrs/esm-framework';
import { useTranslation } from 'react-i18next';
import { fetchLivekitToken } from './livekit-token';
import type { Config } from './config-schema';
import styles from './voice-panel.scss';

interface VoicePanelProps {
  onClose?: () => void;
}

const VoicePanel: React.FC<VoicePanelProps> = ({ onClose }) => {
  const { t } = useTranslation();
  const config = useConfig<Config>();
  const { patient, isLoading: patientLoading } = usePatient();
  const [token, setToken] = useState<string | null>(null);
  const [roomName, setRoomName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const connect = useCallback(async () => {
    if (!patient?.id) return;
    setConnecting(true);
    setError(null);
    try {
      const result = await fetchLivekitToken(patient.id, config.tokenEndpoint);
      setToken(result.token);
      setRoomName(result.roomName);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect');
    } finally {
      setConnecting(false);
    }
  }, [patient?.id, config.tokenEndpoint]);

  const disconnect = useCallback(() => {
    setToken(null);
    setRoomName('');
    onClose?.();
  }, [onClose]);

  if (patientLoading) {
    return (
      <Tile className={styles.panel}>
        <InlineLoading description={t('loadingPatient', 'Loading patient...')} />
      </Tile>
    );
  }

  if (!token) {
    return (
      <Tile className={styles.panel}>
        <h4 className={styles.title}>{t('voiceConsultation', 'Voice consultation')}</h4>
        <p className={styles.patientName}>{patient?.name?.[0]?.text ?? ''}</p>
        {error && <p className={styles.error}>{error}</p>}
        <Button
          kind="primary"
          renderIcon={Microphone}
          onClick={connect}
          disabled={connecting}
        >
          {connecting
            ? t('connecting', 'Connecting...')
            : t('startConsultation', 'Start consultation')}
        </Button>
      </Tile>
    );
  }

  return (
    <LiveKitRoom
      serverUrl={config.livekitServerUrl}
      token={token}
      connect={true}
      audio={true}
      video={false}
      onDisconnected={disconnect}
      className={styles.panel}
    >
      <RoomAudioRenderer />
      <ActiveSession
        patientName={patient?.name?.[0]?.text ?? ''}
        roomName={roomName}
        onEnd={disconnect}
      />
    </LiveKitRoom>
  );
};

interface ActiveSessionProps {
  patientName: string;
  roomName: string;
  onEnd: () => void;
}

const ActiveSession: React.FC<ActiveSessionProps> = ({ patientName, roomName, onEnd }) => {
  const { t } = useTranslation();
  const connectionState = useConnectionState();
  const { localParticipant } = useLocalParticipant();
  const [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const toggleMute = useCallback(async () => {
    if (localParticipant) {
      await localParticipant.setMicrophoneEnabled(muted);
      setMuted(!muted);
    }
  }, [localParticipant, muted]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const stateLabel =
    connectionState === ConnectionState.Connected
      ? t('recording', 'Recording')
      : connectionState === ConnectionState.Connecting
        ? t('connecting', 'Connecting...')
        : t('disconnected', 'Disconnected');

  const stateKind = connectionState === ConnectionState.Connected ? 'green' : 'gray';

  return (
    <div className={styles.session}>
      <div className={styles.header}>
        <h4 className={styles.title}>{patientName}</h4>
        <Tag type={stateKind} size="sm">
          {stateLabel}
        </Tag>
      </div>

      <div className={styles.timer}>{formatTime(elapsed)}</div>

      <div className={styles.controls}>
        <Button
          kind="ghost"
          size="lg"
          hasIconOnly
          renderIcon={muted ? MicrophoneOff : Microphone}
          iconDescription={muted ? t('unmute', 'Unmute') : t('mute', 'Mute')}
          onClick={toggleMute}
        />
        <Button
          kind="danger"
          size="lg"
          hasIconOnly
          renderIcon={StopFilled}
          iconDescription={t('endConsultation', 'End consultation')}
          onClick={onEnd}
        />
      </div>
    </div>
  );
};

export default VoicePanel;
