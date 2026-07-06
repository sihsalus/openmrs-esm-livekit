import React, { useCallback, useState } from 'react';
import { Button, ModalBody, ModalFooter, ModalHeader } from '@carbon/react';
import { Microphone } from '@carbon/icons-react';
import { useTranslation } from 'react-i18next';
import VoicePanel, { type VoicePanelPreflightActions } from './voice-panel.component';
import styles from './voice-panel.scss';

interface VoiceModalProps {
  close?: () => void;
}

const VoiceModal: React.FC<VoiceModalProps> = ({ close }) => {
  const { t } = useTranslation();
  const [preflightActions, setPreflightActions] = useState<VoicePanelPreflightActions | null>(null);
  const closeModal = useCallback(() => close?.(), [close]);

  return (
    <>
      <ModalHeader closeModal={close} title={t('voiceConsultation', 'Voice consultation')} />
      <ModalBody>
        <div className={styles.modalContent}>
          <VoicePanel onClose={close} onPreflightActionsChange={setPreflightActions} />
        </div>
      </ModalBody>
      {preflightActions && (
        <ModalFooter className={styles.modalFooter}>
          <Button kind="danger--ghost" onClick={closeModal}>
            {t('close', 'Close')}
          </Button>
          <Button
            kind="primary"
            renderIcon={Microphone}
            onClick={preflightActions.onStart}
            disabled={preflightActions.startDisabled}
          >
            {preflightActions.startLabel}
          </Button>
        </ModalFooter>
      )}
    </>
  );
};

export default VoiceModal;
