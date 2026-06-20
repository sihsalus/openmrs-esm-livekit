import React, { useCallback, useState } from 'react';
import { Button, Tile } from '@carbon/react';
import { Microphone } from '@carbon/icons-react';
import { useTranslation } from 'react-i18next';
import { launchWorkspace } from '@openmrs/esm-framework';

const VoiceButton: React.FC = () => {
  const { t } = useTranslation();
  const [active, setActive] = useState(false);

  const handleClick = useCallback(() => {
    if (active) return;
    setActive(true);
    launchWorkspace('livekit-voice-panel', {
      onClose: () => setActive(false),
    });
  }, [active]);

  return (
    <Tile>
      <div style={{ display: 'grid', gap: '0.75rem' }}>
        <div>
          <h4 style={{ margin: 0 }}>{t('voiceConsultation', 'Voice consultation')}</h4>
          <p style={{ color: 'var(--cds-text-secondary)', margin: '0.25rem 0 0' }}>
            {t('voiceConsultationDescription', 'Start a LiveKit audio room for this patient.')}
          </p>
        </div>
        <Button kind={active ? 'danger' : 'primary'} size="sm" renderIcon={Microphone} onClick={handleClick}>
          {active ? t('consultationOpen', 'Consultation open') : t('startConsultation', 'Start consultation')}
        </Button>
      </div>
    </Tile>
  );
};

export default VoiceButton;
