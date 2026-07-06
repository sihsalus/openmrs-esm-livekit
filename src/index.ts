import { getAsyncLifecycle, defineConfigSchema } from '@openmrs/esm-framework';
import { configSchema } from './config-schema';

const moduleName = '@sihsalus/esm-livekit-app';

const options = {
  featureName: 'livekit-voice',
  moduleName,
};

export const importTranslation = require.context('../translations', false, /.json$/, 'lazy');

export function startupApp() {
  defineConfigSchema(moduleName, configSchema);
}

export const livekitVoiceButton = getAsyncLifecycle(() => import('./voice/voice-button.component'), options);

export const livekitVoicePanel = getAsyncLifecycle(() => import('./voice/voice-panel.component'), options);

export const livekitVoiceModal = getAsyncLifecycle(() => import('./voice/voice-modal.component'), options);

export const livekitAdminCardLink = getAsyncLifecycle(
  () => import('./admin/livekit-admin-card-link.component'),
  options,
);

export const livekitConfigurationPage = getAsyncLifecycle(
  () => import('./admin/livekit-configuration-page.component'),
  options,
);
