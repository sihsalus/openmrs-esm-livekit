import React, { useCallback, useState } from 'react';
import { Button } from '@carbon/react';
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
    <Button kind={active ? 'danger--ghost' : 'ghost'} size="sm" renderIcon={Microphone} onClick={handleClick}>
      {active ? t('consultationOpen', 'Consultation open') : t('voiceConsultation', 'Voice consultation')}
    </Button>
  );
};

export default VoiceButton;
