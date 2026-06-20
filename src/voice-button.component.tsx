import React, { useCallback, useRef, useState } from 'react';
import { Button } from '@carbon/react';
import { Microphone } from '@carbon/icons-react';
import { useTranslation } from 'react-i18next';
import { showModal } from '@openmrs/esm-framework';
import styles from './voice-button.scss';

const VoiceButton: React.FC = () => {
  const { t } = useTranslation();
  const [active, setActive] = useState(false);
  const closeModalRef = useRef<(() => void) | null>(null);

  const handleClick = useCallback(() => {
    closeModalRef.current?.();
    setActive(true);
    closeModalRef.current = showModal('livekit-voice-modal', { size: 'lg' }, () => {
      closeModalRef.current = null;
      setActive(false);
    });
  }, []);

  return (
    <Button
      className={styles.actionButton}
      kind={active ? 'tertiary' : 'ghost'}
      size="md"
      renderIcon={Microphone}
      onClick={handleClick}
    >
      {t('voiceConsultation', 'Voice consultation')}
    </Button>
  );
};

export default VoiceButton;
