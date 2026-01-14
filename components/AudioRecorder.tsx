import React, { useState, useRef, useEffect } from 'react';
import { Icons } from './Icon';

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

  const ua = navigator.userAgent.toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(ua);

  useEffect(() => {
    loadAudioDevices();
    return () => cleanup();
  }, []);

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

  const startRecording = async (source: AudioSource) => {
    setError(null);
    setIsPreparing(true);
    setAudioSource(source);

    try {
      let stream: MediaStream;

      if (source === 'system') {
        // Double check for iOS here just in case
        if (isIOS) {
          throw new Error("System audio capture is not supported on iOS.");
        }

        const getDisplayMedia = 
          (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia?.bind(navigator.mediaDevices)) ||
          (navigator as any).getDisplayMedia?.bind(navigator);

        if (!getDisplayMedia) {
          throw new Error("Your browser does not support system audio capture.");
        }

        try {
          stream = await getDisplayMedia({
            video: true,
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false
            } as any
          });
        } catch (err: any) {
          setIsPreparing(false);
          if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError' || err.name === 'AbortError') return;
          setError(err.message || "Failed to start capture.");
          return;
        }

        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length === 0) {
          setError("No audio tracks found. Ensure you checked 'Share system audio'.");
          stream.getTracks().forEach(t => t.stop());
          setIsPreparing(false);
          return;
        }

        streamRef.current = stream; 
        const audioOnlyStream = new MediaStream(audioTracks);
        const mimeType = getSupportedMimeType();
        mediaRecorderRef.current = new MediaRecorder(audioOnlyStream, { mimeType: mimeType || undefined });

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

      mediaRecorderRef.current.start(1000);
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
      <div className="w-full h-full flex flex-col items-center justify-center border-2 border-red-200 bg-red-50 rounded-[1.5rem] p-8 animate-pulse-slow">
        <div className="relative mb-6">
          <div className="absolute inset-0 bg-red-400 rounded-full animate-ping opacity-20"></div>
          <button onClick={stopRecording} className="relative z-10 bg-red-500 text-white p-6 rounded-full shadow-xl hover:bg-red-600 transition-all hover:scale-105 active:scale-95">
            <Icons.Square size={32} fill="currentColor" />
          </button>
        </div>
        <div className="text-center">
          <p className="text-red-600 font-bold text-lg mb-1">Recording...</p>
          <p className="text-xs text-red-400 mb-2 font-medium uppercase tracking-wide">
             {audioSource === 'system' ? 'System Audio' : 'Microphone'}
          </p>
          <p className="text-3xl font-mono font-bold text-slate-800">{formatTime(duration)}</p>
        </div>
        <button onClick={stopRecording} className="mt-8 text-sm font-semibold text-red-700 bg-red-100 px-6 py-2 rounded-full hover:bg-red-200">
          Stop & Process
        </button>
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

            {/* System Audio Option - Disabled on iOS */}
            <button 
              onClick={() => !isIOS && startRecording('system')} 
              disabled={isIOS}
              className={`flex items-center gap-4 p-5 border rounded-2xl transition-all text-left group
                ${isIOS 
                  ? 'bg-slate-100 border-slate-200 opacity-60 cursor-not-allowed' 
                  : 'bg-white border-slate-200 hover:border-primary-500 hover:shadow-md cursor-pointer'
                }
              `}
            >
              <div className={`p-3 rounded-xl ${isIOS ? 'bg-slate-200 text-slate-400' : 'bg-primary-100 text-primary-600'}`}>
                <Icons.FileAudio size={24} />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h4 className={`font-bold ${isIOS ? 'text-slate-500' : 'text-slate-800'}`}>
                    {isIOS ? 'Not Supported on iOS' : 'Direct System Audio'}
                  </h4>
                </div>
                <p className="text-xs text-slate-500">
                  {isIOS ? 'Apple blocks in-browser system audio.' : 'Works best on Laptop/Chrome.'}
                </p>
              </div>
            </button>
            
            {isIOS && (
               <div className="bg-blue-50 text-blue-800 p-3 rounded-xl text-[10px] border border-blue-100 mt-2">
                 <strong>iOS Workaround:</strong> Use <strong>Microphone</strong> mode above, OR record your screen to a video file in Control Center, then select <strong>Upload</strong> on the main menu.
               </div>
            )}
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