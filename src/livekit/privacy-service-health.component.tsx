import React from 'react';
import { Tag } from '@carbon/react';
import { Security } from '@carbon/icons-react';
import { useTranslation } from 'react-i18next';
import type { ServiceHealth, ServiceStatus } from './agent-health';
import styles from './privacy-service-health.scss';

interface PrivacyServiceHealthProps {
  health: ServiceHealth;
}

const PrivacyServiceHealth: React.FC<PrivacyServiceHealthProps> = ({ health }) => {
  const { t } = useTranslation();
  const aiCapabilityActiveLabel = t('activeViaAgent', 'Active via agent');
  const draftWriteQueuedLabel = t('reviewQueueOnly', 'Review queue');
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
    <div className={styles.wrapper}>
      <div className={styles.privacyPanel}>
        <h2>{t('privacyGuarantees', 'Privacy guarantees')}</h2>
        <ul className={styles.privacyList}>
          <PrivacyItem text={t('rawAudioNotStored', 'Raw audio not stored')} />
          <PrivacyItem text={t('localAiProcessing', 'Local AI processing')} />
          <PrivacyItem text={t('phiRedaction', 'PHI redaction enabled')} />
          <PrivacyItem text={t('clinicianReviewRequired', 'Clinician review required')} />
          <PrivacyItem text={t('offlineCapable', 'Offline-capable architecture')} />
        </ul>
      </div>

      <div className={styles.healthPanel}>
        <h2>{t('serviceHealth', 'Service health')}</h2>
        <div className={styles.healthGroup}>
          <h3>{t('runtimeServices', 'Runtime services')}</h3>
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
              status={health.agent}
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
              detail={t(
                'draftWriteHealthDetail',
                'Encounter write requires configured encounter type, location, draft obs concept, and an active visit. Until then, drafts stay in review queue.',
              )}
              statusText={health.openmrsDraftWrite === 'pending' ? draftWriteQueuedLabel : undefined}
            />
          </ul>
        </div>

        <div className={styles.healthGroup}>
          <h3>{t('localAiCapabilities', 'Local AI capabilities')}</h3>
          <ul className={styles.healthList}>
            <HealthRow
              label="STT"
              status={health.stt}
              detail={sttHealthDetail}
              statusText={
                health.sttSource === 'agent' && health.stt === 'ok' ? aiCapabilityActiveLabel : undefined
              }
            />
            <HealthRow
              label="TTS"
              status={health.tts}
              detail={ttsHealthDetail}
              statusText={
                health.ttsSource === 'agent' && health.tts === 'ok' ? aiCapabilityActiveLabel : undefined
              }
            />
            <HealthRow
              label="LLM"
              status={health.llm}
              detail={llmHealthDetail}
              statusText={
                health.llmSource === 'agent' && health.llm === 'ok' ? aiCapabilityActiveLabel : undefined
              }
            />
          </ul>
        </div>

        <div className={styles.healthGroup}>
          <h3>{t('deploymentReadiness', 'Deployment readiness')}</h3>
          <ul className={styles.healthList}>
            <HealthRow
              label={t('productionGate', 'Production gate')}
              status={health.productionReadiness}
              detail={t('productionGateDetail', 'Rejects unsafe shared deployment config')}
            />
            <HealthRow
              label={t('tokenServerAuth', 'Token server auth')}
              status={health.tokenServerAuth}
              detail={t('tokenServerAuthDetail', 'Requires an authenticated OpenMRS session when enforced')}
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
  );
};

const PrivacyItem: React.FC<{ text: string }> = ({ text }) => (
  <li className={styles.privacyItem}>
    <Security />
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

export default PrivacyServiceHealth;
