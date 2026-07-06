import React, { useEffect, useMemo, useState } from 'react';
import { Tag, Tile } from '@carbon/react';
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
import PrivacyServiceHealth from '../livekit/privacy-service-health.component';
import styles from './livekit-admin.scss';

const LivekitConfigurationPage: React.FC = () => {
  const { t } = useTranslation();
  const config = useConfig<Config>();
  const operationalConfig = useMemo(() => resolveLivekitOperationalConfig(config), [config]);
  const [health, setHealth] = useState<ServiceHealth>(initialHealth);

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
      </div>
    </main>
  );
};

export default LivekitConfigurationPage;
