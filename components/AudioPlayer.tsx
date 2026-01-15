import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Icons } from './Icon';

interface AudioPlayerProps {
  file: File;
  previewUrl: string;
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({ file, previewUrl }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [waveformData, setWaveformData] = useState<number[]>([]);
  const animationRef = useRef<number>(0);

  // Decode and Extract Waveform Data
  useEffect(() => {
    let active = true;
    const processAudio = async () => {
      try {
        const maxWaveformBytes = 200 * 1024 * 1024;
        if (file.size > maxWaveformBytes) return;

        const arrayBuffer = await file.arrayBuffer();
        if (!active) return;
        
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        
        if (!active) {
            audioCtx.close();
            return;
        }

        setDuration(audioBuffer.duration);

        // Extract and Downsample
        const rawData = audioBuffer.getChannelData(0); 
        const samples = 150; // Resolution of bars
        const blockSize = Math.floor(rawData.length / samples);
        const filteredData = [];
        
        for (let i = 0; i < samples; i++) {
          let sum = 0;
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(rawData[blockSize * i + j]);
          }
          filteredData.push(sum / blockSize);
        }

        // Normalize data (0.0 - 1.0)
        const max = Math.max(...filteredData);
        const multiplier = max > 0 ? 1 / max : 1;
        const normalizedData = filteredData.map(n => n * multiplier);
        
        setWaveformData(normalizedData);
        audioCtx.close();
      } catch (e) {
        console.warn("Audio processing skipped or failed", e);
      }
    };

    if (file.type.includes('audio')) {
        processAudio();
    }
    
    return () => { active = false; };
  }, [file]);

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

    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('durationchange', handleDurationChange);
    
    return () => {
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('durationchange', handleDurationChange);
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

    if (waveformData.length === 0) {
        // Fallback line
        ctx.beginPath();
        ctx.moveTo(0, height/2);
        ctx.lineTo(width, height/2);
        ctx.strokeStyle = '#fee2e2';
        ctx.stroke();
        return;
    }

    const barWidth = width / waveformData.length;
    const gap = 1;
    const effectiveBarWidth = Math.max(0.5, barWidth - gap);
    const progressPercent = duration > 0 ? currentTime / duration : 0;

    waveformData.forEach((amp, index) => {
      const x = index * barWidth;
      
      // Determine color: Played vs Unplayed
      // Calculate start and end of this specific bar in percentage
      const barStartPercent = index / waveformData.length;
      
      if (barStartPercent < progressPercent) {
        ctx.fillStyle = '#ef4444'; // Played: Red-500
      } else {
        ctx.fillStyle = '#fca5a5'; // Unplayed: Red-300 (Faded)
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


  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.play();
        setIsPlaying(true);
      }
    }
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
        />
        
        <div className="flex items-center gap-4">
             {/* Play/Pause Button */}
             <button 
                onClick={togglePlay}
                className="w-12 h-12 flex items-center justify-center rounded-full bg-red-50 text-red-600 hover:bg-red-100 transition-all hover:scale-105 active:scale-95 shrink-0 shadow-sm border border-red-100"
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
