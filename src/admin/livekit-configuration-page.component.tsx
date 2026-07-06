import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Tag, Tile } from '@carbon/react';
import { Renew } from '@carbon/icons-react';
import { useConfig } from '@openmrs/esm-framework';
import { useTranslation } from 'react-i18next';
import type { Config } from '../config-schema';
import {
  checkingHealth,
  fetchServiceHealth,
  initialHealth,
  type ServiceHealth,
} from '../livekit/agent-health';
import { resolveLivekitOperationalConfig } from '../livekit/livekit-config';
import {
  fetchOpenmrsDraftAudit,
  fetchOpenmrsDraftWriteConfig,
  type OpenmrsDraftAuditEvent,
  type OpenmrsDraftAuditResponse,
  type OpenmrsDraftConfigResource,
  type OpenmrsDraftWriteConfig,
} from '../livekit/livekit-token';
import PrivacyServiceHealth from '../livekit/privacy-service-health.component';
import styles from './livekit-admin.scss';

const LivekitConfigurationPage: React.FC = () => {
  const { t } = useTranslation();
  const tRef = useRef(t);
  const config = useConfig<Config>();
  const operationalConfig = useMemo(() => resolveLivekitOperationalConfig(config), [config]);
  const [health, setHealth] = useState<ServiceHealth>(initialHealth);
  const [draftConfig, setDraftConfig] = useState<OpenmrsDraftWriteConfig | null>(null);
  const [draftAudit, setDraftAudit] = useState<OpenmrsDraftAuditResponse | null>(null);
  const [draftAdminLoading, setDraftAdminLoading] = useState(false);
  const [draftAdminError, setDraftAdminError] = useState<string | null>(null);
  const draftAdminRequestId = useRef(0);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const refreshDraftAdminState = useCallback(async () => {
    const translate = tRef.current;
    const requestId = draftAdminRequestId.current + 1;
    draftAdminRequestId.current = requestId;
    setDraftAdminLoading(true);
    setDraftAdminError(null);
    const [configResult, auditResult] = await Promise.allSettled([
      fetchOpenmrsDraftWriteConfig(operationalConfig.tokenEndpoint),
      fetchOpenmrsDraftAudit(operationalConfig.tokenEndpoint, 20),
    ]);
    if (draftAdminRequestId.current !== requestId) {
      return;
    }

    const errors: string[] = [];
    if (configResult.status === 'fulfilled') {
      setDraftConfig(configResult.value);
    } else {
      setDraftConfig(null);
      errors.push(
        errorMessage(
          configResult.reason,
          translate('draftConfigLoadFailed', 'Could not load draft write configuration.'),
        ),
      );
    }

    if (auditResult.status === 'fulfilled') {
      setDraftAudit(auditResult.value);
    } else {
      setDraftAudit(null);
      errors.push(
        errorMessage(auditResult.reason, translate('draftAuditLoadFailed', 'Could not load draft audit.')),
      );
    }

    if (errors.length) {
      setDraftAdminError(errors.join(' '));
    }
    setDraftAdminLoading(false);
  }, [operationalConfig.tokenEndpoint]);

  useEffect(() => {
    let cancelled = false;
    setHealth(checkingHealth());
    fetchServiceHealth(operationalConfig.livekitServerUrl, operationalConfig.tokenEndpoint)
      .then((nextHealth) => {
        if (!cancelled) {
          setHealth(nextHealth);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHealth((currentHealth) => ({ ...currentHealth, tokenServer: 'error' }));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [operationalConfig.livekitServerUrl, operationalConfig.tokenEndpoint]);

  useEffect(() => {
    refreshDraftAdminState();
    return () => {
      draftAdminRequestId.current += 1;
    };
  }, [refreshDraftAdminState]);

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <p>{t('configurations', 'Configurations')}</p>
        <h1>{t('voiceConsultation', 'Voice consultation')}</h1>
      </header>

      <div className={styles.grid}>
        <Tile className={styles.configTile}>
          <div className={styles.tileHeader}>
            <h2>{t('localAi', 'Local AI')}</h2>
          </div>
          <p className={styles.description}>
            {t(
              'translationFlowDescription',
              'Open a local LiveKit room, then run the doctor-patient translation and OpenMRS draft flow from this workspace.',
            )}
          </p>
          <div className={styles.pipelinePreview}>
            <Tag type="cyan" size="sm">
              {t('localAi', 'Local AI')}
            </Tag>
            <Tag type="cyan" size="sm">
              {t('sourceAttribution', 'Source attribution')}
            </Tag>
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
        </Tile>

        <Tile className={styles.configTile}>
          <div className={styles.tileHeader}>
            <h2>{t('livekitRoom', 'LiveKit room')}</h2>
          </div>
          <dl className={styles.connectionDetails}>
            <div>
              <dt>{t('livekitServer', 'LiveKit')}</dt>
              <dd>{operationalConfig.livekitServerUrl}</dd>
            </div>
            <div>
              <dt>{t('tokenServer', 'Token server')}</dt>
              <dd>{operationalConfig.tokenEndpoint}</dd>
              {operationalConfig.tokenEndpointDisplay !== operationalConfig.tokenEndpoint && (
                <small>{operationalConfig.tokenEndpointDisplay}</small>
              )}
            </div>
            <div>
              <dt>{t('speakerAttribution', 'Speaker attribution')}</dt>
              <dd>{t('sourceRoleWithSttSpeakerId', 'source-role + STT speaker_id')}</dd>
            </div>
            <div>
              <dt>{t('roomPrefix', 'Room prefix')}</dt>
              <dd>{operationalConfig.roomPrefix}</dd>
            </div>
          </dl>
        </Tile>

        <Tile className={`${styles.configTile} ${styles.wideTile}`}>
          <div className={styles.tileHeader}>
            <h2>{t('privacyAndStatus', 'Privacy & service health')}</h2>
          </div>
          <PrivacyServiceHealth health={health} />
        </Tile>

        <Tile className={`${styles.configTile} ${styles.wideTile}`}>
          <div className={styles.tileHeader}>
            <div>
              <h2>{t('openmrsDraftWriteConfiguration', 'OpenMRS draft write configuration')}</h2>
              <p className={styles.description}>
                {t(
                  'openmrsDraftWriteConfigurationDetail',
                  'Minimal validation for the encounter type, location, and draft obs concept used when a reviewed draft is saved to OpenMRS.',
                )}
              </p>
            </div>
            <div className={styles.tileActions}>
              {draftConfig && (
                <Tag type={draftConfigStatusTag(draftConfig.status)}>
                  {draftConfigStatusLabel(draftConfig.status, t)}
                </Tag>
              )}
              <Button
                kind="tertiary"
                size="sm"
                renderIcon={Renew}
                onClick={refreshDraftAdminState}
                disabled={draftAdminLoading}
              >
                {draftAdminLoading
                  ? t('checking', 'Checking...')
                  : t('validateConfiguration', 'Validate configuration')}
              </Button>
            </div>
          </div>

          {draftAdminError && <p className={styles.adminError}>{draftAdminError}</p>}
          {draftConfig?.message && <p className={styles.description}>{draftConfig.message}</p>}

          <div className={styles.validationGrid}>
            <DraftConfigResource
              label={t('encounterType', 'Encounter type')}
              resource={draftConfig?.resources?.encounterType}
              fallbackUuid={draftConfig?.values?.encounterTypeUuid}
            />
            <DraftConfigResource
              label={t('location', 'Location')}
              resource={draftConfig?.resources?.location}
              fallbackUuid={draftConfig?.values?.locationUuid}
            />
            <DraftConfigResource
              label={t('draftObsConcept', 'Draft obs concept')}
              resource={draftConfig?.resources?.draftObsConcept}
              fallbackUuid={draftConfig?.values?.draftObsConceptUuid}
            />
          </div>

          {Boolean(draftConfig?.validationErrors?.length) && (
            <ul className={styles.errorList}>
              {draftConfig?.validationErrors?.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}
        </Tile>

        <Tile className={`${styles.configTile} ${styles.wideTile}`}>
          <div className={styles.tileHeader}>
            <div>
              <h2>{t('draftAudit', 'Draft audit')}</h2>
              <p className={styles.description}>
                {t(
                  'draftAuditDetail',
                  'Recent draft queue/save/rejection events. Clinical draft text and transcripts are intentionally excluded.',
                )}
              </p>
            </div>
            <Button
              kind="tertiary"
              size="sm"
              renderIcon={Renew}
              onClick={refreshDraftAdminState}
              disabled={draftAdminLoading}
            >
              {t('refreshAudit', 'Refresh audit')}
            </Button>
          </div>

          {draftAudit?.events?.length ? (
            <div className={styles.auditList}>
              {draftAudit.events.map((event) => (
                <DraftAuditEvent key={event.id ?? `${event.createdAt}-${event.eventType}`} event={event} />
              ))}
            </div>
          ) : draftAudit ? (
            <p className={styles.description}>{t('noDraftAuditEvents', 'No draft audit events yet.')}</p>
          ) : (
            <p className={styles.description}>
              {draftAdminLoading
                ? t('checking', 'Checking...')
                : t('draftAuditUnavailable', 'Draft audit unavailable.')}
            </p>
          )}
        </Tile>
      </div>
    </main>
  );
};

interface DraftConfigResourceProps {
  label: string;
  resource?: OpenmrsDraftConfigResource;
  fallbackUuid?: string | null;
}

const DraftConfigResource: React.FC<DraftConfigResourceProps> = ({ label, resource, fallbackUuid }) => {
  const { t } = useTranslation();
  const uuid = resource?.uuid || fallbackUuid;
  const display = resource?.display || resource?.name || uuid || t('notConfigured', 'Not configured');
  const tagType = resource?.status === 'ok' ? 'green' : resource?.status === 'invalid' ? 'red' : 'gray';

  return (
    <section className={styles.resourceBlock}>
      <div className={styles.resourceHeader}>
        <h3>{label}</h3>
        <Tag type={tagType} size="sm">
          {resource?.status || 'pending'}
        </Tag>
      </div>
      <p>{display}</p>
      {uuid && <code>{uuid}</code>}
      <div className={styles.resourceMeta}>
        {resource?.datatype && (
          <span>{t('datatypeValue', 'Datatype: {{datatype}}', { datatype: resource.datatype })}</span>
        )}
        {resource?.conceptClass && (
          <span>
            {t('conceptClassValue', 'Class: {{conceptClass}}', { conceptClass: resource.conceptClass })}
          </span>
        )}
        {resource?.retired === true && <span>{t('retired', 'Retired')}</span>}
      </div>
      {resource?.validationErrors?.length ? (
        <ul className={styles.errorList}>
          {resource.validationErrors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
};

const DraftAuditEvent: React.FC<{ event: OpenmrsDraftAuditEvent }> = ({ event }) => {
  const { t } = useTranslation();

  return (
    <article className={styles.auditEvent}>
      <div>
        <strong>{event.eventType || 'draft_event'}</strong>
        <span>{formatAuditTime(event.createdAt)}</span>
      </div>
      <dl>
        <div>
          <dt>{t('openmrsWrite', 'OpenMRS write')}</dt>
          <dd>{event.openmrsWrite || t('unknown', 'Unknown')}</dd>
        </div>
        {event.encounterUuid && (
          <div>
            <dt>{t('encounterUuid', 'Encounter UUID')}</dt>
            <dd>{event.encounterUuid}</dd>
          </div>
        )}
        {event.message && (
          <div>
            <dt>{t('message', 'Message')}</dt>
            <dd>{event.message}</dd>
          </div>
        )}
        <div>
          <dt>{t('rawClinicalTextStored', 'Raw clinical text stored')}</dt>
          <dd>{event.rawClinicalTextStored ? t('yes', 'Yes') : t('no', 'No')}</dd>
        </div>
      </dl>
    </article>
  );
};

function draftConfigStatusTag(status: OpenmrsDraftWriteConfig['status']) {
  if (status === 'validated') {
    return 'green';
  }
  if (status === 'invalid' || status === 'auth_required' || status === 'error') {
    return 'red';
  }
  if (status === 'not_configured') {
    return 'purple';
  }
  return 'gray';
}

function draftConfigStatusLabel(
  status: OpenmrsDraftWriteConfig['status'],
  t: ReturnType<typeof useTranslation>['t'],
) {
  const labels: Record<OpenmrsDraftWriteConfig['status'], string> = {
    validated: t('validated', 'Validated'),
    invalid: t('invalidConfiguration', 'Invalid configuration'),
    not_configured: t('needsConfiguration', 'Needs configuration'),
    auth_required: t('authRequired', 'Auth required'),
    disabled: t('disabled', 'Disabled'),
    error: t('error', 'Error'),
  };
  return labels[status] || status;
}

function formatAuditTime(createdAt?: number): string {
  if (!createdAt) {
    return '';
  }
  return new Date(createdAt * 1000).toLocaleString();
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default LivekitConfigurationPage;
