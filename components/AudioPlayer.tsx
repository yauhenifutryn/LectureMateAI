import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Icons } from './Icon';
import { resampleWaveformData } from './audioWaveform';

interface AudioPlayerProps {
  file: File;
  previewUrl: string;
  enableWaveform?: boolean;
}

const DEFAULT_MAX_WAVEFORM_BYTES = 200 * 1024 * 1024;

export function shouldRenderWaveform(
  file: { size: number; type: string },
  enableWaveform: boolean,
  maxWaveformBytes = DEFAULT_MAX_WAVEFORM_BYTES
): boolean {
  if (!enableWaveform) return false;
  if (!file.type.includes('audio')) return false;
  return file.size <= maxWaveformBytes;
}

export function resetAudioElement(audio: {
  pause: () => void;
  load: () => void;
  currentTime: number;
  src: string;
}): void;
export function resetAudioElement(
  audio: { pause: () => void; load: () => void; currentTime: number; src: string },
  previewUrl?: string
): void {
  audio.pause();
  audio.currentTime = 0;
  if (previewUrl) {
    audio.src = previewUrl;
  }
  audio.load();
}

export async function tryPlayAudio(
  audio: { play: () => Promise<void> },
  logger: { error: (...args: unknown[]) => void } = console
): Promise<boolean> {
  try {
    await audio.play();
    return true;
  } catch (error) {
    logger.error('Audio playback failed:', error);
    return false;
  }
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({
  file,
  previewUrl,
  enableWaveform = true
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [waveformData, setWaveformData] = useState<number[]>([]);
  const animationRef = useRef<number>(0);

  // Decode and Extract Waveform Data
  useEffect(() => {
    let active = true;
    const processAudio = async () => {
      try {
        if (!shouldRenderWaveform(file, enableWaveform)) {
          setWaveformData([]);
          return;
        }

        const arrayBuffer = await file.arrayBuffer();
        if (!active) return;
        
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        
        if (!active) {
            audioCtx.close();
            return;
        }

        setDuration(audioBuffer.duration);

        // Extract and downsample
        const rawData = audioBuffer.getChannelData(0);
        const targetBars = canvasRef.current
          ? Math.max(60, Math.floor(canvasRef.current.width / 6))
          : 150;
        const normalizedData = resampleWaveformData(
          Array.from(rawData, (value) => Math.abs(value)),
          targetBars
        );

        // Normalize data (0.0 - 1.0)
        const max = Math.max(...normalizedData);
        const multiplier = max > 0 ? 1 / max : 1;
        const scaledData = normalizedData.map((n) => n * multiplier);
        
        setWaveformData(scaledData);
        audioCtx.close();
      } catch (e) {
        console.warn("Audio processing skipped or failed", e);
      }
    };

    if (file.type.includes('audio')) {
      processAudio();
    }
    
    return () => { active = false; };
  }, [file, enableWaveform]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    resetAudioElement(audio, previewUrl);
    setIsPlaying(false);
    setIsReady(false);
    setCurrentTime(0);
  }, [previewUrl]);

  // Sync React state with Audio Element
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateTime = () => setCurrentTime(audio.currentTime);
    const handleEnded = () => setIsPlaying(false);
    const handleDurationChange = () => {
        if (audio.duration && !isNaN(audio.duration)) {
             setDuration(audio.duration);
        }
    };
    const handleCanPlay = () => setIsReady(true);
    const handleLoadStart = () => setIsReady(false);
    const handleError = () => setIsReady(false);

    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('loadedmetadata', handleCanPlay);
    audio.addEventListener('loadstart', handleLoadStart);
    audio.addEventListener('error', handleError);
    
    return () => {
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('loadedmetadata', handleCanPlay);
      audio.removeEventListener('loadstart', handleLoadStart);
      audio.removeEventListener('error', handleError);
    };
  }, []);

  // Draw Loop
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    
    ctx.clearRect(0, 0, width, height);

    const progressPercent = duration > 0 ? currentTime / duration : 0;

    if (waveformData.length === 0) {
      // Fallback line for uploads
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.strokeStyle = '#fecaca';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.stroke();

      if (progressPercent > 0) {
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width * progressPercent, height / 2);
      ctx.strokeStyle = '#EE3B30';
        ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.stroke();
      }
      return;
    }

    const barWidth = width / waveformData.length;
    const gap = 1;
    const effectiveBarWidth = Math.max(0.5, barWidth - gap);

    waveformData.forEach((amp, index) => {
      const x = index * barWidth;
      
      // Determine color: Played vs Unplayed
      // Calculate start and end of this specific bar in percentage
      const barStartPercent = index / waveformData.length;
      
      if (barStartPercent < progressPercent) {
        ctx.fillStyle = '#d92b23';
      } else {
        ctx.fillStyle = '#fca5a5';
      }

      // Height with mirror effect
      // Clamp min height to 2px for visibility
      const barHeight = Math.max(4, amp * height * 0.8); 
      const y = (height - barHeight) / 2;

      // Draw rounded rect manually by drawing rect
      ctx.fillRect(x, y, effectiveBarWidth, barHeight);
    });
    
  }, [waveformData, currentTime, duration]);

  // Animation Loop via requestAnimationFrame for smooth UI
  useEffect(() => {
     let rafId: number;
     const loop = () => {
         draw();
         if (isPlaying) {
             rafId = requestAnimationFrame(loop);
         }
     };
     
     // Draw immediately on state change
     draw();

     if (isPlaying) {
         rafId = requestAnimationFrame(loop);
     }

     return () => cancelAnimationFrame(rafId);
  }, [draw, isPlaying]);


  const togglePlay = async () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      return;
    }

    const started = await tryPlayAudio(audioRef.current);
    setIsPlaying(started);
  };

  const handleSeek = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !audioRef.current || duration === 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    const newTime = percentage * duration;
    
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const formatTime = (t: number) => {
    if (!t || isNaN(t)) return "0:00";
    const mins = Math.floor(t / 60);
    const secs = Math.floor(t % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="w-full bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex flex-col gap-4">
        {/* Hidden Audio Element */}
        <audio 
            ref={audioRef} 
            src={previewUrl}
            preload="metadata"
        />
        
        <div className="flex items-center gap-4">
             {/* Play/Pause Button */}
             <button 
                type="button"
                onClick={togglePlay}
                disabled={!isReady}
                className={`w-12 h-12 flex items-center justify-center rounded-full transition-all shrink-0 shadow-sm border ${
                  isReady
                    ? 'bg-red-50 text-red-600 hover:bg-red-100 hover:scale-105 active:scale-95 border-red-100'
                    : 'bg-slate-100 text-slate-300 border-slate-200 cursor-not-allowed'
                }`}
             >
                 {isPlaying ? <Icons.Pause size={24} fill="currentColor" /> : <Icons.Play size={24} fill="currentColor" className="ml-1" />}
             </button>

             {/* Scrubber / Waveform */}
             <div className="flex-1 relative h-16 cursor-pointer group" onClick={handleSeek}>
                  <canvas
                      ref={canvasRef}
                      width={800} 
                      height={128}
                      className="w-full h-full block"
                  />
                  {/* Hover effect guide (optional) */}
             </div>
        </div>

        {/* Timestamps */}
        <div className="flex justify-between text-xs font-mono font-medium text-slate-400 px-1">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
        </div>
    </div>
  )
};

export default AudioPlayer;
