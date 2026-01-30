import React, { useState, useRef, useEffect } from 'react';
import { AppStatus, FileData, AnalysisResult, ChatMessage, ChatSession, AccessContext } from './types';
import {
  analyzeAudioLectureWithCleanup,
  cleanupUploadedFiles,
  initializeChatSession
} from './services/geminiService';
import FileUpload from './components/FileUpload';
import AudioRecorder from './components/AudioRecorder';
import ProcessingState from './components/ProcessingState';
import StudyGuide from './components/StudyGuide';
import ChatInterface from './components/ChatInterface';
import AudioPlayer from './components/AudioPlayer';
import { Icons } from './components/Icon';
import AccessGate from './components/AccessGate';
import AdminPanel from './components/AdminPanel';
import { shouldEnablePlaybackWaveform } from './utils/playbackWaveform';
import { isMobileUserAgent } from './utils/device';
import { getAnalysisStartState } from './utils/analysisState';
import { formatUploadCheckpoint } from './utils/uploadCheckpoint';

type AudioInputMode = 'upload' | 'record';
type Tab = 'study_guide' | 'transcript' | 'chat';

const LOCAL_STORAGE_KEY = 'lecturemate_backup_v1';
const ACCESS_STORAGE_KEY = 'lecturemate_access_v1';
const App: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  
  // Inputs
  const [audioInputMode, setAudioInputMode] = useState<AudioInputMode>('upload');
  const [audioFile, setAudioFile] = useState<FileData | null>(null);
  const [slideFiles, setSlideFiles] = useState<FileData[]>([]);
  const [userContext, setUserContext] = useState('');
  const [modelId, setModelId] = useState<'gemini-2.5-flash' | 'gemini-2.5-pro'>('gemini-2.5-flash');
  const [pendingBlobUrls, setPendingBlobUrls] = useState<string[]>([]);
  const [uploadCheckpoint, setUploadCheckpoint] = useState<string | null>(null);
  
  // Output
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('study_guide');
  const [error, setError] = useState<string | null>(null);

  // Chat State
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const chatSessionRef = useRef<ChatSession | null>(null);

  // UI State
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [access, setAccess] = useState<AccessContext | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const isAdminRoute =
    typeof window !== 'undefined' && window.location.pathname.startsWith('/admin');
  const audioRequired = slideFiles.length === 0;

  const handleAuthorize = (next: AccessContext) => {
    setAccess(next);
    setAccessError(null);
  };

  const cleanupPendingUploads = async (context: AccessContext | null) => {
    if (pendingBlobUrls.length === 0) return;
    await cleanupUploadedFiles(pendingBlobUrls, context || undefined);
    setPendingBlobUrls([]);
  };

  // 1. Safety: Prevent accidental reloads
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const isWorking = status === AppStatus.UPLOADING || status === AppStatus.PROCESSING;
      const hasUnsavedData = audioFile !== null; 
      
      if (isWorking || hasUnsavedData || result) {
        e.preventDefault();
        e.returnValue = ''; 
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [status, audioFile, result]);

  // 2. Backup: Restore Study Guide from LocalStorage on mount
  useEffect(() => {
    const savedData = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (savedData) {
      try {
        const parsed = JSON.parse(savedData);
        if (parsed.result && parsed.result.studyGuide) {
          console.log("Restoring session from backup");
          setResult(parsed.result);
          setStatus(AppStatus.COMPLETED);
        }
      } catch (e) {
        console.error("Failed to restore backup:", e);
        localStorage.removeItem(LOCAL_STORAGE_KEY);
      }
    }
  }, []);

  // 2b. Access: Restore access token from LocalStorage on mount
  useEffect(() => {
    const savedAccess = localStorage.getItem(ACCESS_STORAGE_KEY);
    if (!savedAccess) return;
    try {
      const parsed = JSON.parse(savedAccess) as AccessContext;
      if (parsed?.mode && parsed?.token) {
        setAccess(parsed);
      }
    } catch (e) {
      console.error("Failed to restore access:", e);
      localStorage.removeItem(ACCESS_STORAGE_KEY);
    }
  }, []);

  // 3. Backup: Save Study Guide to LocalStorage
  useEffect(() => {
    if (result) {
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
          result,
          timestamp: Date.now()
        }));
      } catch (e) {
        console.error("Failed to save backup", e);
      }
    }
  }, [result]);

  // 3b. Access: Persist access token
  useEffect(() => {
    if (access) {
      localStorage.setItem(ACCESS_STORAGE_KEY, JSON.stringify(access));
    } else {
      localStorage.removeItem(ACCESS_STORAGE_KEY);
    }
  }, [access]);

  // 4. Initialize Chat Session
  useEffect(() => {
    if (result && access && !chatSessionRef.current) {
      try {
        chatSessionRef.current = initializeChatSession(
          result.transcript,
          result.studyGuide,
          access,
          result.slides,
          result.rawNotes
        );
      } catch (e) {
        console.error("Failed to init chat", e);
      }
    }
  }, [result, access]);

  const handleAudioSelect = (files: FileData[]) => {
    if (files.length > 0) {
      setAudioFile(files[0]);
      setError(null);
    }
  };

  const handleSlideSelect = (files: FileData[]) => {
    setSlideFiles(prev => [...prev, ...files]);
  };

  const removeSlide = (id: string) => {
    setSlideFiles(prev => prev.filter(f => f.id !== id));
  };

  const handleRecordingComplete = (file: File) => {
    const previewUrl = URL.createObjectURL(file);
    setAudioFile({ 
      file, 
      previewUrl,
      id: 'recording' 
    });
    setError(null);
  };

  const handleGenerate = async () => {
    if (!audioFile && slideFiles.length === 0) {
      setError("Please provide audio or slide files to analyze.");
      return;
    }

    try {
      const startState = getAnalysisStartState();
      setResult(startState.result);
      setActiveTab(startState.activeTab);
      setError(startState.error);
      setUploadCheckpoint(null);

      setStatus(AppStatus.UPLOADING);
      const slides = slideFiles.map(s => s.file);
      const analysis = await analyzeAudioLectureWithCleanup(audioFile?.file || null, slides, userContext, {
        onStageChange: (stage) => {
          if (stage === 'processing') {
            setStatus(AppStatus.PROCESSING);
          }
        },
        onUploadComplete: (urls) => {
          setPendingBlobUrls(urls);
          setUploadCheckpoint(formatUploadCheckpoint(urls.length));
        },
        access: access || undefined,
        modelId
      });
      setResult(analysis);
      setStatus(AppStatus.COMPLETED);
      setPendingBlobUrls([]);
      setUploadCheckpoint(null);
      setChatMessages([]);
      chatSessionRef.current = null; 
    } catch (err: any) {
      console.error(err);
      const message = err.message || "An unexpected error occurred during analysis.";
      const lowerMessage = message.toLowerCase();
      if (lowerMessage.includes('access code') || lowerMessage.includes('demo code') || lowerMessage.includes('unauthorized')) {
        setError(`${message} Click "Lock" to enter a new access code.`);
        if (result) {
          setStatus(AppStatus.COMPLETED);
        } else {
          setStatus(AppStatus.ERROR);
        }
        return;
      }
      setError(message);
      setStatus(AppStatus.ERROR);
      setUploadCheckpoint(null);
    }
  };

  const handleCancelProcessing = () => {
    if (window.confirm("Stop processing? The current analysis will be lost.")) {
      setStatus(AppStatus.IDLE);
    }
  };

  const handleResetClick = () => setShowResetConfirm(true);

  const handleConfirmReset = () => {
    void cleanupPendingUploads(access);
    setAudioFile(null);
    setSlideFiles([]);
    setResult(null);
    setUserContext('');
    setActiveTab('study_guide');
    setStatus(AppStatus.IDLE);
    setError(null);
    setChatMessages([]);
    chatSessionRef.current = null;
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    setShowResetConfirm(false);
  };

  const handleLock = () => {
    void cleanupPendingUploads(access);
    setAccess(null);
  };

  const handleCancelReset = () => setShowResetConfirm(false);

  const handleDownloadMarkdown = () => {
    if (!result) return;
    const blob = new Blob([result.studyGuide], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `StudyGuide_${audioFile?.file.name.split('.')[0] || 'Lecture'}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadTranscript = () => {
    if (!result) return;
    const blob = new Blob([result.transcript], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Transcript_${audioFile?.file.name.split('.')[0] || 'Lecture'}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (isAdminRoute) {
    return <AdminPanel access={access} onAccessChange={setAccess} />;
  }

  if (!access) {
    return <AccessGate onAuthorize={handleAuthorize} error={accessError} redirectAdminTo="/admin" />;
  }

  const isMobileDevice =
    typeof navigator !== 'undefined' ? isMobileUserAgent(navigator.userAgent) : false;
  const enablePlaybackWaveform = shouldEnablePlaybackWaveform(audioInputMode, isMobileDevice);

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 pb-20">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="bg-primary-600 p-1.5 rounded-lg text-white">
              <Icons.BookOpen size={24} />
            </div>
            <h1 className="text-xl font-bold font-serif text-slate-900 tracking-tight">LectureMate AI</h1>
          </div>
          <div className="flex items-center gap-3 text-xs sm:text-sm text-slate-500 font-medium">
            <span className="hidden sm:inline">The Master Tutor</span>
            <span className="sm:hidden">Tutor</span>
            <button
              type="button"
              onClick={handleLock}
              className="text-xs sm:text-sm font-normal text-slate-500 border border-slate-200 rounded-full px-3 py-1 hover:text-slate-700 hover:border-slate-300 hover:bg-slate-50"
            >
              Lock
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 mt-8 md:mt-12">
        {/* Intro */}
        {status === AppStatus.IDLE && (
          <div className="text-center mb-8 md:mb-10">
            <h2 className="text-3xl md:text-4xl font-serif font-bold text-slate-900 mb-3 md:mb-4">
              Comprehensive <span className="text-primary-600">Lecture Synthesis</span>
            </h2>
            <p className="text-base md:text-lg text-slate-600 max-w-2xl mx-auto px-4">
              Combine your lecture audio, slides, and notes. Our AI synthesizes them into a single, exam-ready study guide.
            </p>
          </div>
        )}

        {/* Error */}
        {status === AppStatus.ERROR && (
          <div className="max-w-2xl mx-auto mb-8 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
            <div className="flex items-center space-x-3 text-red-700">
              <Icons.AlertCircle />
              <span>{error}</span>
            </div>
            <button 
              onClick={() => setStatus(AppStatus.IDLE)}
              className="text-sm font-semibold text-red-800 hover:text-red-900 underline"
            >
              Try Again
            </button>
          </div>
        )}

        {/* INPUT FORM - Only show when IDLE */}
        {status === AppStatus.IDLE && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8 animate-fade-in items-stretch">
            <div className="md:col-span-2 bg-white border border-slate-200 rounded-2xl p-5 text-sm text-slate-600">
              <h3 className="text-sm font-semibold text-slate-800 mb-2">Quick Usage Notes</h3>
              <ul className="space-y-1">
                <li>Audio formats: MP3, WAV, M4A, MP4, MOV, WEBM.</li>
                <li>Slides: Multiple PDFs are supported.</li>
                <li>Browser recording supports system audio on desktop only, Chrome or Edge recommended.</li>
                <li>When recording system audio, share the entire screen for best results.</li>
                <li>Prefer third-party recording for quality, OBS Studio is recommended.</li>
              </ul>
              <p className="mt-3 text-xs text-slate-500">
                Client warrants they own the copyright or have a license to the content they process. Client
                indemnifies Yauheni Futryn against any copyright claims arising from their uploads.
              </p>
            </div>
            
            {/* 1. Audio Source */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col h-full">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-semibold text-slate-800 flex items-center gap-2 text-base">
                  <Icons.FileAudio size={20} className="text-primary-600" />
                  Lecture Recording <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${audioRequired ? 'text-red-600 bg-red-50' : 'text-slate-600 bg-slate-100'}`}>{audioRequired ? 'Required' : 'Optional'}</span>
                </h3>
                {!audioFile && (
                  <div className="flex bg-slate-100 rounded-lg p-1 h-9 items-center">
                    <button 
                      onClick={() => setAudioInputMode('upload')}
                      className={`px-3 h-full text-xs font-medium rounded-[0.375rem] transition-all flex items-center ${audioInputMode === 'upload' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      Upload
                    </button>
                    <button 
                       onClick={() => setAudioInputMode('record')}
                       className={`px-3 h-full text-xs font-medium rounded-[0.375rem] transition-all flex items-center ${audioInputMode === 'record' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      Record
                    </button>
                  </div>
                )}
              </div>

              <div className="flex-1 min-h-[260px] flex flex-col relative">
                {!audioFile ? (
                   audioInputMode === 'upload' ? (
                     <FileUpload 
                       onFileSelect={handleAudioSelect} 
                       accept="audio/*"
                       label="Upload Audio or Video"
                       subLabel="Recommended: < 100 MB"
                     />
                   ) : (
                     <AudioRecorder onRecordingComplete={handleRecordingComplete} />
                   )
                ) : (
                  <div className="h-full flex flex-col justify-center space-y-4 border-2 border-dashed border-slate-200 rounded-[1.5rem] bg-slate-50/50 p-6">
                     <div className="bg-white rounded-xl p-4 flex items-center justify-between shadow-sm border border-slate-100">
                        <div className="flex items-center gap-3 overflow-hidden">
                          <div className="bg-primary-100 p-2 rounded-lg text-primary-600">
                            <Icons.FileAudio size={20} />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-slate-800 truncate text-sm">{audioFile.file.name}</p>
                            <p className="text-xs text-slate-500">{(audioFile.file.size / (1024*1024)).toFixed(2)} MB</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => setAudioFile(null)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                            <Icons.X size={18} />
                          </button>
                        </div>
                     </div>
                     
                     {/* New Audio Player Component */}
                     <AudioPlayer
                       file={audioFile.file}
                       previewUrl={audioFile.previewUrl}
                       enableWaveform={enablePlaybackWaveform}
                     />
                  </div>
                )}
              </div>
            </div>

            {/* 2. Slides Source */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col h-full">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-semibold text-slate-800 flex items-center gap-2 text-base">
                  <Icons.FileText size={20} className="text-primary-600" />
                  Lecture Slides <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full uppercase tracking-wider">Optional</span>
                </h3>
              </div>

              <div className="flex-1 min-h-[260px] flex flex-col relative">
                {slideFiles.length === 0 ? (
                  <FileUpload 
                    onFileSelect={handleSlideSelect} 
                    accept=".pdf"
                    multiple={true}
                    label="Upload Slides"
                    subLabel="PDF format only (Multiple allowed)"
                    icon={<Icons.FileText size={32} />}
                  />
                ) : (
                  <div className="h-full flex flex-col border-2 border-dashed border-slate-200 rounded-[1.5rem] bg-slate-50/50 p-6">
                     <div className="flex-1 overflow-y-auto max-h-[200px] space-y-2 pr-1 custom-scrollbar">
                       {slideFiles.map((file) => (
                         <div key={file.id} className="bg-white rounded-lg p-3 flex items-center justify-between border border-slate-100 shadow-sm">
                            <div className="flex items-center gap-3 overflow-hidden">
                              <div className="bg-orange-100 p-1.5 rounded-lg text-orange-600">
                                <Icons.FileText size={16} />
                              </div>
                              <div className="min-w-0">
                                <p className="font-medium text-slate-800 truncate text-xs">{file.file.name}</p>
                              </div>
                            </div>
                            <button onClick={() => removeSlide(file.id!)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors">
                              <Icons.X size={16} />
                            </button>
                         </div>
                       ))}
                     </div>
                     <div className="mt-4 pt-4 border-t border-slate-200/50">
                       <div className="flex items-center justify-between">
                         <span className="text-xs font-medium text-slate-500">{slideFiles.length} file{slideFiles.length !== 1 && 's'} attached</span>
                         <label className="text-primary-600 text-xs cursor-pointer hover:text-primary-700 font-semibold bg-white px-3 py-1.5 rounded-lg border border-primary-100 shadow-sm transition-all hover:shadow-md flex items-center gap-1">
                            <Icons.UploadCloud size={14} />
                            Add more
                            <input type="file" accept=".pdf" multiple className="hidden" onChange={(e) => {
                               if(e.target.files && e.target.files.length > 0) {
                                 const newFiles: FileData[] = [];
                                 const fileList = e.target.files;
                                 for (let i = 0; i < fileList.length; i++) {
                                   const f = fileList[i];
                                   newFiles.push({ file: f, previewUrl: URL.createObjectURL(f), id: Math.random().toString(36).substring(7) });
                                 }
                                 handleSlideSelect(newFiles);
                               }
                            }}/>
                         </label>
                       </div>
                     </div>
                  </div>
                )}
              </div>
            </div>

            {/* 3. Model Selection */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 md:col-span-2">
              <h3 className="font-semibold text-slate-800 flex items-center gap-2 mb-4 text-base">
                <Icons.Sparkles size={20} className="text-primary-600" />
                Model Selection <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full uppercase tracking-wider">Manual</span>
              </h3>
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={() => setModelId('gemini-2.5-flash')}
                  className={`flex-1 px-4 py-3 rounded-xl border text-left transition-all ${
                    modelId === 'gemini-2.5-flash'
                      ? 'border-primary-500 bg-primary-50 text-primary-800 shadow-sm'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <div className="text-sm font-semibold">Fast</div>
                  <div className="text-xs text-slate-500">Gemini 2.5 Flash. Best speed for most lectures.</div>
                </button>
                <button
                  type="button"
                  onClick={() => setModelId('gemini-2.5-pro')}
                  className={`flex-1 px-4 py-3 rounded-xl border text-left transition-all ${
                    modelId === 'gemini-2.5-pro'
                      ? 'border-primary-500 bg-primary-50 text-primary-800 shadow-sm'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <div className="text-sm font-semibold">Pro</div>
                  <div className="text-xs text-slate-500">Gemini 2.5 Pro. Higher quality, slower.</div>
                </button>
              </div>
            </div>

            {/* 4. User Context */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 md:col-span-2">
               <h3 className="font-semibold text-slate-800 flex items-center gap-2 mb-4 text-base">
                <Icons.BookOpen size={20} className="text-primary-600" />
                Focus & Instructions <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full uppercase tracking-wider">Optional</span>
              </h3>
              <textarea
                value={userContext}
                onChange={(e) => setUserContext(e.target.value)}
                placeholder="Example: Focus heavily on the math behind margin calls..."
                className="w-full h-24 rounded-xl border-slate-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 text-sm p-4 border resize-none bg-white text-slate-900 placeholder:text-slate-400"
              />
            </div>

            {/* Generate Button */}
            <div className="md:col-span-2">
              <button
                onClick={handleGenerate}
                disabled={!audioFile && slideFiles.length === 0}
                className={`
                  w-full py-4 px-6 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all shadow-lg
                  ${audioFile || slideFiles.length > 0
                    ? 'bg-gradient-to-r from-primary-600 to-primary-700 text-white hover:shadow-xl hover:-translate-y-0.5' 
                    : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'}
                `}
              >
                <Icons.FileText size={22} />
                <span>Generate Master Study Guide</span>
              </button>
            </div>
          </div>
        )}

        {/* Processing State */}
        {(status === AppStatus.UPLOADING || status === AppStatus.PROCESSING) && (
          <ProcessingState onCancel={handleCancelProcessing} uploadCheckpoint={uploadCheckpoint} />
        )}

        {/* Results View */}
        {status === AppStatus.COMPLETED && result && (
          <div className="animate-fade-in space-y-6">
             {error && (
               <div className="bg-amber-50 border border-amber-200 text-amber-700 text-sm rounded-lg px-4 py-3">
                 {error}
               </div>
             )}
             <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-serif font-bold text-slate-900">Analysis Result</h2>
                  <p className="text-slate-500 text-sm">
                    {audioFile && slideFiles.length > 0
                      ? `Based on audio & ${slideFiles.length} slides`
                      : audioFile
                        ? 'Based on audio analysis'
                        : `Based on ${slideFiles.length} slide${slideFiles.length === 1 ? '' : 's'}`
                    }
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {showResetConfirm ? (
                    <div className="flex items-center gap-2 animate-fade-in">
                        <span className="text-sm text-slate-500 hidden sm:inline">Are you sure?</span>
                        <button 
                            onClick={handleConfirmReset}
                            className="px-3 py-2 text-sm font-bold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
                        >
                            Yes, Reset
                        </button>
                        <button 
                            onClick={handleCancelReset}
                            className="px-3 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                  ) : (
                    <button 
                      onClick={handleResetClick}
                      className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                    >
                      Start Over
                    </button>
                  )}

                  {activeTab === 'study_guide' ? (
                    <button 
                      onClick={handleDownloadMarkdown}
                      className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 shadow-sm transition-colors"
                    >
                      <Icons.Download size={16} />
                      <span className="hidden sm:inline">Download Notes</span>
                      <span className="sm:hidden">Notes</span>
                    </button>
                  ) : (
                    <button 
                      onClick={handleDownloadTranscript}
                      className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-white bg-slate-700 rounded-lg hover:bg-slate-800 shadow-sm transition-colors"
                    >
                      <Icons.Download size={16} />
                      <span className="hidden sm:inline">Download Transcript</span>
                      <span className="sm:hidden">Transcript</span>
                    </button>
                  )}
                </div>
             </div>

             {/* Tabs */}
             <div className="flex border-b border-slate-200">
               <button
                 onClick={() => setActiveTab('study_guide')}
                 className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                   activeTab === 'study_guide' 
                     ? 'border-primary-600 text-primary-700' 
                     : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                 }`}
               >
                 <Icons.BookOpen size={18} />
                 Study Guide
               </button>
               <button
                 onClick={() => setActiveTab('transcript')}
                 className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                   activeTab === 'transcript' 
                     ? 'border-primary-600 text-primary-700' 
                     : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                 }`}
               >
                 <Icons.FileText size={18} />
                 Raw Transcript
               </button>
               <button
                 onClick={() => setActiveTab('chat')}
                 className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                   activeTab === 'chat' 
                     ? 'border-primary-600 text-primary-700' 
                     : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                 }`}
               >
                 <Icons.Mic size={18} />
                 Chat with Tutor
               </button>
             </div>

            {/* Tab Content */}
            {activeTab === 'study_guide' && (
              <StudyGuide content={result.studyGuide} />
            )}
            
            {activeTab === 'transcript' && (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 md:p-8">
                 <h3 className="text-lg font-bold text-slate-800 mb-4 font-serif">Verbatim Audio Transcript</h3>
                 <div className="prose prose-slate max-w-none text-slate-600 whitespace-pre-wrap font-mono text-sm leading-relaxed bg-slate-50 p-4 rounded-lg border border-slate-100">
                   {result.transcript}
                 </div>
              </div>
            )}
            
            {activeTab === 'chat' && (
              <ChatInterface 
                chatSession={chatSessionRef.current} 
                initialMessages={chatMessages}
                onHistoryUpdate={setChatMessages}
              />
            )}
          </div>
        )}
      </main>
      <footer className="mt-10 text-center text-xs text-slate-400">
        Copyright 2026 Yauheni Futryn. All rights reserved.
      </footer>
    </div>
  );
};

export default App;
