import React, { useCallback, useState } from 'react';
import { Button, ModalBody, ModalFooter, ModalHeader } from '@carbon/react';
import { Microphone, Play, Renew } from '@carbon/icons-react';
import { useTranslation } from 'react-i18next';
import VoicePanel, {
  type VoicePanelPreflightActions,
  type VoicePanelSessionActions,
} from './voice-panel.component';
import styles from './voice-panel.scss';

interface VoiceModalProps {
  close?: () => void;
}

const VoiceModal: React.FC<VoiceModalProps> = ({ close }) => {
  const { t } = useTranslation();
  const [preflightActions, setPreflightActions] = useState<VoicePanelPreflightActions | null>(null);
  const [sessionActions, setSessionActions] = useState<VoicePanelSessionActions | null>(null);
  const closeModal = useCallback(() => close?.(), [close]);

  return (
    <>
      <ModalHeader closeModal={close} title={t('voiceConsultation', 'Voice consultation')} />
      <ModalBody>
        <div className={styles.modalContent}>
          <VoicePanel
            onClose={close}
            onPreflightActionsChange={setPreflightActions}
            onSessionActionsChange={setSessionActions}
          />
        </div>
      </ModalBody>
      {preflightActions ? (
        <ModalFooter className={styles.modalFooter}>
          <Button kind="secondary" onClick={closeModal}>
            {t('cancel', 'Cancel')}
          </Button>
          <Button kind="primary" onClick={preflightActions.onStart} disabled={preflightActions.startDisabled}>
            <span className={styles.buttonLabelWithIcon}>
              {preflightActions.startLabel}
              <Microphone size={16} />
            </span>
          </Button>
        </ModalFooter>
      ) : sessionActions ? (
        <ModalFooter className={styles.modalFooter}>
          <Button
            kind="secondary"
            renderIcon={Renew}
            onClick={sessionActions.onResetFlow}
            disabled={sessionActions.demoRunning}
          >
            {t('resetFlow', 'Reset flow')}
          </Button>
          {sessionActions.demoEnabled && (
            <Button
              kind="tertiary"
              renderIcon={Play}
              onClick={sessionActions.onPreviewDemo}
              disabled={sessionActions.demoRunning}
            >
              {sessionActions.demoRunning
                ? t('demoRunning', 'Running demo...')
                : t('previewDemo', 'Preview demo')}
            </Button>
          )}
        </ModalFooter>
      ) : null}
    </>
  );
};

export default VoiceModal;
