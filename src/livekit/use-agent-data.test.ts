import { describe, expect, it } from 'vitest';
import {
  agentDataTopic,
  isAgentDataTopic,
  isAgentParticipant,
  parseAgentDataPayload,
  roomHasAgentParticipant,
} from './use-agent-data';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe('parseAgentDataPayload', () => {
  it('accepts only the agent data-channel topic', () => {
    expect(isAgentDataTopic(agentDataTopic)).toBe(true);
    expect(isAgentDataTopic('chat')).toBe(false);
    expect(isAgentDataTopic(undefined)).toBe(false);
  });

  it('detects LiveKit agent participants from SDK metadata and stable identity fallbacks', () => {
    expect(isAgentParticipant({ identity: 'worker-1', isAgent: true })).toBe(true);
    expect(isAgentParticipant({ identity: 'clinical' })).toBe(true);
    expect(isAgentParticipant({ identity: 'agent-openmrs-voice' })).toBe(true);
    expect(isAgentParticipant({ identity: 'clinician-123', isAgent: false })).toBe(false);
  });

  it('detects when a room has a connected agent participant', () => {
    expect(roomHasAgentParticipant([{ identity: 'clinician-123' }, { identity: 'agent-456' }])).toBe(true);
    expect(roomHasAgentParticipant([{ identity: 'clinician-123' }])).toBe(false);
  });

  it('accepts assistant transcripts and fills a missing timestamp', () => {
    expect(
      parseAgentDataPayload(
        encode({
          type: 'transcript',
          payload: {
            role: 'assistant',
            language: 'en',
            text: 'Draft is ready for review.',
            redacted: 'Draft is ready for review.',
          },
        }),
        () => 12345,
      ),
    ).toEqual({
      type: 'transcript',
      transcript: {
        role: 'assistant',
        language: 'en',
        text: 'Draft is ready for review.',
        redacted: 'Draft is ready for review.',
        timestamp: 12345,
      },
    });
  });

  it('normalizes translation messages into transcript entries', () => {
    expect(
      parseAgentDataPayload(
        encode({
          type: 'translation',
          payload: {
            role: 'patient',
            language: 'es',
            text: 'Medication review is needed.',
            timestamp: 987,
            sourceLanguage: 'en',
          },
        }),
      ),
    ).toEqual({
      type: 'transcript',
      transcript: {
        role: 'patient',
        language: 'es',
        text: 'Medication review is needed.',
        timestamp: 987,
        sourceLanguage: 'en',
      },
    });
  });

  it('accepts transcript attribution metadata from the agent', () => {
    expect(
      parseAgentDataPayload(
        encode({
          type: 'transcript',
          payload: {
            role: 'patient',
            language: 'es',
            text: 'Me duele el pecho.',
            redacted: 'Me duele el pecho.',
            speakerId: 'speaker-1',
            sourceId: 'speaker-1',
            attributionMode: 'stt-speaker-id',
            attributionSource: 'dynamic-speaker-map',
            attributionConfidence: 0.72,
          },
        }),
        () => 12345,
      ),
    ).toEqual({
      type: 'transcript',
      transcript: {
        role: 'patient',
        language: 'es',
        text: 'Me duele el pecho.',
        redacted: 'Me duele el pecho.',
        speakerId: 'speaker-1',
        sourceId: 'speaker-1',
        attributionMode: 'stt-speaker-id',
        attributionSource: 'dynamic-speaker-map',
        attributionConfidence: 0.72,
        timestamp: 12345,
      },
    });
  });

  it('accepts structured drafts and status messages', () => {
    expect(
      parseAgentDataPayload(
        encode({
          type: 'draft',
          payload: {
            chiefComplaint: 'Cough',
            symptoms: ['cough'],
            medicationsMentioned: [],
            allergiesMentioned: [],
            assessmentNotes: 'Needs clinician review.',
            patientInstructions: 'Return if symptoms worsen.',
          },
        }),
      ),
    ).toMatchObject({
      type: 'draft',
      draft: {
        chiefComplaint: 'Cough',
        symptoms: ['cough'],
      },
    });

    expect(parseAgentDataPayload(encode({ type: 'status', payload: { step: 'Listening' } }))).toEqual({
      type: 'status',
      status: 'Listening',
    });
  });

  it('accepts agent readiness status payloads from the LiveKit agent', () => {
    expect(
      parseAgentDataPayload(
        encode({
          type: 'status',
          payload: {
            step: 'agent_listening',
            message: 'Agent is listening for clinical conversation.',
          },
        }),
      ),
    ).toEqual({
      type: 'status',
      status: 'Agent is listening for clinical conversation.',
    });
  });

  it('accepts the real agent draft payload emitted after a clinical fact is recorded', () => {
    expect(
      parseAgentDataPayload(
        encode({
          type: 'draft',
          payload: {
            patientUuid: 'patient-uuid',
            chiefComplaint: 'Persistent cough',
            symptoms: ['Persistent cough'],
            medicationsMentioned: ['Paracetamol'],
            allergiesMentioned: ['No known drug allergies'],
            assessmentNotes:
              'diagnosis: Clinician suspects viral upper respiratory infection\nClinician review required before saving to OpenMRS.',
            patientInstructions: 'No patient instructions recorded. Clinician review required.',
            facts: [
              {
                kind: 'chief_complaint',
                value: 'Persistent cough',
                confidence: 0.96,
                status: 'detected',
                needsReview: true,
              },
            ],
            reviewQueue: [
              {
                kind: 'chief_complaint',
                value: 'Persistent cough',
                confidence: 0.96,
                status: 'detected',
                needsReview: true,
              },
            ],
            missingFields: [],
            clinicianReviewRequired: true,
          },
        }),
      ),
    ).toEqual({
      type: 'draft',
      draft: {
        patientUuid: 'patient-uuid',
        chiefComplaint: 'Persistent cough',
        symptoms: ['Persistent cough'],
        medicationsMentioned: ['Paracetamol'],
        allergiesMentioned: ['No known drug allergies'],
        assessmentNotes:
          'diagnosis: Clinician suspects viral upper respiratory infection\nClinician review required before saving to OpenMRS.',
        patientInstructions: 'No patient instructions recorded. Clinician review required.',
        facts: [
          {
            kind: 'chief_complaint',
            value: 'Persistent cough',
            confidence: 0.96,
            status: 'detected',
            needsReview: true,
          },
        ],
        reviewQueue: [
          {
            kind: 'chief_complaint',
            value: 'Persistent cough',
            confidence: 0.96,
            status: 'detected',
            needsReview: true,
          },
        ],
        missingFields: [],
        clinicianReviewRequired: true,
      },
    });
  });

  it('ignores malformed JSON and invalid transcript payloads', () => {
    expect(parseAgentDataPayload(new TextEncoder().encode('{'))).toBeNull();
    expect(
      parseAgentDataPayload(
        encode({
          type: 'transcript',
          payload: {
            role: 'nurse',
            language: 'en',
            text: 'Invalid role',
          },
        }),
      ),
    ).toBeNull();
  });

  it('rejects drafts with malformed review metadata', () => {
    expect(
      parseAgentDataPayload(
        encode({
          type: 'draft',
          payload: {
            chiefComplaint: 'Cough',
            symptoms: ['cough'],
            medicationsMentioned: [],
            allergiesMentioned: [],
            assessmentNotes: 'Needs clinician review.',
            patientInstructions: 'Return if symptoms worsen.',
            reviewQueue: [{ kind: 'symptom', value: 'cough', confidence: 'high', status: 'detected' }],
          },
        }),
      ),
    ).toBeNull();

    expect(
      parseAgentDataPayload(
        encode({
          type: 'draft',
          payload: {
            chiefComplaint: 'Cough',
            symptoms: ['cough'],
            medicationsMentioned: [],
            allergiesMentioned: [],
            assessmentNotes: 'Needs clinician review.',
            patientInstructions: 'Return if symptoms worsen.',
            missingFields: ['oxygen saturation', 42],
          },
        }),
      ),
    ).toBeNull();
  });
});
