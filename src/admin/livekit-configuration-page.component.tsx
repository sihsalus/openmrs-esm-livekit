import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Tab, TabList, TabPanel, TabPanels, Tabs, Tag, Tile } from '@carbon/react';
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
  fetchAiRuntimeConfig,
  fetchOpenmrsDraftAudit,
  fetchOpenmrsDraftWriteConfig,
  saveAiRuntimeConfig,
  type AiRuntimeConfig,
  type AiRuntimeProviderOption,
  type AiRuntimeConfigResponse,
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
  const [aiRuntime, setAiRuntime] = useState<AiRuntimeConfigResponse | null>(null);
  const [aiRuntimeDraft, setAiRuntimeDraft] = useState<AiRuntimeConfig | null>(null);
  const [aiRuntimeLoading, setAiRuntimeLoading] = useState(false);
  const [aiRuntimeSaving, setAiRuntimeSaving] = useState(false);
  const [aiRuntimeError, setAiRuntimeError] = useState<string | null>(null);
  const draftAdminRequestId = useRef(0);
  const aiRuntimeRequestId = useRef(0);

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

  const refreshAiRuntimeConfig = useCallback(async () => {
    const translate = tRef.current;
    const requestId = aiRuntimeRequestId.current + 1;
    aiRuntimeRequestId.current = requestId;
    setAiRuntimeLoading(true);
    setAiRuntimeError(null);
    try {
      const response = await fetchAiRuntimeConfig(operationalConfig.tokenEndpoint);
      if (aiRuntimeRequestId.current !== requestId) {
        return;
      }
      setAiRuntime(response);
      setAiRuntimeDraft(response.config);
    } catch (error) {
      if (aiRuntimeRequestId.current !== requestId) {
        return;
      }
      setAiRuntime(null);
      setAiRuntimeDraft(null);
      setAiRuntimeError(
        errorMessage(
          error,
          translate('aiRuntimeConfigLoadFailed', 'Could not load AI runtime configuration.'),
        ),
      );
    } finally {
      if (aiRuntimeRequestId.current === requestId) {
        setAiRuntimeLoading(false);
      }
    }
  }, [operationalConfig.tokenEndpoint]);

  const updateAiRuntimeDraft = useCallback(
    <K extends keyof AiRuntimeConfig>(key: K, value: AiRuntimeConfig[K]) => {
      setAiRuntimeDraft((current) => {
        if (!current) {
          return current;
        }
        const next = { ...current, [key]: value };
        if (key === 'deepgramUseFlux' && value === true) {
          next.deepgramEnableDiarization = false;
        }
        if (key === 'deepgramEnableDiarization' && value === true) {
          next.deepgramUseFlux = false;
        }
        return next;
      });
    },
    [],
  );

  const persistAiRuntimeConfig = useCallback(async () => {
    if (!aiRuntimeDraft) {
      return;
    }
    const translate = tRef.current;
    setAiRuntimeSaving(true);
    setAiRuntimeError(null);
    try {
      const response = await saveAiRuntimeConfig(operationalConfig.tokenEndpoint, aiRuntimeDraft);
      setAiRuntime(response);
      setAiRuntimeDraft(response.config);
    } catch (error) {
      setAiRuntimeError(
        errorMessage(
          error,
          translate('aiRuntimeConfigSaveFailed', 'Could not save AI runtime configuration.'),
        ),
      );
    } finally {
      setAiRuntimeSaving(false);
    }
  }, [aiRuntimeDraft, operationalConfig.tokenEndpoint]);

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

  useEffect(() => {
    refreshAiRuntimeConfig();
    return () => {
      aiRuntimeRequestId.current += 1;
    };
  }, [refreshAiRuntimeConfig]);

  const displayedRuntimeConfig = aiRuntimeDraft ?? aiRuntime?.effectiveConfig ?? aiRuntime?.config ?? null;
  const runtimeModeTag = aiRuntimeModeTag(aiRuntime, displayedRuntimeConfig, t);
  const sttProviderTag = sttRuntimeTag(displayedRuntimeConfig, t);
  const ttsProviderTag = ttsRuntimeTag(displayedRuntimeConfig, t);
  const attributionTag = attributionRuntimeTag(displayedRuntimeConfig, t);

  return (
    <main className={`omrs-main-content ${styles.page}`}>
      <header className={styles.pageHeader}>
        <p>{t('configurations', 'Configurations')}</p>
        <h1>{t('voiceConsultation', 'Voice consultation')}</h1>
      </header>

      <Tabs>
        <TabList
          aria-label={t('livekitConfigurationTabs', 'LiveKit configuration tabs')}
          className={styles.tabList}
          contained
        >
          <Tab>{t('overview', 'Overview')}</Tab>
          <Tab>{t('serviceHealth', 'Service health')}</Tab>
          <Tab>{t('drafts', 'Drafts')}</Tab>
        </TabList>
        <TabPanels>
          <TabPanel className={styles.tabPanel}>
            <div className={styles.grid}>
              <Tile className={`${styles.configTile} ${styles.wideTile}`}>
                <div className={styles.tileHeader}>
                  <div>
                    <h2>{t('localAi', 'Local AI')}</h2>
                    <p className={styles.description}>
                      {t(
                        'aiRuntimeConfigDetail',
                        'Local providers stay the default; cloud providers are selected per new LiveKit room when configured.',
                      )}
                    </p>
                  </div>
                  <div className={styles.tileActions}>
                    <Tag type={runtimeModeTag.type} size="sm">
                      {runtimeModeTag.label}
                    </Tag>
                    <Button
                      kind="tertiary"
                      size="sm"
                      renderIcon={Renew}
                      onClick={refreshAiRuntimeConfig}
                      disabled={aiRuntimeLoading || aiRuntimeSaving}
                    >
                      {aiRuntimeLoading ? t('checking', 'Checking...') : t('refresh', 'Refresh')}
                    </Button>
                  </div>
                </div>
                {aiRuntimeError && <p className={styles.adminError}>{aiRuntimeError}</p>}
                {Boolean(aiRuntime?.warnings?.length) && (
                  <ul className={styles.errorList}>
                    {aiRuntime?.warnings?.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                )}
                {aiRuntimeDraft ? (
                  <div className={styles.runtimeForm}>
                    <label>
                      <span>{t('sttProvider', 'STT provider')}</span>
                      <select
                        value={aiRuntimeDraft.sttProvider}
                        onChange={(event) =>
                          updateAiRuntimeDraft(
                            'sttProvider',
                            event.currentTarget.value as AiRuntimeConfig['sttProvider'],
                          )
                        }
                      >
                        {aiRuntimeProviderOptions(aiRuntime, 'stt').map((provider) => (
                          <option key={provider.id} value={provider.id}>
                            {providerOptionLabel(provider, t)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>{t('deepgramModel', 'Deepgram model')}</span>
                      <input
                        value={aiRuntimeDraft.deepgramModel}
                        onChange={(event) => updateAiRuntimeDraft('deepgramModel', event.currentTarget.value)}
                        disabled={aiRuntimeDraft.sttProvider !== 'deepgram'}
                      />
                    </label>
                    <label className={styles.checkboxRow}>
                      <input
                        type="checkbox"
                        checked={aiRuntimeDraft.deepgramEnableDiarization}
                        onChange={(event) =>
                          updateAiRuntimeDraft('deepgramEnableDiarization', event.currentTarget.checked)
                        }
                        disabled={aiRuntimeDraft.sttProvider !== 'deepgram'}
                      />
                      <span>{t('deepgramDiarization', 'Deepgram diarization')}</span>
                    </label>
                    <label className={styles.checkboxRow}>
                      <input
                        type="checkbox"
                        checked={aiRuntimeDraft.deepgramUseFlux}
                        onChange={(event) =>
                          updateAiRuntimeDraft('deepgramUseFlux', event.currentTarget.checked)
                        }
                        disabled={aiRuntimeDraft.sttProvider !== 'deepgram'}
                      />
                      <span>{t('deepgramFlux', 'Deepgram Flux')}</span>
                    </label>
                    {aiRuntimeDraft.sttProvider === 'deepgram' && (
                      <p className={styles.runtimeHint}>
                        {aiRuntimeDraft.deepgramUseFlux
                          ? t(
                              'deepgramFluxNoDiarization',
                              'Flux uses endpointing without speaker IDs in this agent.',
                            )
                          : t(
                              'deepgramDiarizationKeepsFluxOff',
                              'Diarization keeps Flux off so STT speaker IDs can be used.',
                            )}
                      </p>
                    )}
                    <label>
                      <span>{t('ttsProvider', 'TTS provider')}</span>
                      <select
                        value={aiRuntimeDraft.ttsProvider}
                        onChange={(event) =>
                          updateAiRuntimeDraft(
                            'ttsProvider',
                            event.currentTarget.value as AiRuntimeConfig['ttsProvider'],
                          )
                        }
                      >
                        {aiRuntimeProviderOptions(aiRuntime, 'tts').map((provider) => (
                          <option key={provider.id} value={provider.id}>
                            {providerOptionLabel(provider, t)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>{t('inworldModel', 'Inworld model')}</span>
                      <input
                        value={aiRuntimeDraft.inworldModel}
                        onChange={(event) => updateAiRuntimeDraft('inworldModel', event.currentTarget.value)}
                        disabled={aiRuntimeDraft.ttsProvider !== 'inworld'}
                      />
                    </label>
                    <div className={styles.runtimeActions}>
                      <Tag type={aiRuntimeDraft.sttProvider === 'deepgram' ? 'purple' : 'cyan'} size="sm">
                        {aiRuntimeDraft.sttProvider === 'deepgram'
                          ? t('cloudStt', 'Cloud STT')
                          : t('localStt', 'Local STT')}
                      </Tag>
                      <Tag type={aiRuntimeDraft.ttsProvider === 'inworld' ? 'purple' : 'green'} size="sm">
                        {aiRuntimeDraft.ttsProvider === 'inworld'
                          ? t('cloudTts', 'Cloud TTS')
                          : t('localTts', 'Local TTS')}
                      </Tag>
                      <Button
                        kind="primary"
                        size="sm"
                        onClick={persistAiRuntimeConfig}
                        disabled={aiRuntimeSaving || aiRuntimeLoading}
                      >
                        {aiRuntimeSaving ? t('saving', 'Saving...') : t('saveProviderConfig', 'Save')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className={styles.description}>
                    {aiRuntimeLoading
                      ? t('checking', 'Checking...')
                      : t('aiRuntimeConfigUnavailable', 'AI runtime configuration unavailable.')}
                  </p>
                )}
                <div className={styles.pipelinePreview}>
                  <Tag type={runtimeModeTag.type} size="sm">
                    {runtimeModeTag.label}
                  </Tag>
                  <Tag type={attributionTag.type} size="sm">
                    {attributionTag.label}
                  </Tag>
                  <Tag type="blue" size="sm">
                    {t('livekitAudio', 'LiveKit audio')}
                  </Tag>
                  <Tag type={sttProviderTag.type} size="sm">
                    {sttProviderTag.label}
                  </Tag>
                  <Tag type="cyan" size="sm">
                    {t('clinicalTranslation', 'Clinical translation')}
                  </Tag>
                  <Tag type={ttsProviderTag.type} size="sm">
                    {ttsProviderTag.label}
                  </Tag>
                  <Tag type="gray" size="sm">
                    {t('openmrsDraft', 'OpenMRS draft')}
                  </Tag>
                </div>
              </Tile>

              <Tile className={`${styles.configTile} ${styles.wideTile}`}>
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
                    <dd>{attributionTag.label}</dd>
                  </div>
                  <div>
                    <dt>{t('roomPrefix', 'Room prefix')}</dt>
                    <dd>{operationalConfig.roomPrefix}</dd>
                  </div>
                </dl>
              </Tile>
            </div>
          </TabPanel>

          <TabPanel className={styles.tabPanel}>
            <div className={styles.grid}>
              <Tile className={`${styles.configTile} ${styles.wideTile}`}>
                <div className={styles.tileHeader}>
                  <h2>{t('privacyAndStatus', 'Privacy & service health')}</h2>
                </div>
                <PrivacyServiceHealth health={health} />
              </Tile>
            </div>
          </TabPanel>

          <TabPanel className={styles.tabPanel}>
            <div className={styles.grid}>
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
                      <DraftAuditEvent
                        key={event.id ?? `${event.createdAt}-${event.eventType}`}
                        event={event}
                      />
                    ))}
                  </div>
                ) : draftAudit ? (
                  <p className={styles.description}>
                    {t('noDraftAuditEvents', 'No draft audit events yet.')}
                  </p>
                ) : (
                  <p className={styles.description}>
                    {draftAdminLoading
                      ? t('checking', 'Checking...')
                      : t('draftAuditUnavailable', 'Draft audit unavailable.')}
                  </p>
                )}
              </Tile>
            </div>
          </TabPanel>
        </TabPanels>
      </Tabs>
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

function aiRuntimeProviderOptions(
  response: AiRuntimeConfigResponse | null,
  kind: 'stt' | 'tts',
): AiRuntimeProviderOption[] {
  const configured = response?.providers?.[kind];
  if (configured?.length) {
    return configured;
  }
  return kind === 'stt'
    ? [
        {
          id: 'whisper',
          label: 'Local Whisper',
          locality: 'local',
          configured: true,
          supportsDiarization: false,
        },
        {
          id: 'deepgram',
          label: 'Deepgram Nova',
          locality: 'cloud',
          configured: false,
          supportsDiarization: true,
        },
      ]
    : [
        { id: 'piper', label: 'Local Piper', locality: 'local', configured: true },
        { id: 'inworld', label: 'Inworld TTS', locality: 'cloud', configured: false },
      ];
}

function providerOptionLabel(
  provider: AiRuntimeProviderOption,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  const locality = provider.locality === 'cloud' ? t('cloud', 'Cloud') : t('local', 'Local');
  const configured = provider.configured ? '' : ` (${t('notConfigured', 'Not configured')})`;
  return `${provider.label} - ${locality}${configured}`;
}

type RuntimeTagType = 'red' | 'green' | 'purple' | 'cyan' | 'blue' | 'gray';

interface RuntimeTagSummary {
  type: RuntimeTagType;
  label: string;
}

function aiRuntimeModeTag(
  response: AiRuntimeConfigResponse | null,
  config: AiRuntimeConfig | null,
  t: ReturnType<typeof useTranslation>['t'],
): RuntimeTagSummary {
  if (response?.status === 'invalid') {
    return { type: 'red', label: t('invalidConfiguration', 'Invalid configuration') };
  }
  if (!config) {
    return { type: 'gray', label: t('checking', 'Checking...') };
  }
  const cloudStt = config.sttProvider === 'deepgram';
  const cloudTts = config.ttsProvider === 'inworld';
  if (cloudStt && cloudTts) {
    return { type: 'purple', label: t('cloudSttTtsActive', 'Cloud STT + TTS active') };
  }
  if (cloudStt) {
    return { type: 'purple', label: t('cloudSttActive', 'Cloud STT active') };
  }
  if (cloudTts) {
    return { type: 'purple', label: t('cloudTtsActive', 'Cloud TTS active') };
  }
  return { type: 'green', label: t('localFirst', 'Local first') };
}

function sttRuntimeTag(
  config: AiRuntimeConfig | null,
  t: ReturnType<typeof useTranslation>['t'],
): RuntimeTagSummary {
  if (!config) {
    return { type: 'gray', label: t('sttPending', 'STT pending') };
  }
  if (config.sttProvider === 'deepgram') {
    return {
      type: 'purple',
      label: config.deepgramUseFlux
        ? t('deepgramFluxStt', 'Deepgram Flux STT')
        : t('deepgramStt', 'Deepgram STT'),
    };
  }
  return { type: 'cyan', label: t('whisperStt', 'Whisper STT') };
}

function ttsRuntimeTag(
  config: AiRuntimeConfig | null,
  t: ReturnType<typeof useTranslation>['t'],
): RuntimeTagSummary {
  if (!config) {
    return { type: 'gray', label: t('ttsPending', 'TTS pending') };
  }
  if (config.ttsProvider === 'inworld') {
    return { type: 'purple', label: t('inworldTts', 'Inworld TTS') };
  }
  return { type: 'green', label: t('piperTts', 'Piper TTS') };
}

function attributionRuntimeTag(
  config: AiRuntimeConfig | null,
  t: ReturnType<typeof useTranslation>['t'],
): RuntimeTagSummary {
  if (!config) {
    return { type: 'gray', label: t('attributionPending', 'Attribution pending') };
  }
  if (config.sttProvider === 'deepgram' && config.deepgramEnableDiarization && !config.deepgramUseFlux) {
    return { type: 'purple', label: t('sttSpeakerIds', 'STT speaker IDs') };
  }
  return { type: 'cyan', label: t('sourceRoleFallback', 'Source-role fallback') };
}

export default LivekitConfigurationPage;
