import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocalParticipant } from '@livekit/components-react';
import { ProgressBar, Tag } from '@carbon/react';
import { Track } from 'livekit-client';
import styles from './audio-visualizer.scss';

interface AudioVisualizerProps {
  barCount?: number;
  className?: string;
  label: string;
  muted: boolean;
  mutedLabel: string;
  activeLabel: string;
}

const levelUpdateIntervalMs = 100;

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({
  barCount = 32,
  className,
  label,
  muted,
  mutedLabel,
  activeLabel,
}) => {
  const animRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const lastLevelUpdateRef = useRef(0);
  const [level, setLevel] = useState(0);
  const { localParticipant } = useLocalParticipant();

  const resetLevel = useCallback(() => {
    lastLevelUpdateRef.current = 0;
    setLevel(0);
  }, []);

  const draw = useCallback((timestamp: number) => {
    const analyser = analyserRef.current;
    if (!analyser || muted) {
      resetLevel();
      return;
    }

    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);

    const step = Math.max(1, Math.floor(data.length / barCount));
    let peak = 0;

    for (let i = 0; i < barCount; i++) {
      const sample = data[Math.min(i * step, data.length - 1)] ?? 0;
      peak = Math.max(peak, sample);
    }

    if (timestamp - lastLevelUpdateRef.current >= levelUpdateIntervalMs) {
      const nextLevel = Math.round((peak / 255) * 100);
      setLevel((currentLevel) => (Math.abs(currentLevel - nextLevel) >= 2 ? nextLevel : currentLevel));
      lastLevelUpdateRef.current = timestamp;
    }

    animRef.current = requestAnimationFrame(draw);
  }, [barCount, muted, resetLevel]);

  useEffect(() => {
    if (muted) {
      resetLevel();
      return;
    }

    if (!localParticipant) {
      resetLevel();
      return;
    }

    const micPub = localParticipant.getTrackPublication(Track.Source.Microphone);
    const track = micPub?.track;
    if (!track?.mediaStream) {
      resetLevel();
      return;
    }

    const audioCtx = new AudioContext();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.7;

    const source = audioCtx.createMediaStreamSource(track.mediaStream);
    source.connect(analyser);

    audioCtxRef.current = audioCtx;
    analyserRef.current = analyser;
    sourceRef.current = source;

    animRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animRef.current);
      source.disconnect();
      audioCtx.close();
      audioCtxRef.current = null;
      analyserRef.current = null;
      sourceRef.current = null;
    };
  }, [localParticipant, localParticipant?.isMicrophoneEnabled, muted, draw, resetLevel]);

  return (
    <div className={[styles.audioMeter, className].filter(Boolean).join(' ')}>
      <div className={styles.audioMeterHeader}>
        <Tag type={muted ? 'gray' : 'green'} size="sm">
          {muted ? mutedLabel : activeLabel}
        </Tag>
      </div>
      <ProgressBar
        className={styles.audioMeterProgress}
        label={label}
        max={100}
        size="small"
        type="default"
        value={muted ? 0 : level}
      />
    </div>
  );
};

export default AudioVisualizer;
