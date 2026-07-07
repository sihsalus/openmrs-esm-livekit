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
  | { type: 'status'; status: string; step?: string }
  | { type: 'error'; error: string }
  | null;

export const agentDataTopic = 'agent-data';

const maxTranscripts = 100;

export function useAgentData() {
  const room = useRoomContext();
  const [transcripts, setTranscripts] = useState<AgentTranscript[]>([]);
  const [agentDraft, setAgentDraft] = useState<AgentDraft | null>(null);
  const [agentStatus, setAgentStatus] = useState<string>('');
  const [agentStatusStep, setAgentStatusStep] = useState<string>('');
  const [agentError, setAgentError] = useState<string | null>(null);
  const [agentParticipantConnected, setAgentParticipantConnected] = useState(false);
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
          setAgentStatusStep(parsed.step ?? '');
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

  useEffect(() => {
    if (!room) {
      setAgentParticipantConnected(false);
      return;
    }

    const updateAgentPresence = () => {
      if (mounted.current) {
        setAgentParticipantConnected(roomHasAgentParticipant(room.remoteParticipants.values()));
      }
    };

    updateAgentPresence();
    room.on(RoomEvent.ParticipantConnected, updateAgentPresence);
    room.on(RoomEvent.ParticipantDisconnected, updateAgentPresence);
    room.on(RoomEvent.ParticipantMetadataChanged, updateAgentPresence);

    return () => {
      room.off(RoomEvent.ParticipantConnected, updateAgentPresence);
      room.off(RoomEvent.ParticipantDisconnected, updateAgentPresence);
      room.off(RoomEvent.ParticipantMetadataChanged, updateAgentPresence);
    };
  }, [room]);

  const clearTranscripts = useCallback(() => {
    setTranscripts([]);
    setAgentDraft(null);
    setAgentStatus('');
    setAgentStatusStep('');
    setAgentError(null);
  }, []);

  return {
    transcripts,
    agentDraft,
    agentStatus,
    agentStatusStep,
    agentError,
    agentParticipantConnected,
    clearTranscripts,
  };
}

export function isAgentDataTopic(topic: string | undefined): boolean {
  return topic === agentDataTopic;
}

interface AgentLikeParticipant {
  identity?: string;
  isAgent?: boolean;
  kind?: unknown;
  attributes?: Readonly<Record<string, string>>;
}

export function isAgentParticipant(participant: AgentLikeParticipant): boolean {
  if (participant.isAgent) {
    return true;
  }

  const kind = String(participant.kind ?? '').toLowerCase();
  if (kind.includes('agent')) {
    return true;
  }

  const identity = (participant.identity ?? '').toLowerCase();
  return (
    identity === 'clinical' ||
    identity.startsWith('agent-') ||
    identity.includes('livekit-agent') ||
    participant.attributes?.['lk.agent'] === 'true'
  );
}

export function roomHasAgentParticipant(participants: Iterable<AgentLikeParticipant>): boolean {
  for (const participant of participants) {
    if (isAgentParticipant(participant)) {
      return true;
    }
  }
  return false;
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
        const step = stringField(msg.payload, 'step');
        const message = stringField(msg.payload, 'message') ?? step ?? '';
        return { type: 'status', status: message, step };
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
