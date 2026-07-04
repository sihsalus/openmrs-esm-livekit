import { useCallback, useEffect, useRef, useState } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { DataPacket_Kind, RoomEvent } from 'livekit-client';

export interface AgentTranscript {
  role: 'doctor' | 'patient' | 'assistant';
  language: string;
  text: string;
  redacted?: string;
  timestamp: number;
}

export interface AgentDraft {
  chiefComplaint: string;
  symptoms: string[];
  medicationsMentioned: string[];
  allergiesMentioned: string[];
  assessmentNotes: string;
  patientInstructions: string;
}

export interface AgentMessage {
  type: 'transcript' | 'translation' | 'draft' | 'status' | 'error';
  payload: unknown;
}

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

  const handleData = useCallback((payload: Uint8Array, participant: unknown, kind: DataPacket_Kind) => {
    if (!mounted.current) return;
    try {
      const text = new TextDecoder().decode(payload);
      const msg: AgentMessage = JSON.parse(text);

      switch (msg.type) {
        case 'transcript':
        case 'translation': {
          if (!isAgentTranscript(msg.payload)) {
            return;
          }
          const transcript = msg.payload;
          const timestamp = Number.isFinite(transcript.timestamp) ? transcript.timestamp : Date.now();
          setTranscripts((prev) => [...prev.slice(-(maxTranscripts - 1)), { ...transcript, timestamp }]);
          break;
        }
        case 'draft': {
          if (isAgentDraft(msg.payload)) {
            setAgentDraft(msg.payload);
          }
          break;
        }
        case 'status': {
          const s = isRecord(msg.payload) ? msg.payload : {};
          setAgentStatus(s.message || s.step || '');
          break;
        }
        case 'error': {
          const e = isRecord(msg.payload) ? msg.payload : {};
          setAgentError(e.message || 'Agent error');
          break;
        }
      }
    } catch {
      // not JSON — ignore non-structured data
    }
  }, []);

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

function isAgentTranscript(payload: unknown): payload is AgentTranscript {
  if (!isRecord(payload)) {
    return false;
  }

  return (
    (payload.role === 'doctor' || payload.role === 'patient' || payload.role === 'assistant') &&
    typeof payload.language === 'string' &&
    typeof payload.text === 'string' &&
    (payload.redacted === undefined || typeof payload.redacted === 'string')
  );
}

function isAgentDraft(payload: unknown): payload is AgentDraft {
  if (!isRecord(payload)) {
    return false;
  }

  return (
    typeof payload.chiefComplaint === 'string' &&
    Array.isArray(payload.symptoms) &&
    Array.isArray(payload.medicationsMentioned) &&
    Array.isArray(payload.allergiesMentioned) &&
    typeof payload.assessmentNotes === 'string' &&
    typeof payload.patientInstructions === 'string'
  );
}

function isRecord(payload: unknown): payload is Record<string, any> {
  return typeof payload === 'object' && payload !== null;
}
