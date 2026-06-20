import React from 'react';
import { ModalBody, ModalHeader } from '@carbon/react';
import { useTranslation } from 'react-i18next';
import VoicePanel from './voice-panel.component';
import styles from './voice-panel.scss';

interface VoiceModalProps {
  close?: () => void;
}

const VoiceModal: React.FC<VoiceModalProps> = ({ close }) => {
  const { t } = useTranslation();

  return (
    <>
      <ModalHeader closeModal={close} title={t('voiceConsultation', 'Voice consultation')} />
      <ModalBody>
        <div className={styles.modalContent}>
          <VoicePanel onClose={close} />
        </div>
      </ModalBody>
    </>
  );
};

export default VoiceModal;
