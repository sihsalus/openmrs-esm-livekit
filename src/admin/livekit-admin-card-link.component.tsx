import React from 'react';
import { ClickableTile, Layer } from '@carbon/react';
import { ArrowRight } from '@carbon/icons-react';
import { useTranslation } from 'react-i18next';
import styles from './livekit-admin.scss';

function getLivekitConfigurationUrl(): string {
  const spaBase = window.getOpenmrsSpaBase?.() ?? `${window.spaBase.replace(/\/?$/, '/')}`;
  return `${spaBase.replace(/\/?$/, '/')}livekit-configuration`;
}

const LivekitAdminCardLink: React.FC = () => {
  const { t } = useTranslation();

  return (
    <Layer>
      <a
        className={styles.cardLink}
        href={getLivekitConfigurationUrl()}
        target="_blank"
        rel="noopener noreferrer"
      >
        <ClickableTile className={styles.overviewCard}>
          <div>
            <div className={styles.heading}>{t('manageVoiceConsultation', 'Manage voice consultation')}</div>
            <div className={styles.content}>{t('livekitAiConfiguration', 'LiveKit AI configuration')}</div>
          </div>
          <div className={styles.iconWrapper}>
            <ArrowRight size={16} />
          </div>
        </ClickableTile>
      </a>
    </Layer>
  );
};

export default LivekitAdminCardLink;
