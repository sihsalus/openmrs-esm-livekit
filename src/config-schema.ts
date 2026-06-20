import { Type } from '@openmrs/esm-framework';

export const configSchema = {
  livekitServerUrl: {
    _type: Type.String,
    _default: '',
    _description:
      'LiveKit server WebSocket URL. Leave blank to derive ws(s)://<current browser host>:7880.',
  },
  tokenEndpoint: {
    _type: Type.String,
    _default: '',
    _description:
      'Endpoint to obtain a LiveKit room token. Leave blank to derive http(s)://<current browser host>:7890/token.',
  },
  roomPrefix: {
    _type: Type.String,
    _default: 'iot-device-',
    _description: 'LiveKit room prefix. The local OpenMRS LiveKit agent currently joins only rooms with this prefix.',
  },
};

export type Config = {
  livekitServerUrl: string;
  tokenEndpoint: string;
  roomPrefix: string;
};
