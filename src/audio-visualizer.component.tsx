import React, { useCallback, useEffect, useRef } from 'react';
import { useLocalParticipant } from '@livekit/components-react';
import { Track } from 'livekit-client';

interface AudioVisualizerProps {
  width?: number;
  height?: number;
  barCount?: number;
  className?: string;
}

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({
  width = 200,
  height = 48,
  barCount = 24,
  className,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const { localParticipant } = useLocalParticipant();

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);

    ctx.clearRect(0, 0, width, height);

    const step = Math.floor(data.length / barCount);
    const barWidth = (width / barCount) * 0.7;
    const gap = (width / barCount) * 0.3;

    for (let i = 0; i < barCount; i++) {
      const val = data[i * step] / 255;
      const barHeight = Math.max(2, val * height);
      const x = i * (barWidth + gap);
      const y = (height - barHeight) / 2;

      const intensity = Math.min(1, val * 1.5);
      const r = Math.round(15 + intensity * 50);
      const g = Math.round(98 + intensity * 60);
      const b = Math.round(254 - intensity * 40);
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, 2);
      ctx.fill();
    }

    animRef.current = requestAnimationFrame(draw);
  }, [width, height, barCount]);

  useEffect(() => {
    if (!localParticipant) return;

    const micPub = localParticipant.getTrackPublication(Track.Source.Microphone);
    const track = micPub?.track;
    if (!track?.mediaStream) return;

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
  }, [localParticipant, localParticipant?.isMicrophoneEnabled, draw]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={className}
      aria-hidden="true"
    />
  );
};

export default AudioVisualizer;
