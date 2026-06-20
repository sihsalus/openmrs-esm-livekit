import { useCallback, useEffect, useRef, useState } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { DataPacket_Kind, RoomEvent } from 'livekit-client';

export interface AgentTranscript {
  role: 'doctor' | 'patient';
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

export function useAgentData() {
  const room = useRoomContext();
  const [transcripts, setTranscripts] = useState<AgentTranscript[]>([]);
  const [agentDraft, setAgentDraft] = useState<AgentDraft | null>(null);
  const [agentStatus, setAgentStatus] = useState<string>('');
  const [agentError, setAgentError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const handleData = useCallback(
    (payload: Uint8Array, participant: unknown, kind: DataPacket_Kind) => {
      if (!mounted.current) return;
      try {
        const text = new TextDecoder().decode(payload);
        const msg: AgentMessage = JSON.parse(text);

        switch (msg.type) {
          case 'transcript':
          case 'translation': {
            const t = msg.payload as AgentTranscript;
            setTranscripts((prev) => [...prev, { ...t, timestamp: Date.now() }]);
            break;
          }
          case 'draft': {
            setAgentDraft(msg.payload as AgentDraft);
            break;
          }
          case 'status': {
            const s = msg.payload as { step?: string; message?: string };
            setAgentStatus(s.message || s.step || '');
            break;
          }
          case 'error': {
            const e = msg.payload as { message?: string };
            setAgentError(e.message || 'Agent error');
            break;
          }
        }
      } catch {
        // not JSON — ignore non-structured data
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
