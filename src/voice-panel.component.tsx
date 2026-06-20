import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useConnectionState,
  useLocalParticipant,
} from '@livekit/components-react';
import { ConnectionState } from 'livekit-client';
import {
  Button,
  InlineLoading,
  Tag,
  Tile,
  TextArea,
  TextInput,
  Accordion,
  AccordionItem,
} from '@carbon/react';
import {
  Microphone,
  MicrophoneOff,
  StopFilled,
  Play,
  Checkmark,
  WarningAlt,
  CircleDash,
  InProgress,
  Security,
  Save,
} from '@carbon/icons-react';
import { useConfig, usePatient } from '@openmrs/esm-framework';
import { useTranslation } from 'react-i18next';
import {
  fetchLivekitToken,
  resolveLivekitServerUrl,
  resolveTokenEndpoint,
  resolveTokenServerPath,
  saveOpenmrsDraft,
} from './livekit-token';
import { useAgentData } from './use-agent-data';
import AudioVisualizer from './audio-visualizer.component';
import PatientContext from './patient-context.component';
import type { Config } from './config-schema';
import styles from './voice-panel.scss';

interface VoicePanelProps {
  onClose?: () => void;
}

type LanguageCode = 'en' | 'es';
type FlowStep =
  | 'doctorStt'
  | 'doctorTranslation'
  | 'patientTts'
  | 'patientStt'
  | 'patientTranslation'
  | 'openmrsDraft';
type StepStatus = 'idle' | 'running' | 'done';
type ServiceStatus = 'ok' | 'error' | 'pending' | 'checking';

interface EncounterDraft {
  chiefComplaint: string;
  symptoms: string[];
  medicationsMentioned: string[];
  allergiesMentioned: string[];
  assessmentNotes: string;
  patientInstructions: string;
}

interface ServiceHealth {
  livekit: ServiceStatus;
  tokenServer: ServiceStatus;
  openmrs: ServiceStatus;
  stt: ServiceStatus;
  tts: ServiceStatus;
  llm: ServiceStatus;
}

const DEMO_TRANSCRIPT_DOCTOR =
  'The patient reports persistent cough for five days, low-grade fever, and mild chest discomfort. No shortness of breath at rest. Currently taking paracetamol 500mg every 8 hours. No known drug allergies. Assessment: likely viral upper respiratory tract infection. Plan: continue paracetamol, increase fluid intake, return if symptoms worsen or if difficulty breathing develops.';

const DEMO_TRANSCRIPT_PATIENT =
  'He tenido tos por cinco dias, fiebre baja y un poco de molestia en el pecho. No me falta el aire en reposo. Estoy tomando paracetamol cada ocho horas. No soy alergico a ningun medicamento.';

const DEMO_REDACTED_TRANSCRIPT =
  'Doctor (EN): [PATIENT] reports persistent cough for five days, low-grade fever, and mild chest discomfort. No shortness of breath at rest. Currently taking paracetamol 500mg every 8 hours. No known drug allergies.\n\nPatient (ES): [PATIENT] ha tenido tos por cinco dias, fiebre baja y molestia en el pecho. No le falta el aire en reposo. Toma paracetamol cada ocho horas. Sin alergias conocidas.';

const DEMO_DRAFT: EncounterDraft = {
  chiefComplaint: 'Persistent cough and low-grade fever for 5 days',
  symptoms: ['cough', 'low-grade fever', 'mild chest discomfort'],
  medicationsMentioned: ['paracetamol 500mg q8h'],
  allergiesMentioned: [],
  assessmentNotes:
    'Likely viral upper respiratory tract infection. No signs of pneumonia. Needs clinician review.',
  patientInstructions:
    'Continue paracetamol, increase fluid intake, return if breathing worsens or fever exceeds 38.5C.',
};

const initialStepStatus: Record<FlowStep, StepStatus> = {
  doctorStt: 'idle',
  doctorTranslation: 'idle',
  patientTts: 'idle',
  patientStt: 'idle',
  patientTranslation: 'idle',
  openmrsDraft: 'idle',
};

const initialHealth: ServiceHealth = {
  livekit: 'pending',
  tokenServer: 'pending',
  openmrs: 'pending',
  stt: 'pending',
  tts: 'pending',
  llm: 'pending',
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
          <Tag type="blue" size="sm">
            {t('livekitAudio', 'LiveKit audio')}
          </Tag>
          <Tag type="purple" size="sm">
            {t('localStt', 'Local STT')}
          </Tag>
          <Tag type="cyan" size="sm">
            {t('clinicalTranslation', 'Clinical translation')}
          </Tag>
          <Tag type="green" size="sm">
            {t('localTts', 'Local TTS')}
          </Tag>
          <Tag type="gray" size="sm">
            {t('openmrsDraft', 'OpenMRS draft')}
          </Tag>
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
        <PatientContext />
        {error && <p className={styles.error}>{error}</p>}
        <Button kind="primary" renderIcon={Microphone} onClick={connect} disabled={connecting}>
          {connecting ? t('connecting', 'Connecting...') : t('startConsultation', 'Start consultation')}
        </Button>
      </Tile>
    );
  }

  return (
    <LiveKitRoom
      serverUrl={livekitServerUrl}
      token={token}
      connect={true}
      audio={false}
      video={false}
      onDisconnected={resetSession}
      onError={(err) => {
        setError(
          `${err.message}. ${t(
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
        patientUuid={patient?.id ?? ''}
        patientName={patient?.name?.[0]?.text ?? ''}
        roomName={roomName}
        onEnd={disconnect}
        livekitUrl={livekitServerUrl}
        tokenEndpoint={tokenEndpoint}
      />
    </LiveKitRoom>
  );
};

/* ------------------------------------------------------------------ */
/* Active session                                                     */
/* ------------------------------------------------------------------ */

interface ActiveSessionProps {
  patientUuid: string;
  patientName: string;
  roomName: string;
  onEnd: () => void;
  livekitUrl: string;
  tokenEndpoint: string;
}

const ActiveSession: React.FC<ActiveSessionProps> = ({
  patientUuid,
  patientName,
  roomName,
  onEnd,
  livekitUrl,
  tokenEndpoint,
}) => {
  const { t } = useTranslation();
  const connectionState = useConnectionState();
  const { localParticipant } = useLocalParticipant();
  const [muted, setMuted] = useState(true);
  const [micError, setMicError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [doctorLanguage, setDoctorLanguage] = useState<LanguageCode>('en');
  const [patientLanguage, setPatientLanguage] = useState<LanguageCode>('es');
  const [stepStatus, setStepStatus] = useState<Record<FlowStep, StepStatus>>(initialStepStatus);
  const [demoRunning, setDemoRunning] = useState(false);
  const [redactedTranscript, setRedactedTranscript] = useState('');
  const [draft, setDraft] = useState<EncounterDraft | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftSaveMessage, setDraftSaveMessage] = useState<string | null>(null);
  const [draftSaveError, setDraftSaveError] = useState<string | null>(null);
  const [health, setHealth] = useState<ServiceHealth>(initialHealth);
  const timeouts = useRef<number[]>([]);
  const {
    transcripts: agentTranscripts,
    agentDraft,
    agentStatus,
    agentError,
    clearTranscripts,
  } = useAgentData();

  useEffect(() => {
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    return () => {
      timeouts.current.forEach((id) => window.clearTimeout(id));
      timeouts.current = [];
    };
  }, []);

  // Auto-enable mic on connect
  useEffect(() => {
    if (connectionState === ConnectionState.Connected && localParticipant && muted) {
      localParticipant
        .setMicrophoneEnabled(true)
        .then(() => {
          setMuted(false);
          setMicError(null);
        })
        .catch((err) => {
          setMicError(err?.message || 'Microphone access denied. HTTPS or localhost required for Safari.');
        });
    }
  }, [connectionState, localParticipant]);

  // Health check on mount
  useEffect(() => {
    checkHealth(livekitUrl, tokenEndpoint, setHealth);
  }, [livekitUrl, tokenEndpoint]);

  // Merge agent data into UI when real data arrives
  useEffect(() => {
    if (agentDraft && !demoRunning) {
      setDraft(agentDraft);
    }
  }, [agentDraft, demoRunning]);

  const liveTranscriptText = useMemo(() => {
    if (agentTranscripts.length === 0) return '';
    return agentTranscripts
      .map(
        (t) =>
          `${t.role === 'doctor' ? 'Doctor' : 'Patient'} (${t.language.toUpperCase()}): ${t.redacted || t.text}`,
      )
      .join('\n\n');
  }, [agentTranscripts]);

  const toggleMute = useCallback(async () => {
    if (localParticipant) {
      try {
        await localParticipant.setMicrophoneEnabled(muted);
        setMuted(!muted);
        setMicError(null);
      } catch (err) {
        setMicError(err instanceof Error ? err.message : 'Microphone access failed');
      }
    }
  }, [localParticipant, muted]);

  const scheduleTimeout = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timeouts.current.push(id);
    return id;
  }, []);

  const runStep = useCallback(
    (step: FlowStep, delayMs = 700) => {
      return new Promise<void>((resolve) => {
        setStepStatus((cur) => ({ ...cur, [step]: 'running' }));
        scheduleTimeout(() => {
          setStepStatus((cur) => ({ ...cur, [step]: 'done' }));
          resolve();
        }, delayMs);
      });
    },
    [scheduleTimeout],
  );

  const runDemoConversation = useCallback(async () => {
    if (demoRunning) return;
    setDemoRunning(true);
    setRedactedTranscript('');
    setDraft(null);
    setDraftSaved(false);
    setDraftSaveMessage(null);
    setDraftSaveError(null);
    setStepStatus(initialStepStatus);

    await runStep('doctorStt', 1200);
    await runStep('doctorTranslation', 1500);
    await runStep('patientTts', 1000);
    await runStep('patientStt', 1200);
    await runStep('patientTranslation', 1500);
    setRedactedTranscript(DEMO_REDACTED_TRANSCRIPT);
    await runStep('openmrsDraft', 2000);
    setDraft({ ...DEMO_DRAFT });
    setDemoRunning(false);
  }, [demoRunning, runStep]);

  const resetFlow = useCallback(() => {
    timeouts.current.forEach((id) => window.clearTimeout(id));
    timeouts.current = [];
    setStepStatus(initialStepStatus);
    setRedactedTranscript('');
    setDraft(null);
    setDraftSaved(false);
    setDraftSaving(false);
    setDraftSaveMessage(null);
    setDraftSaveError(null);
    setDemoRunning(false);
    clearTranscripts();
  }, [clearTranscripts]);

  const saveDraft = useCallback(async () => {
    if (!draft || !patientUuid || draftSaving) return;

    setDraftSaving(true);
    setDraftSaveError(null);
    setDraftSaveMessage(null);
    try {
      const result = await saveOpenmrsDraft(tokenEndpoint, {
        patientUuid,
        draft,
        redactedTranscript: redactedTranscript || liveTranscriptText,
        writeToOpenmrs: true,
      });
      setDraftSaved(true);
      setDraftSaveMessage(result.message || t('queuedForReview', 'Queued for clinician review'));
    } catch (err) {
      setDraftSaveError(err instanceof Error ? err.message : t('failedToSaveDraft', 'Failed to save draft'));
    } finally {
      setDraftSaving(false);
    }
  }, [draft, draftSaving, liveTranscriptText, patientUuid, redactedTranscript, t, tokenEndpoint]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const stateLabel =
    connectionState === ConnectionState.Connected
      ? t('connected', 'Connected')
      : connectionState === ConnectionState.Connecting
        ? t('connecting', 'Connecting...')
        : t('disconnected', 'Disconnected');

  const stateKind = connectionState === ConnectionState.Connected ? 'green' : 'gray';
  const doctorLanguageLabel = languageLabel(doctorLanguage, t);
  const patientLanguageLabel = languageLabel(patientLanguage, t);

  const flowSteps: Array<{
    step: FlowStep;
    title: string;
    detail: string;
  }> = [
    {
      step: 'doctorStt',
      title: t('doctorStt', 'Doctor STT'),
      detail: t('doctorSttDetail', 'Capture clinician speech and produce a local transcript.'),
    },
    {
      step: 'doctorTranslation',
      title: t('translateForPatient', 'Translate for patient'),
      detail: t(
        'translateForPatientDetail',
        'Redact identifiers and translate clinical meaning to the patient language.',
      ),
    },
    {
      step: 'patientTts',
      title: t('patientTts', 'Patient TTS'),
      detail: t('patientTtsDetail', 'Play the translated message using the local TTS voice.'),
    },
    {
      step: 'patientStt',
      title: t('patientStt', 'Patient STT'),
      detail: t('patientSttDetail', 'Capture patient response and transcribe it locally.'),
    },
    {
      step: 'patientTranslation',
      title: t('translateForDoctor', 'Translate for doctor'),
      detail: t('translateForDoctorDetail', 'Translate the patient response back to the clinician language.'),
    },
    {
      step: 'openmrsDraft',
      title: t('openmrsDraft', 'OpenMRS draft'),
      detail: t('openmrsDraftDetail', 'Compile an anonymized, clinician-reviewable encounter draft.'),
    },
  ];

  return (
    <div className={styles.session}>
      {/* ---- Connection header ---- */}
      <div className={styles.header}>
        <div>
          <h4 className={styles.title}>{patientName}</h4>
          <p className={styles.roomName}>{roomName}</p>
        </div>
        <div className={styles.headerRight}>
          <span className={styles.timer}>{formatTime(elapsed)}</span>
          <Tag type={stateKind} size="sm">
            {stateLabel}
          </Tag>
        </div>
      </div>

      {micError && <p className={styles.error}>{micError}</p>}
      {agentError && <p className={styles.error}>{agentError}</p>}
      {draftSaveError && <p className={styles.error}>{draftSaveError}</p>}

      {/* ---- Audio visualizer ---- */}
      {!muted && <AudioVisualizer width={280} height={40} barCount={32} className={styles.visualizer} />}
      {agentStatus && <p className={styles.agentStatus}>{agentStatus}</p>}

      {/* ---- Controls ---- */}
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
          kind="primary"
          size="md"
          renderIcon={Play}
          onClick={runDemoConversation}
          disabled={demoRunning}
        >
          {demoRunning ? t('demoRunning', 'Running demo...') : t('runDemo', 'Run demo conversation')}
        </Button>
        <Button
          kind="danger--ghost"
          size="lg"
          hasIconOnly
          renderIcon={StopFilled}
          iconDescription={t('endConsultation', 'End consultation')}
          onClick={onEnd}
        />
      </div>

      {/* ---- Local AI pipeline ---- */}
      <section className={styles.section} aria-label={t('translationFlow', 'Translation flow')}>
        <div className={styles.sectionHeader}>
          <h5>{t('localAiPipeline', 'Local AI pipeline')}</h5>
          <Button kind="ghost" size="sm" onClick={resetFlow} disabled={demoRunning}>
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

        <div className={styles.stepList}>
          {flowSteps.map((item, i) => (
            <StepRow
              key={item.step}
              index={i + 1}
              title={item.title}
              detail={item.detail}
              status={stepStatus[item.step]}
            />
          ))}
        </div>
      </section>

      {/* ---- Live transcript (from agent data channel) ---- */}
      {liveTranscriptText && (
        <section className={styles.section}>
          <h5>{t('liveTranscript', 'Live transcript')}</h5>
          <pre className={styles.transcript}>{liveTranscriptText}</pre>
        </section>
      )}

      {/* ---- Redacted transcript (from demo or compile-encounter) ---- */}
      {redactedTranscript && (
        <section className={styles.section}>
          <h5>{t('redactedTranscript', 'Redacted transcript')}</h5>
          <pre className={styles.transcript}>{redactedTranscript}</pre>
        </section>
      )}

      {/* ---- OpenMRS draft ---- */}
      {draft && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h5>{t('encounterDraft', 'Encounter draft')}</h5>
            {draftSaved ? (
              <Tag type="green" size="sm" renderIcon={Checkmark}>
                {t('queuedForReview', 'Queued for clinician review')}
              </Tag>
            ) : (
              <Button
                kind="primary"
                size="sm"
                renderIcon={Save}
                onClick={saveDraft}
                disabled={draftSaving || !patientUuid}
              >
                {draftSaving ? t('savingDraft', 'Saving draft...') : t('saveDraft', 'Save draft to OpenMRS')}
              </Button>
            )}
          </div>
          {draftSaveMessage && <p className={styles.agentStatus}>{draftSaveMessage}</p>}
          <div className={styles.draftGrid}>
            <TextInput
              id="chief-complaint"
              labelText={t('chiefComplaint', 'Chief complaint')}
              value={draft.chiefComplaint}
              onChange={(e) => setDraft({ ...draft, chiefComplaint: e.target.value })}
              readOnly={draftSaved}
            />
            <TextInput
              id="symptoms"
              labelText={t('symptoms', 'Symptoms')}
              value={draft.symptoms.join(', ')}
              onChange={(e) =>
                setDraft({ ...draft, symptoms: e.target.value.split(',').map((s) => s.trim()) })
              }
              readOnly={draftSaved}
            />
            <TextInput
              id="medications"
              labelText={t('medicationsMentioned', 'Medications mentioned')}
              value={draft.medicationsMentioned.join(', ')}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  medicationsMentioned: e.target.value.split(',').map((s) => s.trim()),
                })
              }
              readOnly={draftSaved}
            />
            <TextInput
              id="allergies"
              labelText={t('allergiesMentioned', 'Allergies mentioned')}
              value={
                draft.allergiesMentioned.length > 0
                  ? draft.allergiesMentioned.join(', ')
                  : t('noneReported', 'None reported')
              }
              onChange={(e) =>
                setDraft({
                  ...draft,
                  allergiesMentioned: e.target.value.split(',').map((s) => s.trim()),
                })
              }
              readOnly={draftSaved}
            />
            <TextArea
              id="assessment"
              labelText={t('assessmentNotes', 'Assessment notes')}
              value={draft.assessmentNotes}
              onChange={(e) => setDraft({ ...draft, assessmentNotes: e.target.value })}
              readOnly={draftSaved}
              rows={2}
            />
            <TextArea
              id="instructions"
              labelText={t('patientInstructions', 'Patient instructions')}
              value={draft.patientInstructions}
              onChange={(e) => setDraft({ ...draft, patientInstructions: e.target.value })}
              readOnly={draftSaved}
              rows={2}
            />
          </div>
        </section>
      )}

      {/* ---- Privacy & service health ---- */}
      <Accordion>
        <AccordionItem title={t('privacyAndStatus', 'Privacy & service health')}>
          <div className={styles.bottomPanels}>
            <div className={styles.privacyPanel}>
              <h5>{t('privacyGuarantees', 'Privacy guarantees')}</h5>
              <ul className={styles.privacyList}>
                <PrivacyItem icon={Security} text={t('rawAudioNotStored', 'Raw audio not stored')} />
                <PrivacyItem icon={Security} text={t('localAiProcessing', 'Local AI processing')} />
                <PrivacyItem icon={Security} text={t('phiRedaction', 'PHI redaction enabled')} />
                <PrivacyItem
                  icon={Security}
                  text={t('clinicianReviewRequired', 'Clinician review required')}
                />
                <PrivacyItem icon={Security} text={t('offlineCapable', 'Offline-capable architecture')} />
              </ul>
            </div>
            <div className={styles.healthPanel}>
              <h5>{t('serviceHealth', 'Service health')}</h5>
              <ul className={styles.healthList}>
                <HealthRow label="LiveKit" status={health.livekit} />
                <HealthRow label={t('tokenServer', 'Token server')} status={health.tokenServer} />
                <HealthRow label="OpenMRS" status={health.openmrs} />
                <HealthRow label="STT" status={health.stt} />
                <HealthRow label="TTS" status={health.tts} />
                <HealthRow label="LLM" status={health.llm} />
              </ul>
            </div>
          </div>
        </AccordionItem>
      </Accordion>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Sub-components                                                     */
/* ------------------------------------------------------------------ */

const StepRow: React.FC<{
  index: number;
  title: string;
  detail: string;
  status: StepStatus;
}> = ({ index, title, detail, status }) => {
  const icon =
    status === 'done' ? (
      <Checkmark className={styles.stepIconDone} />
    ) : status === 'running' ? (
      <InProgress className={styles.stepIconRunning} />
    ) : (
      <CircleDash className={styles.stepIconIdle} />
    );

  return (
    <div className={`${styles.stepRow} ${styles[`stepStatus_${status}`]}`}>
      <span className={styles.stepIndex}>{index}</span>
      {icon}
      <div className={styles.stepText}>
        <span className={styles.stepTitle}>{title}</span>
        <span className={styles.stepDetail}>{detail}</span>
      </div>
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

const PrivacyItem: React.FC<{ icon: React.ComponentType; text: string }> = ({ icon: Icon, text }) => (
  <li className={styles.privacyItem}>
    <Icon />
    <span>{text}</span>
  </li>
);

const HealthRow: React.FC<{ label: string; status: ServiceStatus }> = ({ label, status }) => {
  const { t } = useTranslation();
  const statusLabel: Record<ServiceStatus, string> = {
    ok: t('healthy', 'Healthy'),
    error: t('unreachable', 'Unreachable'),
    pending: t('pendingBackend', 'Pending backend'),
    checking: t('checking', 'Checking...'),
  };
  const tagType: Record<ServiceStatus, string> = {
    ok: 'green',
    error: 'red',
    pending: 'gray',
    checking: 'blue',
  };

  return (
    <li className={styles.healthRow}>
      <span>{label}</span>
      <Tag type={tagType[status] as 'green' | 'red' | 'gray' | 'blue'} size="sm">
        {statusLabel[status]}
      </Tag>
    </li>
  );
};

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function languageLabel(language: LanguageCode, t: ReturnType<typeof useTranslation>['t']) {
  return language === 'en' ? t('english', 'English') : t('spanish', 'Spanish');
}

async function checkHealth(
  livekitUrl: string,
  tokenEndpoint: string,
  setHealth: React.Dispatch<React.SetStateAction<ServiceHealth>>,
) {
  setHealth({
    livekit: 'checking',
    tokenServer: 'checking',
    openmrs: 'checking',
    stt: 'checking',
    tts: 'checking',
    llm: 'checking',
  });

  const httpLivekit = livekitUrl.replace(/^ws/, 'http');

  try {
    const res = await fetch(resolveTokenServerPath(tokenEndpoint, '/health'), {
      method: 'GET',
      credentials: 'include',
      signal: AbortSignal.timeout(5000),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload?.services) {
      throw new Error('Token server health response was not available');
    }

    setHealth({
      livekit: serviceHealthToStatus(payload.services.livekit?.status),
      tokenServer: serviceHealthToStatus(payload.services.tokenServer?.status),
      openmrs: serviceHealthToStatus(payload.services.openmrs?.status),
      stt: serviceHealthToStatus(payload.services.stt?.status),
      tts: serviceHealthToStatus(payload.services.tts?.status),
      llm: serviceHealthToStatus(payload.services.ollama?.status),
    });
    return;
  } catch {
    setHealth((h) => ({
      ...h,
      tokenServer: 'error',
      stt: 'pending',
      tts: 'pending',
      llm: 'pending',
    }));
  }

  const checks: Array<{ key: keyof ServiceHealth; url: string }> = [
    { key: 'livekit', url: httpLivekit },
    { key: 'openmrs', url: '/openmrs/ws/fhir2/R4/metadata' },
  ];

  await Promise.all(
    checks.map(async ({ key, url }) => {
      try {
        const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(5000) });
        setHealth((h) => ({ ...h, [key]: res.ok ? 'ok' : 'error' }));
      } catch {
        setHealth((h) => ({ ...h, [key]: 'error' }));
      }
    }),
  );
}

function serviceHealthToStatus(status: unknown): ServiceStatus {
  if (status === 'ok' || status === 'configured') {
    return 'ok';
  }
  if (status === 'unreachable' || status === 'error') {
    return 'error';
  }
  return 'pending';
}

export default VoicePanel;
