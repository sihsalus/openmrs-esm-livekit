import { describe, expect, it } from 'vitest';
import { parseAgentDataPayload } from './use-agent-data';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe('parseAgentDataPayload', () => {
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
});
