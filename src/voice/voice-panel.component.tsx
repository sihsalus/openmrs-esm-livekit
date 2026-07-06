import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useConnectionState,
  useLocalParticipant,
} from '@livekit/components-react';
import { ConnectionState } from 'livekit-client';
import { Button, Tag, Tile, TextArea, TextInput, Accordion, AccordionItem, ButtonSet } from '@carbon/react';
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
import { useConfig, usePatient, useVisit } from '@openmrs/esm-framework';
import { useTranslation } from 'react-i18next';
import {
  buildQueuedOpenmrsDraftPayload,
  fetchLivekitToken,
  resolveTokenServerPath,
  saveOpenmrsDraft,
} from '../livekit/livekit-token';
import { resolveLivekitOperationalConfig } from '../livekit/livekit-config';
import { useAgentData, type AgentClinicalFact, type AgentTranscript } from '../livekit/use-agent-data';
import {
  checkingHealth,
  initialHealth,
  normalizeTokenServerHealth,
  type ServiceHealth,
  type ServiceStatus,
} from '../livekit/agent-health';
import {
  isBrowserMicrophoneAvailable,
  microphoneErrorMessage,
  microphoneUnavailableMessage,
} from '../audio/microphone-availability';
import {
  clinicalLanguageDefaultsFromLocale,
  openmrsLocaleFromI18n,
  type ClinicalLanguageCode,
} from '../clinical/clinical-language';
import { shouldAttemptInitialMicrophoneEnable } from '../audio/microphone-control';
import { mergeEncounterDraft } from '../clinical/encounter-draft';
import AudioVisualizer from '../audio/audio-visualizer.component';
import PatientContext from '../patient/patient-context.component';
import type { Config } from '../config-schema';
import styles from './voice-panel.scss';

interface VoicePanelProps {
  onClose?: () => void;
  onPreflightActionsChange?: (actions: VoicePanelPreflightActions | null) => void;
}

export interface VoicePanelPreflightActions {
  startDisabled: boolean;
  startLabel: string;
  onStart: () => void;
}

type LanguageCode = ClinicalLanguageCode;
type FlowStep =
  | 'doctorStt'
  | 'doctorTranslation'
  | 'patientTts'
  | 'patientStt'
  | 'patientTranslation'
  | 'openmrsDraft';
type StepStatus = 'idle' | 'running' | 'done';

interface EncounterDraft {
  patientUuid?: string | null;
  chiefComplaint: string;
  symptoms: string[];
  medicationsMentioned: string[];
  allergiesMentioned: string[];
  assessmentNotes: string;
  patientInstructions: string;
  facts?: AgentClinicalFact[];
  reviewQueue?: AgentClinicalFact[];
  missingFields?: string[];
  clinicianReviewRequired?: boolean;
}

const agentFallbackDelaySeconds = 12;

const DEMO_CONVERSATIONS: Record<
  LanguageCode,
  {
    doctorTranscript: string;
    patientTranscript: string;
    draft: EncounterDraft;
  }
> = {
  en: {
    doctorTranscript:
      '[PATIENT] reports persistent cough for five days, low-grade fever, and mild chest discomfort. No shortness of breath at rest. Currently taking paracetamol 500mg every 8 hours. No known drug allergies.',
    patientTranscript:
      '[PATIENT] has had cough for five days, low-grade fever, and mild chest discomfort. No shortness of breath at rest. They are taking paracetamol every eight hours and report no known drug allergies.',
    draft: {
      chiefComplaint: 'Persistent cough and low-grade fever for 5 days',
      symptoms: ['cough', 'low-grade fever', 'mild chest discomfort'],
      medicationsMentioned: ['paracetamol 500mg q8h'],
      allergiesMentioned: [],
      assessmentNotes:
        'Likely viral upper respiratory tract infection. No signs of pneumonia. Needs clinician review.',
      patientInstructions:
        'Continue paracetamol, increase fluid intake, return if breathing worsens or fever exceeds 38.5C.',
      missingFields: ['Respiratory rate', 'Oxygen saturation'],
      reviewQueue: [
        {
          kind: 'assessment',
          value: 'Likely viral upper respiratory tract infection',
          confidence: 0.72,
          status: 'detected',
          needsReview: true,
        },
      ],
      clinicianReviewRequired: true,
    },
  },
  es: {
    doctorTranscript:
      '[PATIENT] reporta tos persistente desde hace cinco dias, fiebre baja y molestia toracica leve. No presenta falta de aire en reposo. Toma paracetamol 500 mg cada 8 horas. Niega alergias conocidas a medicamentos.',
    patientTranscript:
      '[PATIENT] ha tenido tos por cinco dias, fiebre baja y un poco de molestia en el pecho. No le falta el aire en reposo. Toma paracetamol cada ocho horas. Sin alergias conocidas.',
    draft: {
      chiefComplaint: 'Tos persistente y fiebre baja por 5 dias',
      symptoms: ['tos', 'fiebre baja', 'molestia toracica leve'],
      medicationsMentioned: ['paracetamol 500 mg cada 8 horas'],
      allergiesMentioned: [],
      assessmentNotes:
        'Probable infeccion viral de vias respiratorias altas. Sin signos claros de neumonia. Requiere revision clinica.',
      patientInstructions:
        'Continuar paracetamol, aumentar la ingesta de liquidos y regresar si empeora la respiracion o si la fiebre supera 38.5C.',
      missingFields: ['Frecuencia respiratoria', 'Saturacion de oxigeno'],
      reviewQueue: [
        {
          kind: 'assessment',
          value: 'Probable infeccion viral de vias respiratorias altas',
          confidence: 0.72,
          status: 'detected',
          needsReview: true,
        },
      ],
      clinicianReviewRequired: true,
    },
  },
};

const initialStepStatus: Record<FlowStep, StepStatus> = {
  doctorStt: 'idle',
  doctorTranslation: 'idle',
  patientTts: 'idle',
  patientStt: 'idle',
  patientTranslation: 'idle',
  openmrsDraft: 'idle',
};

const VoicePanel: React.FC<VoicePanelProps> = ({ onClose, onPreflightActionsChange }) => {
  const { t, i18n } = useTranslation();
  const config = useConfig<Config>();
  const { patient, isLoading: patientLoading } = usePatient();
  const patientUuid = patient?.id ?? '';
  const { activeVisit, isLoading: activeVisitLoading } = useVisit(patientUuid);
  const openmrsLocale = openmrsLocaleFromI18n(i18n);
  const defaultLanguages = useMemo(() => clinicalLanguageDefaultsFromLocale(openmrsLocale), [openmrsLocale]);
  const languageSelectionTouched = useRef(false);
  const voiceSelectionTouched = useRef(false);
  const livekitConfig = useMemo(() => resolveLivekitOperationalConfig(config), [config]);
  const { livekitServerUrl, tokenEndpoint, roomPrefix } = livekitConfig;
  const demoFlowEnabled = Boolean(config.enableDemoFlow);
  const [token, setToken] = useState<string | null>(null);
  const [roomName, setRoomName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [doctorLanguage, setDoctorLanguage] = useState<LanguageCode>(defaultLanguages.doctorLanguage);
  const [patientLanguage, setPatientLanguage] = useState<LanguageCode>(defaultLanguages.patientLanguage);
  const [agentVoiceLanguage, setAgentVoiceLanguage] = useState<LanguageCode>(defaultLanguages.doctorLanguage);
  const activeVisitUuid = activeVisit?.uuid ?? '';
  const shouldWaitForVisit = Boolean(patientUuid) && activeVisitLoading;
  const activeVisitRequiredMessage = t(
    'activeVisitRequiredDetail',
    'Start an active visit before opening a voice consultation so any reviewed draft can be attached to that visit.',
  );

  useEffect(() => {
    if (languageSelectionTouched.current) {
      return;
    }

    setDoctorLanguage(defaultLanguages.doctorLanguage);
    setPatientLanguage(defaultLanguages.patientLanguage);
    if (!voiceSelectionTouched.current) {
      setAgentVoiceLanguage(defaultLanguages.doctorLanguage);
    }
  }, [defaultLanguages.doctorLanguage, defaultLanguages.patientLanguage]);

  const updateDoctorLanguage = useCallback((language: LanguageCode) => {
    languageSelectionTouched.current = true;
    setDoctorLanguage(language);
    if (!voiceSelectionTouched.current) {
      setAgentVoiceLanguage(language);
    }
  }, []);

  const updatePatientLanguage = useCallback((language: LanguageCode) => {
    languageSelectionTouched.current = true;
    setPatientLanguage(language);
  }, []);

  const updateAgentVoiceLanguage = useCallback((language: LanguageCode) => {
    voiceSelectionTouched.current = true;
    setAgentVoiceLanguage(language);
  }, []);

  const connect = useCallback(async () => {
    if (!patientUuid) {
      setError(t('missingPatient', 'No patient context is available for this voice consultation.'));
      return;
    }
    if (!activeVisitUuid) {
      setError(activeVisitRequiredMessage);
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const result = await fetchLivekitToken(
        patientUuid,
        tokenEndpoint,
        roomPrefix,
        {
          doctorLanguage,
          patientLanguage,
          agentVoiceLanguage,
        },
        { visitUuid: activeVisitUuid },
      );
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
  }, [
    activeVisitRequiredMessage,
    activeVisitUuid,
    agentVoiceLanguage,
    doctorLanguage,
    patientLanguage,
    patientUuid,
    roomPrefix,
    t,
    tokenEndpoint,
  ]);

  const disconnect = useCallback(() => {
    setToken(null);
    setRoomName('');
    onClose?.();
  }, [onClose]);

  const resetSession = useCallback(() => {
    setToken(null);
    setRoomName('');
  }, []);

  const startConsultationLabel = patientLoading
    ? t('loadingPatient', 'Loading patient...')
    : shouldWaitForVisit
      ? t('loadingVisit', 'Loading visit...')
      : connecting
        ? t('connecting', 'Connecting...')
        : t('startConsultation', 'Start consultation');
  const startConsultationDisabled =
    patientLoading || shouldWaitForVisit || connecting || !patientUuid || !activeVisitUuid;

  useEffect(() => {
    if (!onPreflightActionsChange) {
      return;
    }

    if (token) {
      onPreflightActionsChange(null);
      return;
    }

    onPreflightActionsChange({
      startDisabled: startConsultationDisabled,
      startLabel: startConsultationLabel,
      onStart: connect,
    });
  }, [connect, onPreflightActionsChange, startConsultationDisabled, startConsultationLabel, token]);

  useEffect(() => {
    return () => onPreflightActionsChange?.(null);
  }, [onPreflightActionsChange]);

  if (!token) {
    return (
      <div className={`${styles.panel} ${styles.preflightPanel}`}>
        <Tile className={styles.languageCard}>
          <h5>{t('consultationLanguages', 'Consultation languages')}</h5>
          <div className={styles.languageControls}>
            <LanguageToggle
              label={t('doctorLanguage', 'Doctor language')}
              value={doctorLanguage}
              onChange={updateDoctorLanguage}
            />
            <LanguageToggle
              label={t('patientLanguage', 'Patient language')}
              value={patientLanguage}
              onChange={updatePatientLanguage}
            />
            <LanguageToggle
              label={t('agentVoiceLanguage', 'Agent voice')}
              value={agentVoiceLanguage}
              onChange={updateAgentVoiceLanguage}
            />
          </div>
        </Tile>

        <PatientContext />
        {error && <p className={styles.error}>{error}</p>}
        {!onPreflightActionsChange && (
          <ButtonSet className={styles.preflightActions}>
            {onClose && (
              <Button kind="secondary" onClick={onClose}>
                {t('cancel', 'Cancel')}
              </Button>
            )}
            <Button kind="primary" onClick={connect} disabled={startConsultationDisabled}>
              <span className={styles.buttonLabelWithIcon}>
                {startConsultationLabel}
                <Microphone size={16} />
              </span>
            </Button>
          </ButtonSet>
        )}
      </div>
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
        visitUuid={activeVisitUuid}
        patientName={patient?.name?.[0]?.text ?? ''}
        roomName={roomName}
        onEnd={disconnect}
        livekitUrl={livekitServerUrl}
        tokenEndpoint={tokenEndpoint}
        doctorLanguage={doctorLanguage}
        patientLanguage={patientLanguage}
        agentVoiceLanguage={agentVoiceLanguage}
        demoFlowEnabled={demoFlowEnabled}
      />
    </LiveKitRoom>
  );
};

/* ------------------------------------------------------------------ */
/* Active session                                                     */
/* ------------------------------------------------------------------ */

interface ActiveSessionProps {
  patientUuid: string;
  visitUuid: string;
  patientName: string;
  roomName: string;
  onEnd: () => void;
  livekitUrl: string;
  tokenEndpoint: string;
  doctorLanguage: LanguageCode;
  patientLanguage: LanguageCode;
  agentVoiceLanguage: LanguageCode;
  demoFlowEnabled: boolean;
}

const ActiveSession: React.FC<ActiveSessionProps> = ({
  patientUuid,
  visitUuid,
  patientName,
  roomName,
  onEnd,
  livekitUrl,
  tokenEndpoint,
  doctorLanguage,
  patientLanguage,
  agentVoiceLanguage,
  demoFlowEnabled,
}) => {
  const { t } = useTranslation();
  const connectionState = useConnectionState();
  const { localParticipant } = useLocalParticipant();
  const [muted, setMuted] = useState(true);
  const [micError, setMicError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [agentWaitSeconds, setAgentWaitSeconds] = useState(0);
  const [stepStatus, setStepStatus] = useState<Record<FlowStep, StepStatus>>(initialStepStatus);
  const [demoRunning, setDemoRunning] = useState(false);
  const [redactedTranscript, setRedactedTranscript] = useState('');
  const [draft, setDraft] = useState<EncounterDraft | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftSaveMessage, setDraftSaveMessage] = useState<string | null>(null);
  const [draftSaveError, setDraftSaveError] = useState<string | null>(null);
  const [health, setHealth] = useState<ServiceHealth>(initialHealth);
  const microphoneAvailable = isBrowserMicrophoneAvailable();
  const timeouts = useRef<number[]>([]);
  const lastAppliedAgentDraft = useRef<EncounterDraft | null>(null);
  const initialMicrophoneEnableAttempted = useRef(false);
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

  useEffect(() => {
    const connected = connectionState === ConnectionState.Connected;
    if (!connected) {
      initialMicrophoneEnableAttempted.current = false;
      return;
    }

    if (
      !shouldAttemptInitialMicrophoneEnable({
        connected,
        hasLocalParticipant: Boolean(localParticipant),
        muted,
        attempted: initialMicrophoneEnableAttempted.current,
      }) ||
      !localParticipant
    ) {
      return;
    }

    if (!microphoneAvailable) {
      initialMicrophoneEnableAttempted.current = true;
      setMicError(microphoneUnavailableMessage(t));
      return;
    }

    let cancelled = false;

    const enableMicrophone = async () => {
      try {
        await localParticipant.setMicrophoneEnabled(true);
        if (!cancelled) {
          initialMicrophoneEnableAttempted.current = true;
          setMuted(false);
          setMicError(null);
        }
      } catch (err) {
        if (!cancelled) {
          initialMicrophoneEnableAttempted.current = true;
          setMicError(microphoneErrorMessage(err, t));
        }
      }
    };

    enableMicrophone();

    return () => {
      cancelled = true;
    };
  }, [connectionState, localParticipant, microphoneAvailable, muted, t]);

  // Health check on mount
  useEffect(() => {
    checkHealth(livekitUrl, tokenEndpoint, setHealth);
  }, [livekitUrl, tokenEndpoint]);

  // Merge agent data into UI when real data arrives
  useEffect(() => {
    if (!agentDraft || demoRunning || lastAppliedAgentDraft.current === agentDraft) {
      return;
    }

    lastAppliedAgentDraft.current = agentDraft;
    setDraft((currentDraft) => mergeEncounterDraft(currentDraft, agentDraft));
    setDraftSaved(false);
    setDraftSaveMessage(null);
    setDraftSaveError(null);
  }, [agentDraft, demoRunning]);

  const liveTranscriptText = useMemo(() => {
    if (agentTranscripts.length === 0) return '';
    return agentTranscripts
      .map(
        (transcript) =>
          `${transcriptRoleLabel(transcript.role, t)} (${transcript.language.toUpperCase()}${transcriptAttributionLabel(
            transcript,
            t,
          )}): ${transcript.redacted || transcript.text}`,
      )
      .join('\n\n');
  }, [agentTranscripts, t]);

  const agentHasActivity = agentTranscripts.length > 0 || Boolean(agentDraft || agentStatus);
  const hasFlowOutput = Boolean(draft || redactedTranscript || liveTranscriptText);

  useEffect(() => {
    if (connectionState !== ConnectionState.Connected || agentHasActivity || agentError || hasFlowOutput) {
      setAgentWaitSeconds(0);
      return;
    }

    const interval = setInterval(() => setAgentWaitSeconds((seconds) => seconds + 1), 1000);
    return () => clearInterval(interval);
  }, [agentError, agentHasActivity, connectionState, hasFlowOutput]);

  const agentHealth: ServiceStatus = agentError
    ? 'error'
    : agentHasActivity
      ? 'ok'
      : connectionState === ConnectionState.Connected
        ? agentWaitSeconds >= agentFallbackDelaySeconds
          ? 'error'
          : 'checking'
        : 'pending';
  const showAgentFallback =
    connectionState === ConnectionState.Connected &&
    agentWaitSeconds >= agentFallbackDelaySeconds &&
    !agentHasActivity &&
    !hasFlowOutput &&
    !agentError &&
    !demoRunning;

  const toggleMute = useCallback(async () => {
    if (!localParticipant) {
      return;
    }

    if (!microphoneAvailable) {
      setMicError(microphoneUnavailableMessage(t));
      return;
    }

    try {
      await localParticipant.setMicrophoneEnabled(muted);
      setMuted(!muted);
      setMicError(null);
    } catch (err) {
      setMicError(microphoneErrorMessage(err, t));
    }
  }, [localParticipant, microphoneAvailable, muted, t]);

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
    if (!demoFlowEnabled || demoRunning) return;
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
    setRedactedTranscript(buildDemoRedactedTranscript(doctorLanguage, patientLanguage, t));
    await runStep('openmrsDraft', 2000);
    setDraft(cloneEncounterDraft(DEMO_CONVERSATIONS[doctorLanguage].draft));
    setDemoRunning(false);
  }, [demoFlowEnabled, demoRunning, doctorLanguage, patientLanguage, runStep, t]);

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
    lastAppliedAgentDraft.current = null;
    clearTranscripts();
  }, [clearTranscripts]);

  const saveDraft = useCallback(async () => {
    if (!draft || !patientUuid || draftSaving) return;

    setDraftSaving(true);
    setDraftSaveError(null);
    setDraftSaveMessage(null);
    try {
      const result = await saveOpenmrsDraft(
        tokenEndpoint,
        buildQueuedOpenmrsDraftPayload({
          patientUuid,
          visitUuid,
          draft,
          redactedTranscript: redactedTranscript || liveTranscriptText,
        }),
      );
      setDraftSaved(true);
      setDraftSaveMessage(result.message || t('queuedForReview', 'Queued for clinician review'));
    } catch (err) {
      setDraftSaveError(err instanceof Error ? err.message : t('failedToSaveDraft', 'Failed to save draft'));
    } finally {
      setDraftSaving(false);
    }
  }, [draft, draftSaving, liveTranscriptText, patientUuid, redactedTranscript, t, tokenEndpoint, visitUuid]);

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
  const agentVoiceLanguageLabel = languageLabel(agentVoiceLanguage, t);
  const microphoneButtonLabel = microphoneAvailable
    ? muted
      ? t('unmute', 'Unmute')
      : t('mute', 'Mute')
    : t('microphoneUnavailableShort', 'Microphone unavailable');

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
      title: t('translateToLanguage', 'Translate to {{language}}', { language: patientLanguageLabel }),
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
      title: t('translateToLanguage', 'Translate to {{language}}', { language: doctorLanguageLabel }),
      detail: t('translateForDoctorDetail', 'Translate the patient response back to the clinician language.'),
    },
    {
      step: 'openmrsDraft',
      title: t('openmrsDraft', 'OpenMRS draft'),
      detail: t('openmrsDraftDetail', 'Compile an anonymized, clinician-reviewable encounter draft.'),
    },
  ];
  const aiCapabilityPendingLabel = t('activeViaAgent', 'Active via agent');
  const sttHealthDetail =
    health.sttSource === 'agent'
      ? t(
          'sttAgentCapabilityDetail',
          'Speech-to-text is provided by the LiveKit agent, not the helper /stt endpoint.',
        )
      : t('sttHelperCapabilityDetail', 'Optional helper /stt endpoint for smoke tests.');
  const ttsHealthDetail =
    health.ttsSource === 'agent'
      ? t(
          'ttsAgentCapabilityDetail',
          'Text-to-speech is provided by the LiveKit agent, not the helper /tts endpoint.',
        )
      : t('ttsHelperCapabilityDetail', 'Optional helper /tts endpoint for smoke tests.');
  const llmHealthDetail =
    health.llmSource === 'agent'
      ? t('llmAgentCapabilityDetail', 'Clinical drafting and tool calls are provided by the LiveKit agent.')
      : t('llmHelperCapabilityDetail', 'Helper parser status for smoke tests and draft fallback.');

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
      <AudioVisualizer
        barCount={24}
        className={styles.visualizer}
        label={t('microphone', 'Microphone')}
        muted={muted}
        mutedLabel={t('muted', 'Muted')}
        activeLabel={t('recording', 'Recording')}
      />
      {agentStatus && <p className={styles.agentStatus}>{agentStatus}</p>}

      {/* ---- Controls ---- */}
      <div className={styles.controls}>
        <Button
          kind="ghost"
          size="lg"
          hasIconOnly
          renderIcon={muted ? MicrophoneOff : Microphone}
          iconDescription={microphoneButtonLabel}
          onClick={toggleMute}
          disabled={!microphoneAvailable}
        />
        {demoFlowEnabled && (
          <Button
            kind="primary"
            size="md"
            renderIcon={Play}
            onClick={runDemoConversation}
            disabled={demoRunning}
          >
            {demoRunning ? t('demoRunning', 'Running demo...') : t('runDemo', 'Run demo conversation')}
          </Button>
        )}
        <Button
          kind="danger--ghost"
          size="lg"
          hasIconOnly
          renderIcon={StopFilled}
          iconDescription={t('endConsultation', 'End consultation')}
          onClick={onEnd}
        />
      </div>

      {showAgentFallback && (
        <div className={styles.agentFallback} role="status">
          <WarningAlt />
          <div>
            <strong>{t('agentNotResponding', 'Agent not publishing data')}</strong>
            <p>
              {demoFlowEnabled
                ? t(
                    'agentNotRespondingDetailWithDemo',
                    'Start the OpenMRS LiveKit agent for this room, or run the local demo flow while the room stays connected.',
                  )
                : t('agentNotRespondingDetail', 'Start or restart the OpenMRS LiveKit agent for this room.')}
            </p>
          </div>
          {demoFlowEnabled && (
            <Button kind="tertiary" size="sm" renderIcon={Play} onClick={runDemoConversation}>
              {t('runDemo', 'Run demo conversation')}
            </Button>
          )}
        </div>
      )}

      {/* ---- Local AI pipeline ---- */}
      <section className={styles.section} aria-label={t('translationFlow', 'Translation flow')}>
        <div className={styles.sectionHeader}>
          <h5>{t('localAiPipeline', 'Local AI pipeline')}</h5>
          <Button kind="ghost" size="sm" onClick={resetFlow} disabled={demoRunning}>
            {t('resetFlow', 'Reset flow')}
          </Button>
        </div>

        <div className={styles.roomLanguageSummary}>
          <span>{t('roomLanguageMetadata', 'Room language metadata')}</span>
          <div className={styles.roomLanguageTags}>
            <Tag type="blue" size="sm">
              {t('doctorLanguageValue', 'Doctor: {{language}}', {
                language: doctorLanguageLabel,
              })}
            </Tag>
            <Tag type="cyan" size="sm">
              {t('patientLanguageValue', 'Patient: {{language}}', {
                language: patientLanguageLabel,
              })}
            </Tag>
            <Tag type="purple" size="sm">
              {t('agentVoiceLanguageValue', 'Voice: {{language}}', {
                language: agentVoiceLanguageLabel,
              })}
            </Tag>
            <Tag type="blue" size="sm">
              {t('speakerAttributionModeValue', 'Source-role attribution')}
            </Tag>
            <Tag type="gray" size="sm">
              {t('fixedForRoom', 'Fixed for room')}
            </Tag>
          </div>
          <p>
            {t(
              'roomLanguageMetadataDetail',
              'The agent received these values before joining. Speaker attribution uses STT speaker IDs when available and falls back to the configured default role.',
            )}
          </p>
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
            <div className={styles.headerActions}>
              {draft.clinicianReviewRequired !== false && !draftSaved && (
                <Tag type="purple" size="sm" renderIcon={WarningAlt}>
                  {t('reviewRequired', 'Review required')}
                </Tag>
              )}
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
                  {draftSaving ? t('savingDraft', 'Saving draft...') : t('queueDraft', 'Queue draft')}
                </Button>
              )}
            </div>
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
              onChange={(e) => setDraft({ ...draft, symptoms: splitListInput(e.target.value) })}
              readOnly={draftSaved}
            />
            <TextInput
              id="medications"
              labelText={t('medicationsMentioned', 'Medications mentioned')}
              value={draft.medicationsMentioned.join(', ')}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  medicationsMentioned: splitListInput(e.target.value),
                })
              }
              readOnly={draftSaved}
            />
            <TextInput
              id="allergies"
              labelText={t('allergiesMentioned', 'Allergies mentioned')}
              value={draft.allergiesMentioned.join(', ')}
              placeholder={t('noneReported', 'None reported')}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  allergiesMentioned: splitListInput(e.target.value),
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

          {(draft.missingFields?.length || draft.reviewQueue?.length) && (
            <div className={styles.reviewPanel}>
              {draft.missingFields?.length ? (
                <div className={styles.reviewBlock}>
                  <h6>{t('missingFields', 'Missing fields')}</h6>
                  <div className={styles.tagList}>
                    {draft.missingFields.map((field) => (
                      <Tag key={field} type="red" size="sm">
                        {field}
                      </Tag>
                    ))}
                  </div>
                </div>
              ) : null}

              {draft.reviewQueue?.length ? (
                <div className={styles.reviewBlock}>
                  <h6>{t('reviewQueue', 'Review queue')}</h6>
                  <ul className={styles.reviewList}>
                    {draft.reviewQueue.map((item, index) => (
                      <li key={`${item.kind}-${item.value}-${index}`} className={styles.reviewItem}>
                        <div>
                          <span className={styles.reviewKind}>{formatFactKind(item.kind)}</span>
                          <span className={styles.reviewValue}>{item.value}</span>
                        </div>
                        <Tag type={item.needsReview ? 'red' : 'gray'} size="sm">
                          {formatConfidence(item.confidence)}
                        </Tag>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
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
              <div className={styles.healthGroup}>
                <h6>{t('runtimeServices', 'Runtime services')}</h6>
                <ul className={styles.healthList}>
                  <HealthRow
                    label="LiveKit"
                    status={health.livekit}
                    detail={t('livekitHealthDetail', 'Room transport and media server')}
                  />
                  <HealthRow
                    label={t('tokenServer', 'Token server')}
                    status={health.tokenServer}
                    detail={t('tokenServerHealthDetail', 'Room tokens and helper API')}
                  />
                  <HealthRow
                    label={t('agent', 'Agent')}
                    status={agentHealth}
                    detail={t('agentHealthDetail', 'Publishes transcript and draft data')}
                  />
                  <HealthRow
                    label="OpenMRS"
                    status={health.openmrs}
                    detail={t('openmrsHealthDetail', 'Patient record and encounter write target')}
                  />
                  <HealthRow
                    label={t('draftWrite', 'Draft write')}
                    status={health.openmrsDraftWrite}
                    detail={t('draftWriteHealthDetail', 'Encounter save configuration')}
                  />
                </ul>
              </div>
              <div className={styles.healthGroup}>
                <h6>{t('localAiCapabilities', 'Local AI capabilities')}</h6>
                <ul className={styles.healthList}>
                  <HealthRow
                    label="STT"
                    status={health.stt}
                    detail={sttHealthDetail}
                    statusText={
                      health.sttSource === 'agent' && health.stt === 'ok'
                        ? aiCapabilityPendingLabel
                        : undefined
                    }
                  />
                  <HealthRow
                    label="TTS"
                    status={health.tts}
                    detail={ttsHealthDetail}
                    statusText={
                      health.ttsSource === 'agent' && health.tts === 'ok'
                        ? aiCapabilityPendingLabel
                        : undefined
                    }
                  />
                  <HealthRow
                    label="LLM"
                    status={health.llm}
                    detail={llmHealthDetail}
                    statusText={
                      health.llmSource === 'agent' && health.llm === 'ok'
                        ? aiCapabilityPendingLabel
                        : undefined
                    }
                  />
                </ul>
              </div>
              <div className={styles.healthGroup}>
                <h6>{t('deploymentReadiness', 'Deployment readiness')}</h6>
                <ul className={styles.healthList}>
                  <HealthRow
                    label={t('productionGate', 'Production gate')}
                    status={health.productionReadiness}
                    detail={t('productionGateDetail', 'Rejects unsafe shared deployment config')}
                  />
                  <HealthRow
                    label={t('tokenServerAuth', 'Token server auth')}
                    status={health.tokenServerAuth}
                    detail={t(
                      'tokenServerAuthDetail',
                      'Requires an authenticated OpenMRS session when enforced',
                    )}
                  />
                  <HealthRow
                    label="CORS"
                    status={health.cors}
                    detail={t('corsHealthDetail', 'Browser origin allowlist')}
                  />
                  <HealthRow
                    label={t('localStorage', 'Local storage')}
                    status={health.localStorage}
                    detail={t('localStorageHealthDetail', 'Draft and manifest files are owner-only')}
                  />
                </ul>
              </div>
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

const HealthRow: React.FC<{ label: string; status: ServiceStatus; detail?: string; statusText?: string }> = ({
  label,
  status,
  detail,
  statusText,
}) => {
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
      <span>
        <strong>{label}</strong>
        {detail && <small>{detail}</small>}
      </span>
      <Tag type={tagType[status] as 'green' | 'red' | 'gray' | 'blue'} size="sm">
        {statusText ?? statusLabel[status]}
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

function buildDemoRedactedTranscript(
  doctorLanguage: LanguageCode,
  patientLanguage: LanguageCode,
  t: ReturnType<typeof useTranslation>['t'],
) {
  return `${transcriptRoleLabel('doctor', t)} (${doctorLanguage.toUpperCase()}): ${
    DEMO_CONVERSATIONS[doctorLanguage].doctorTranscript
  }\n\n${transcriptRoleLabel('patient', t)} (${patientLanguage.toUpperCase()}): ${
    DEMO_CONVERSATIONS[patientLanguage].patientTranscript
  }`;
}

function cloneEncounterDraft(draft: EncounterDraft): EncounterDraft {
  return {
    ...draft,
    symptoms: [...draft.symptoms],
    medicationsMentioned: [...draft.medicationsMentioned],
    allergiesMentioned: [...draft.allergiesMentioned],
    facts: draft.facts?.map((fact) => ({ ...fact })),
    reviewQueue: draft.reviewQueue?.map((fact) => ({ ...fact })),
    missingFields: draft.missingFields ? [...draft.missingFields] : undefined,
  };
}

function transcriptRoleLabel(
  role: 'doctor' | 'patient' | 'assistant',
  t: ReturnType<typeof useTranslation>['t'],
) {
  if (role === 'doctor') {
    return t('doctor', 'Doctor');
  }
  if (role === 'patient') {
    return t('patient', 'Patient');
  }
  return t('assistant', 'Assistant');
}

function transcriptAttributionLabel(transcript: AgentTranscript, t: ReturnType<typeof useTranslation>['t']) {
  const speakerId = transcript.speakerId || transcript.sourceId;
  if (!speakerId) {
    return '';
  }

  return `, ${t('speakerIdValue', 'speaker {{speakerId}}', { speakerId })}`;
}

function splitListInput(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatFactKind(kind: string): string {
  return kind.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatConfidence(confidence: number): string {
  if (!Number.isFinite(confidence)) {
    return 'Review';
  }
  return `${Math.round(confidence * 100)}%`;
}

async function checkHealth(
  livekitUrl: string,
  tokenEndpoint: string,
  setHealth: React.Dispatch<React.SetStateAction<ServiceHealth>>,
) {
  setHealth(checkingHealth());

  const httpLivekit = livekitUrl.replace(/^ws/, 'http');

  try {
    const res = await fetch(resolveTokenServerPath(tokenEndpoint, '/health'), {
      method: 'GET',
      credentials: 'include',
      signal: AbortSignal.timeout(5000),
    });
    const payload = await res.json().catch(() => null);
    const health = normalizeTokenServerHealth(payload);
    if (!res.ok || !health) {
      throw new Error('Token server health response was not available');
    }

    setHealth(health);
    return;
  } catch {
    setHealth((h) => ({
      ...h,
      tokenServer: 'error',
      agent: 'pending',
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

export default VoicePanel;
