import { Type } from '@openmrs/esm-framework';

export const configSchema = {
  livekitServerUrl: {
    _type: Type.String,
    _default: 'ws://localhost:7880',
    _description: 'LiveKit server WebSocket URL.',
  },
  tokenEndpoint: {
    _type: Type.String,
    _default: 'http://localhost:7890/token',
    _description: 'Endpoint to obtain a LiveKit room token (POST, JSON body with patientUuid).',
  },
};

export type Config = {
  livekitServerUrl: string;
  tokenEndpoint: string;
};
