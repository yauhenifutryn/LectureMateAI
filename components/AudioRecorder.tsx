import React, { useState, useRef, useEffect } from 'react';
import { Icons } from './Icon';
import { appendAmplitude } from './audioWaveform';

interface AudioRecorderProps {
  onRecordingComplete: (file: File) => void;
}

type AudioSource = 'microphone' | 'system';

interface AudioDevice {
  deviceId: string;
  label: string;
}

const AudioRecorder: React.FC<AudioRecorderProps> = ({ onRecordingComplete }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioSource, setAudioSource] = useState<AudioSource>('microphone');
  const [error, setError] = useState<string | null>(null);
  
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  // Visualizer Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const amplitudeHistoryRef = useRef<number[]>([]);

  const ua = navigator.userAgent.toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(ua);
  const isSafari = ua.includes('safari') && !ua.includes('chrome') && !ua.includes('crios');

  const isSystemAudioSupported = !isIOS && !isSafari;

  useEffect(() => {
    loadAudioDevices();
    return () => cleanup();
  }, []);

  useEffect(() => {
    if (isRecording && streamRef.current && canvasRef.current) {
      // Clear previous history when starting new recording visualizer
      amplitudeHistoryRef.current = [];
      setupVisualizer(streamRef.current, canvasRef.current);
    }
  }, [isRecording]);

  const loadAudioDevices = async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true }).then(s => s.getTracks().forEach(t => t.stop()));
      const devs = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devs
        .filter(d => d.kind === 'audioinput')
        .map(d => ({ deviceId: d.deviceId, label: d.label || `Microphone ${d.deviceId.slice(0, 5)}...` }));
      setDevices(audioInputs);
      if (audioInputs.length > 0) {
        setSelectedDeviceId(prev => prev || audioInputs[0].deviceId);
      }
    } catch (e) {
      console.warn("Could not enumerate devices", e);
    }
  };

  const cleanup = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsPreparing(false);
  };

  const getSupportedMimeType = () => {
    if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
    if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
    return ''; 
  };

  const setupVisualizer = (stream: MediaStream, canvas: HTMLCanvasElement) => {
    try {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = audioCtx.createAnalyser();
      const source = audioCtx.createMediaStreamSource(stream);

      source.connect(analyser);
      analyser.fftSize = 2048; // Large FFT for better time domain resolution
      
      audioContextRef.current = audioCtx;
      
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const draw = () => {
        animationFrameRef.current = requestAnimationFrame(draw);
        
        // Get Time Domain Data (Waveform)
        analyser.getByteTimeDomainData(dataArray);

        // Calculate RMS (Volume) for this frame
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
            const x = (dataArray[i] - 128) / 128.0; // Normalize -1 to 1
            sum += x * x;
        }
        const rms = Math.sqrt(sum / bufferLength);
        
        // Push simplified amplitude to history
        const amp = Math.min(1, rms * 5);

        // Rendering Logic: iPhone-style infinite run
        const width = canvas.width;
        const height = canvas.height;

        const barWidth = 3;
        const gap = 2;
        const barSpan = barWidth + gap;
        const maxBars = Math.max(1, Math.floor(width / barSpan));

        amplitudeHistoryRef.current = appendAmplitude(
          amplitudeHistoryRef.current,
          amp,
          maxBars
        );

        const history = amplitudeHistoryRef.current;
        const startX = Math.max(0, width - history.length * barSpan);

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#EE3B30';

        for (let i = 0; i < history.length; i += 1) {
          const h = Math.max(2, history[i] * height * 0.9);
          const x = startX + i * barSpan;
          const y = (height - h) / 2;
          ctx.fillRect(x, y, barWidth, h);
        }
      };

      draw();
    } catch (e) {
      console.warn("Visualizer setup failed:", e);
    }
  };

  const startRecording = async (source: AudioSource) => {
    setError(null);
    setIsPreparing(true);
    setAudioSource(source);

    try {
      let stream: MediaStream;

      if (source === 'system') {
        if (!isSystemAudioSupported) {
          throw new Error("System audio capture is not supported on this browser.");
        }

        const getDisplayMedia = 
          (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia?.bind(navigator.mediaDevices)) ||
          (navigator as any).getDisplayMedia?.bind(navigator);

        try {
          stream = await getDisplayMedia({
            video: true, 
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            }
          });
        } catch (err: any) {
          setIsPreparing(false);
          if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError' || err.name === 'AbortError') return;
          setError(err.message || "Failed to start capture.");
          return;
        }

        streamRef.current = stream; 
        const audioTracks = stream.getAudioTracks();
        const streamToRecord = audioTracks.length > 0 ? new MediaStream(audioTracks) : stream;
        const mimeType = getSupportedMimeType();
        
        mediaRecorderRef.current = new MediaRecorder(streamToRecord, { mimeType: mimeType || undefined });

      } else {
        const constraints = {
          audio: {
            deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false 
          }
        };
        
        try {
            stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (e) {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
        
        streamRef.current = stream;
        const mimeType = getSupportedMimeType();
        mediaRecorderRef.current = new MediaRecorder(stream, { mimeType: mimeType || undefined });
      }

      chunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorderRef.current.onstop = () => {
        const mimeType = mediaRecorderRef.current?.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mimeType });
        let ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const file = new File([blob], `recording_${Date.now()}.${ext}`, { type: mimeType });
        onRecordingComplete(file);
        cleanup();
      };

      mediaRecorderRef.current.start(1000); // chunk every 1s
      setIsRecording(true);
      setIsPreparing(false);
      
      startTimeRef.current = Date.now();
      setDuration(0);
      timerRef.current = window.setInterval(() => {
        setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 500);

    } catch (err: any) {
      console.error("Recording Error:", err);
      setIsPreparing(false);
      setError(err.message || "Could not start recording.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (isRecording) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center border-2 border-red-200 bg-white rounded-[1.5rem] p-6 relative overflow-hidden shadow-sm">
        
        <div className="relative z-10 w-full flex flex-col items-center">
            {/* Pulsing indicator with Clean Red Theme */}
            <div className="relative mb-6 group cursor-pointer" onClick={stopRecording}>
                <div className="absolute inset-0 bg-red-100 rounded-full animate-ping opacity-75"></div>
                <div className="relative z-10 bg-red-500 text-white p-6 rounded-full shadow-lg hover:bg-red-600 transition-all hover:scale-105 active:scale-95 border-4 border-white ring-1 ring-red-100">
                    <Icons.Square size={32} fill="currentColor" />
                </div>
            </div>

            <div className="text-center w-full max-w-[280px]">
                <p className="text-red-500 font-bold text-lg mb-1 tracking-wide">Recording...</p>
                <p className="text-3xl font-mono font-bold text-slate-800 mb-6 tracking-wider">{formatTime(duration)}</p>
                
                {/* Visualizer Canvas - Clean White Theme */}
                <div className="h-16 w-full mb-6 bg-transparent relative">
                     <canvas 
                        ref={canvasRef} 
                        width={560} // Double res for retina 
                        height={128} 
                        className="w-full h-full"
                     />
                </div>

                <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">
                    {audioSource === 'system' ? 'System Audio' : 'Microphone Input'}
                </p>
            </div>

            <button onClick={stopRecording} className="mt-8 text-sm font-semibold text-red-600 bg-red-50 hover:bg-red-100 px-6 py-2.5 rounded-full border border-red-100 transition-all">
                Stop & Process
            </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-[1.5rem] p-6 bg-slate-50/30">
        
        {isPreparing ? (
          <div className="text-center space-y-4">
            <Icons.Loader2 size={48} className="text-primary-600 animate-spin mx-auto" />
            <h3 className="text-xl font-bold text-slate-800">Initializing...</h3>
          </div>
        ) : (
          <div className="w-full grid grid-cols-1 gap-4">
            {/* Mic Option */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 hover:border-primary-500 transition-all shadow-sm">
              <div className="flex items-center gap-4 cursor-pointer" onClick={() => startRecording('microphone')}>
                <div className="bg-primary-100 text-primary-600 p-3 rounded-xl">
                  <Icons.Mic size={24} />
                </div>
                <div className="flex-1 text-left">
                  <h4 className="font-bold text-slate-800">Microphone</h4>
                  <p className="text-xs text-slate-500">Record via Device Mic.</p>
                </div>
              </div>
              <select 
                value={selectedDeviceId} 
                onChange={(e) => setSelectedDeviceId(e.target.value)}
                className="mt-3 w-full text-xs p-2 rounded-lg border border-slate-200 bg-slate-50 text-slate-700"
              >
                {devices.length === 0 && <option value="">Default Microphone</option>}
                {devices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
                ))}
              </select>
            </div>

            {/* System Audio Option */}
            <button 
              onClick={() => isSystemAudioSupported && startRecording('system')} 
              disabled={!isSystemAudioSupported}
              className={`flex flex-col gap-3 p-5 border rounded-2xl transition-all text-left group h-full
                ${!isSystemAudioSupported 
                  ? 'bg-slate-100 border-slate-200 opacity-70 cursor-not-allowed' 
                  : 'bg-white border-slate-200 hover:border-primary-500 hover:shadow-md cursor-pointer'
                }
              `}
            >
              <div className="flex items-start gap-4">
                <div className={`p-3 rounded-xl ${!isSystemAudioSupported ? 'bg-slate-200 text-slate-400' : 'bg-primary-100 text-primary-600'}`}>
                  <Icons.FileAudio size={24} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h4 className={`font-bold ${!isSystemAudioSupported ? 'text-slate-500' : 'text-slate-800'}`}>
                      {isIOS ? 'Not Supported on Mobile' : isSafari ? 'Not Supported on Safari' : 'System Audio'}
                    </h4>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {isIOS 
                      ? 'Use Chrome on Desktop.' 
                      : isSafari
                         ? 'Audio capture is restricted. Please use Google Chrome.'
                         : 'Records internal audio from apps or meetings.'}
                  </p>
                </div>
              </div>

              {/* Only show guidance if supported (Not Safari/iOS) */}
              {isSystemAudioSupported && (
                <div className="w-full mt-1 bg-amber-50 border border-amber-100 rounded-lg p-2.5">
                   <div className="flex gap-2 items-start">
                     <Icons.AlertCircle size={14} className="text-amber-600 mt-0.5 shrink-0" />
                     <div className="text-[11px] leading-relaxed text-amber-800">
                        <span className="font-bold">Recommended:</span> Select <strong>"Entire Screen"</strong>.
                     </div>
                   </div>
                </div>
              )}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 p-4 bg-red-100 text-red-800 rounded-xl text-[11px] font-medium flex items-start gap-2 border border-red-200 animate-fade-in">
          <Icons.AlertCircle size={16} className="shrink-0 mt-0.5" />
          <p className="leading-relaxed">{error}</p>
        </div>
      )}
    </div>
  );
};

export default AudioRecorder;
