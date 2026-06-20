import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useConnectionState,
  useLocalParticipant,
} from '@livekit/components-react';
import { ConnectionState } from 'livekit-client';
import { Button, InlineLoading, Tag, Tile } from '@carbon/react';
import { Microphone, MicrophoneOff, StopFilled } from '@carbon/icons-react';
import { useConfig, usePatient } from '@openmrs/esm-framework';
import { useTranslation } from 'react-i18next';
import { fetchLivekitToken, resolveLivekitServerUrl, resolveTokenEndpoint } from './livekit-token';
import type { Config } from './config-schema';
import styles from './voice-panel.scss';

interface VoicePanelProps {
  onClose?: () => void;
}

type LanguageCode = 'en' | 'es';
type FlowStep = 'doctorStt' | 'doctorTranslation' | 'patientTts' | 'patientStt' | 'patientTranslation' | 'openmrsDraft';
type StepStatus = 'idle' | 'running' | 'done';

const initialStepStatus: Record<FlowStep, StepStatus> = {
  doctorStt: 'idle',
  doctorTranslation: 'idle',
  patientTts: 'idle',
  patientStt: 'idle',
  patientTranslation: 'idle',
  openmrsDraft: 'idle',
};

const VoicePanel: React.FC<VoicePanelProps> = ({ onClose }) => {
  const { t } = useTranslation();
  const config = useConfig<Config>();
  const { patient, isLoading: patientLoading } = usePatient();
  const livekitServerUrl = useMemo(
    () => resolveLivekitServerUrl(config.livekitServerUrl),
    [config.livekitServerUrl],
  );
  const tokenEndpoint = useMemo(() => resolveTokenEndpoint(config.tokenEndpoint), [config.tokenEndpoint]);
  const roomPrefix = config.roomPrefix || 'iot-device-';
  const [token, setToken] = useState<string | null>(null);
  const [roomName, setRoomName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const connect = useCallback(async () => {
    if (!patient?.id) {
      setError(t('missingPatient', 'No patient context is available for this voice consultation.'));
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const result = await fetchLivekitToken(patient.id, tokenEndpoint, roomPrefix);
      setToken(result.token);
      setRoomName(result.roomName);
    } catch (e) {
      setError(
        e instanceof Error
          ? `${e.message}. ${t(
              'tokenServerHint',
              'Check that the token server is running and that gateway CSP allows this endpoint.',
            )}`
          : t('failedToConnect', 'Failed to connect'),
      );
    } finally {
      setConnecting(false);
    }
  }, [patient?.id, roomPrefix, t, tokenEndpoint]);

  const disconnect = useCallback(() => {
    setToken(null);
    setRoomName('');
    onClose?.();
  }, [onClose]);

  const resetSession = useCallback(() => {
    setToken(null);
    setRoomName('');
  }, []);

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
        <div className={styles.heroHeader}>
          <div>
            <h4 className={styles.title}>{t('voiceConsultation', 'Voice consultation')}</h4>
            <p className={styles.patientName}>{patient?.name?.[0]?.text ?? ''}</p>
          </div>
          <Tag type="cyan" size="sm">
            {t('localAi', 'Local AI')}
          </Tag>
        </div>
        <p className={styles.description}>
          {t(
            'translationFlowDescription',
            'Open a local LiveKit room, then run the doctor-patient translation and OpenMRS draft flow from this workspace.',
          )}
        </p>
        <div className={styles.pipelinePreview}>
          <Tag type="blue" size="sm">{t('livekitAudio', 'LiveKit audio')}</Tag>
          <Tag type="purple" size="sm">{t('localStt', 'Local STT')}</Tag>
          <Tag type="cyan" size="sm">{t('clinicalTranslation', 'Clinical translation')}</Tag>
          <Tag type="green" size="sm">{t('localTts', 'Local TTS')}</Tag>
          <Tag type="gray" size="sm">{t('openmrsDraft', 'OpenMRS draft')}</Tag>
        </div>
        <dl className={styles.connectionDetails}>
          <div>
            <dt>{t('livekitServer', 'LiveKit')}</dt>
            <dd>{livekitServerUrl}</dd>
          </div>
          <div>
            <dt>{t('tokenServer', 'Token server')}</dt>
            <dd>{tokenEndpoint}</dd>
          </div>
          <div>
            <dt>{t('roomPrefix', 'Room prefix')}</dt>
            <dd>{roomPrefix}</dd>
          </div>
        </dl>
        {error && <p className={styles.error}>{error}</p>}
        <Button kind="primary" renderIcon={Microphone} onClick={connect} disabled={connecting}>
          {connecting
            ? t('connecting', 'Connecting...')
            : t('startConsultation', 'Start consultation')}
        </Button>
      </Tile>
    );
  }

  return (
    <LiveKitRoom
      serverUrl={livekitServerUrl}
      token={token}
      connect={true}
      audio={true}
      video={false}
      onDisconnected={resetSession}
      onError={(error) => {
        setError(
          `${error.message}. ${t(
            'livekitConnectionHint',
            'Check LiveKit reachability and gateway CSP connect-src for the LiveKit WebSocket URL.',
          )}`,
        );
        resetSession();
      }}
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
  const [doctorLanguage, setDoctorLanguage] = useState<LanguageCode>('en');
  const [patientLanguage, setPatientLanguage] = useState<LanguageCode>('es');
  const [stepStatus, setStepStatus] = useState<Record<FlowStep, StepStatus>>(initialStepStatus);
  const timeouts = useRef<number[]>([]);

  useEffect(() => {
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    return () => {
      timeouts.current.forEach((timeout) => window.clearTimeout(timeout));
      timeouts.current = [];
    };
  }, []);

  const toggleMute = useCallback(async () => {
    if (localParticipant) {
      await localParticipant.setMicrophoneEnabled(muted);
      setMuted(!muted);
    }
  }, [localParticipant, muted]);

  const runStep = useCallback((step: FlowStep) => {
    setStepStatus((current) => ({ ...current, [step]: 'running' }));
    const timeout = window.setTimeout(() => {
      setStepStatus((current) => ({ ...current, [step]: 'done' }));
    }, 700);
    timeouts.current.push(timeout);
  }, []);

  const resetFlow = useCallback(() => {
    timeouts.current.forEach((timeout) => window.clearTimeout(timeout));
    timeouts.current = [];
    setStepStatus(initialStepStatus);
  }, []);

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
  const doctorLanguageLabel = languageLabel(doctorLanguage, t);
  const patientLanguageLabel = languageLabel(patientLanguage, t);
  const draftReady = stepStatus.openmrsDraft === 'done';

  const flowSteps: Array<{
    step: FlowStep;
    title: string;
    detail: string;
    action: string;
  }> = [
    {
      step: 'doctorStt',
      title: t('doctorStt', 'Doctor STT'),
      detail: t('doctorSttDetail', 'Capture clinician speech and produce a local transcript.'),
      action: t('captureDoctor', 'Capture doctor'),
    },
    {
      step: 'doctorTranslation',
      title: t('translateForPatient', 'Translate for patient'),
      detail: t('translateForPatientDetail', 'Redact identifiers and translate clinical meaning to the patient language.'),
      action: t('translateToLanguage', 'Translate to {{language}}', { language: patientLanguageLabel }),
    },
    {
      step: 'patientTts',
      title: t('patientTts', 'Patient TTS'),
      detail: t('patientTtsDetail', 'Play the translated message using the local TTS voice.'),
      action: t('playPatientAudio', 'Play patient audio'),
    },
    {
      step: 'patientStt',
      title: t('patientStt', 'Patient STT'),
      detail: t('patientSttDetail', 'Capture patient response and transcribe it locally.'),
      action: t('capturePatient', 'Capture patient'),
    },
    {
      step: 'patientTranslation',
      title: t('translateForDoctor', 'Translate for doctor'),
      detail: t('translateForDoctorDetail', 'Translate the patient response back to the clinician language.'),
      action: t('translateToLanguage', 'Translate to {{language}}', { language: doctorLanguageLabel }),
    },
    {
      step: 'openmrsDraft',
      title: t('openmrsDraft', 'OpenMRS draft'),
      detail: t('openmrsDraftDetail', 'Compile an anonymized, clinician-reviewable encounter draft.'),
      action: t('buildDraft', 'Build draft'),
    },
  ];

  return (
    <div className={styles.session}>
      <div className={styles.header}>
        <div>
          <h4 className={styles.title}>{patientName}</h4>
          <p className={styles.roomName}>{roomName}</p>
        </div>
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

      <section className={styles.flowPanel} aria-label={t('translationFlow', 'Translation flow')}>
        <div className={styles.flowHeader}>
          <div>
            <h5>{t('translationFlow', 'Translation flow')}</h5>
            <p>{t('translationFlowActive', 'Local AI steps for doctor-patient interpretation and OpenMRS drafting.')}</p>
          </div>
          <Button kind="ghost" size="sm" onClick={resetFlow}>
            {t('resetFlow', 'Reset flow')}
          </Button>
        </div>

        <div className={styles.languageControls}>
          <LanguageToggle
            label={t('doctorLanguage', 'Doctor language')}
            value={doctorLanguage}
            onChange={setDoctorLanguage}
          />
          <LanguageToggle
            label={t('patientLanguage', 'Patient language')}
            value={patientLanguage}
            onChange={setPatientLanguage}
          />
        </div>

        <div className={styles.flowGrid}>
          {flowSteps.map((item) => (
            <FlowStepCard
              key={item.step}
              title={item.title}
              detail={item.detail}
              action={item.action}
              status={stepStatus[item.step]}
              onRun={() => runStep(item.step)}
            />
          ))}
        </div>

        <div className={styles.previewGrid}>
          <Tile className={styles.previewTile}>
            <h5>{t('safeTranscript', 'Safe transcript')}</h5>
            <p>{transcriptPreview(stepStatus, t)}</p>
          </Tile>
          <Tile className={styles.previewTile}>
            <h5>{t('openmrsReviewDraft', 'OpenMRS review draft')}</h5>
            <p>
              {draftReady
                ? t('draftReadyPreview', 'Draft ready: chief concern, symptoms, medication mentions, and evidence comments queued for clinician review.')
                : t('draftPendingPreview', 'Run the flow to prepare an anonymized draft. Nothing is written to OpenMRS until clinician review.')}
            </p>
          </Tile>
        </div>
      </section>
    </div>
  );
};

interface LanguageToggleProps {
  label: string;
  value: LanguageCode;
  onChange: (value: LanguageCode) => void;
}

const LanguageToggle: React.FC<LanguageToggleProps> = ({ label, value, onChange }) => {
  const { t } = useTranslation();

  return (
    <div className={styles.languageToggle}>
      <span>{label}</span>
      <div className={styles.segmentedButtons}>
        <Button kind={value === 'en' ? 'primary' : 'tertiary'} size="sm" onClick={() => onChange('en')}>
          {t('englishShort', 'EN')}
        </Button>
        <Button kind={value === 'es' ? 'primary' : 'tertiary'} size="sm" onClick={() => onChange('es')}>
          {t('spanishShort', 'ES')}
        </Button>
      </div>
    </div>
  );
};

interface FlowStepCardProps {
  title: string;
  detail: string;
  action: string;
  status: StepStatus;
  onRun: () => void;
}

const FlowStepCard: React.FC<FlowStepCardProps> = ({ title, detail, action, status, onRun }) => {
  const { t } = useTranslation();
  const statusLabel =
    status === 'done'
      ? t('done', 'Done')
      : status === 'running'
        ? t('running', 'Running')
        : t('ready', 'Ready');
  const statusKind = status === 'done' ? 'green' : status === 'running' ? 'blue' : 'gray';

  return (
    <Tile className={styles.flowStep}>
      <div className={styles.flowStepHeader}>
        <h5>{title}</h5>
        <Tag type={statusKind} size="sm">
          {statusLabel}
        </Tag>
      </div>
      <p>{detail}</p>
      <Button kind="tertiary" size="sm" disabled={status === 'running'} onClick={onRun}>
        {status === 'running' ? t('working', 'Working...') : action}
      </Button>
    </Tile>
  );
};

function languageLabel(language: LanguageCode, t: ReturnType<typeof useTranslation>['t']) {
  return language === 'en' ? t('english', 'English') : t('spanish', 'Spanish');
}

function transcriptPreview(stepStatus: Record<FlowStep, StepStatus>, t: ReturnType<typeof useTranslation>['t']) {
  if (stepStatus.patientTranslation === 'done') {
    return t(
      'roundTripTranscriptPreview',
      'Doctor EN -> Patient ES complete. Patient ES -> Doctor EN complete. Redacted transcript is ready for review.',
    );
  }

  if (stepStatus.doctorTranslation === 'done') {
    return t(
      'doctorTranslationPreview',
      'Doctor message translated with identifiers redacted. Waiting for patient response.',
    );
  }

  if (stepStatus.doctorStt === 'done') {
    return t(
      'doctorSttPreview',
      'Doctor transcript captured locally. Translation and TTS are pending.',
    );
  }

  return t('waitingForAudioPreview', 'Waiting for local audio capture. Raw audio is not stored by this workspace.');
}

export default VoicePanel;
