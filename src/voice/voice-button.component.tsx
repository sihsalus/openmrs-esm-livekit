import React, { useCallback, useRef, useState } from 'react';
import { Button } from '@carbon/react';
import { Microphone } from '@carbon/icons-react';
import { useTranslation } from 'react-i18next';
import { showModal, usePatient, useVisit } from '@openmrs/esm-framework';
import styles from './voice-button.scss';

const VoiceButton: React.FC = () => {
  const { t } = useTranslation();
  const { patient, isLoading: patientLoading } = usePatient();
  const patientUuid = patient?.id ?? '';
  const { activeVisit, isLoading: activeVisitLoading, mutate: mutateVisit } = useVisit(patientUuid);
  const [active, setActive] = useState(false);
  const closeModalRef = useRef<(() => void) | null>(null);

  const openVoiceModal = useCallback(() => {
    closeModalRef.current?.();
    setActive(true);
    closeModalRef.current = showModal('livekit-voice-modal', { size: 'lg' }, () => {
      closeModalRef.current = null;
      setActive(false);
    });
  }, []);

  const openStartVisitPrompt = useCallback(() => {
    let closeStartVisitPrompt: (() => void) | null = null;
    closeStartVisitPrompt = showModal('start-visit-dialog', {
      patientUuid,
      closeModal: () => closeStartVisitPrompt?.(),
      onVisitStarted: () => {
        mutateVisit();
        openVoiceModal();
      },
    });
  }, [mutateVisit, openVoiceModal, patientUuid]);

  const handleClick = useCallback(() => {
    if (activeVisit?.uuid) {
      openVoiceModal();
      return;
    }

    openStartVisitPrompt();
  }, [activeVisit?.uuid, openStartVisitPrompt, openVoiceModal]);

  return (
    <Button
      className={styles.actionButton}
      kind={active ? 'tertiary' : 'ghost'}
      size="md"
      renderIcon={Microphone}
      onClick={handleClick}
      disabled={patientLoading || activeVisitLoading || !patientUuid}
    >
      {t('voiceConsultation', 'Voice consultation')}
    </Button>
  );
};

export default VoiceButton;
