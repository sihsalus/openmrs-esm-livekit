import { useCallback, useEffect, useRef, useState } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { DataPacket_Kind, RoomEvent } from 'livekit-client';

export interface AgentTranscript {
  role: 'doctor' | 'patient' | 'assistant';
  language: string;
  text: string;
  redacted?: string;
  speakerId?: string;
  sourceId?: string;
  attributionMode?: string;
  attributionSource?: string;
  attributionConfidence?: number;
  timestamp: number;
}

export interface AgentClinicalFact {
  kind: string;
  value: string;
  confidence: number;
  status: string;
  needsReview?: boolean;
}

export interface AgentDraft {
  patientUuid?: string | null;
  chiefComplaint: string;
  symptoms: string[];
  medicationsMentioned: string[];
  allergiesMentioned: string[];
  assessmentNotes: string;
  patientInstructions: string;
  facts?: AgentClinicalFact[];
  reviewQueue?: AgentClinicalFact[];
  missingFields?: string[];
  clinicianReviewRequired?: boolean;
}

export interface AgentMessage {
  type: 'transcript' | 'translation' | 'draft' | 'status' | 'error';
  payload: unknown;
}

export type ParsedAgentData =
  | { type: 'transcript'; transcript: AgentTranscript }
  | { type: 'draft'; draft: AgentDraft }
  | { type: 'status'; status: string }
  | { type: 'error'; error: string }
  | null;

export const agentDataTopic = 'agent-data';

const maxTranscripts = 100;

export function useAgentData() {
  const room = useRoomContext();
  const [transcripts, setTranscripts] = useState<AgentTranscript[]>([]);
  const [agentDraft, setAgentDraft] = useState<AgentDraft | null>(null);
  const [agentStatus, setAgentStatus] = useState<string>('');
  const [agentError, setAgentError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const handleData = useCallback(
    (payload: Uint8Array, participant: unknown, kind: DataPacket_Kind, topic?: string) => {
      if (!mounted.current) return;
      if (!isAgentDataTopic(topic)) return;
      const parsed = parseAgentDataPayload(payload);
      if (!parsed) return;

      switch (parsed.type) {
        case 'transcript': {
          setTranscripts((prev) => [...prev.slice(-(maxTranscripts - 1)), parsed.transcript]);
          break;
        }
        case 'draft': {
          setAgentDraft(parsed.draft);
          break;
        }
        case 'status': {
          setAgentStatus(parsed.status);
          break;
        }
        case 'error': {
          setAgentError(parsed.error);
          break;
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (!room) return;
    room.on(RoomEvent.DataReceived, handleData);
    return () => {
      room.off(RoomEvent.DataReceived, handleData);
    };
  }, [room, handleData]);

  const clearTranscripts = useCallback(() => {
    setTranscripts([]);
    setAgentDraft(null);
    setAgentStatus('');
    setAgentError(null);
  }, []);

  return {
    transcripts,
    agentDraft,
    agentStatus,
    agentError,
    clearTranscripts,
  };
}

export function isAgentDataTopic(topic: string | undefined): boolean {
  return topic === agentDataTopic;
}

export function parseAgentDataPayload(payload: Uint8Array, now: () => number = Date.now): ParsedAgentData {
  try {
    const text = new TextDecoder().decode(payload);
    const msg: AgentMessage = JSON.parse(text);

    switch (msg.type) {
      case 'transcript':
      case 'translation': {
        if (!isAgentTranscriptPayload(msg.payload)) {
          return null;
        }
        const timestamp =
          typeof msg.payload.timestamp === 'number' && Number.isFinite(msg.payload.timestamp)
            ? msg.payload.timestamp
            : now();
        return { type: 'transcript', transcript: { ...msg.payload, timestamp } };
      }
      case 'draft': {
        if (!isAgentDraft(msg.payload)) {
          return null;
        }
        return { type: 'draft', draft: msg.payload };
      }
      case 'status': {
        const message = stringField(msg.payload, 'message') ?? stringField(msg.payload, 'step') ?? '';
        return { type: 'status', status: message };
      }
      case 'error': {
        const message = stringField(msg.payload, 'message') ?? 'Agent error';
        return { type: 'error', error: message };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

type AgentTranscriptPayload = Omit<AgentTranscript, 'timestamp'> & { timestamp?: unknown };

function isAgentTranscriptPayload(payload: unknown): payload is AgentTranscriptPayload {
  if (!isRecord(payload)) {
    return false;
  }

  return (
    (payload.role === 'doctor' || payload.role === 'patient' || payload.role === 'assistant') &&
    typeof payload.language === 'string' &&
    typeof payload.text === 'string' &&
    (payload.redacted === undefined || typeof payload.redacted === 'string') &&
    (payload.speakerId === undefined || typeof payload.speakerId === 'string') &&
    (payload.sourceId === undefined || typeof payload.sourceId === 'string') &&
    (payload.attributionMode === undefined || typeof payload.attributionMode === 'string') &&
    (payload.attributionSource === undefined || typeof payload.attributionSource === 'string') &&
    (payload.attributionConfidence === undefined ||
      (typeof payload.attributionConfidence === 'number' && Number.isFinite(payload.attributionConfidence)))
  );
}

function isAgentDraft(payload: unknown): payload is AgentDraft {
  if (!isRecord(payload)) {
    return false;
  }

  return (
    (payload.patientUuid === undefined ||
      payload.patientUuid === null ||
      typeof payload.patientUuid === 'string') &&
    typeof payload.chiefComplaint === 'string' &&
    isStringArray(payload.symptoms) &&
    isStringArray(payload.medicationsMentioned) &&
    isStringArray(payload.allergiesMentioned) &&
    typeof payload.assessmentNotes === 'string' &&
    typeof payload.patientInstructions === 'string' &&
    (payload.facts === undefined || isAgentClinicalFactArray(payload.facts)) &&
    (payload.reviewQueue === undefined || isAgentClinicalFactArray(payload.reviewQueue)) &&
    (payload.missingFields === undefined || isStringArray(payload.missingFields)) &&
    (payload.clinicianReviewRequired === undefined || typeof payload.clinicianReviewRequired === 'boolean')
  );
}

function stringField(payload: unknown, key: string): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  const value = payload[key];
  return typeof value === 'string' ? value : undefined;
}

function isRecord(payload: unknown): payload is Record<string, unknown> {
  return typeof payload === 'object' && payload !== null;
}

function isStringArray(payload: unknown): payload is string[] {
  return Array.isArray(payload) && payload.every((item) => typeof item === 'string');
}

function isAgentClinicalFactArray(payload: unknown): payload is AgentClinicalFact[] {
  return Array.isArray(payload) && payload.every(isAgentClinicalFact);
}

function isAgentClinicalFact(payload: unknown): payload is AgentClinicalFact {
  if (!isRecord(payload)) {
    return false;
  }

  return (
    typeof payload.kind === 'string' &&
    typeof payload.value === 'string' &&
    typeof payload.confidence === 'number' &&
    Number.isFinite(payload.confidence) &&
    typeof payload.status === 'string' &&
    (payload.needsReview === undefined || typeof payload.needsReview === 'boolean')
  );
}
