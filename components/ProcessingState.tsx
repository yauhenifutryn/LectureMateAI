import React, { useEffect, useState } from 'react';
import { Icons } from './Icon';

interface ProcessingStateProps {
  onCancel: () => void;
}

const MESSAGES = [
  "Uploading audio & slides for analysis...",
  "Transcribing 50+ minutes of audio...",
  "Reading slide content...",
  "Connecting concepts to timestamps...",
  "Synthesizing the 'Master Tutor' guide...",
  "Formatting markdown tables...",
  "Finalizing analysis..."
];

const ProcessingState: React.FC<ProcessingStateProps> = ({ onCancel }) => {
  const [progress, setProgress] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    // 1. Elapsed Time Timer
    const timerInterval = setInterval(() => {
      setElapsedSeconds(prev => prev + 1);
    }, 1000);

    // 2. Message Rotator (Change message every 8 seconds)
    const messageInterval = setInterval(() => {
      setMessageIndex(prev => (prev + 1) % MESSAGES.length);
    }, 8000);

    // 3. Asymptotic Progress Bar Logic
    const progressInterval = setInterval(() => {
      setProgress(oldProgress => {
        let increment = 0;
        if (oldProgress < 30) {
          increment = 0.5; // Fast start
        } else if (oldProgress < 60) {
          increment = 0.1; // Steady middle
        } else if (oldProgress < 80) {
          increment = 0.05; // Slowing down
        } else if (oldProgress < 95) {
          increment = 0.01; // Crawling for large files
        } else {
          increment = 0; // asymptotic limit
        }
        
        const newProgress = oldProgress + increment;
        return newProgress > 98 ? 98 : newProgress;
      });
    }, 100);

    return () => {
      clearInterval(timerInterval);
      clearInterval(messageInterval);
      clearInterval(progressInterval);
    };
  }, []);

  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in relative z-20">
      {/* Icon Animation */}
      <div className="relative mb-8">
        <div className="absolute inset-0 bg-primary-500 blur-2xl opacity-20 rounded-full animate-pulse"></div>
        <div className="relative z-10 bg-white p-4 rounded-full shadow-md border border-slate-100">
           <Icons.Loader2 className="w-10 h-10 text-primary-600 animate-spin" />
        </div>
      </div>
      
      {/* Title */}
      <h3 className="text-2xl font-serif font-bold text-slate-800 mb-2">
        Analyzing Lecture
      </h3>
      
      {/* Elapsed Time Badge */}
      <div className="inline-flex items-center gap-2 px-3 py-1 bg-slate-100 rounded-full text-xs font-mono text-slate-600 mb-6 border border-slate-200">
        <Icons.BookOpen size={12} />
        <span>Time Elapsed: {formatTime(elapsedSeconds)}</span>
      </div>

      {/* Progress Bar Container */}
      <div className="w-full max-w-md space-y-3">
        {/* Dynamic Status Text */}
        <div className="h-6 overflow-hidden relative">
          <p key={messageIndex} className="text-sm font-medium text-primary-700 animate-fade-in-up transition-all">
            {MESSAGES[messageIndex]}
          </p>
        </div>

        {/* The Bar */}
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
          <div 
            className="h-full bg-gradient-to-r from-primary-500 to-primary-600 rounded-full transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          ></div>
        </div>
        
        {/* Context info for long waits */}
        {elapsedSeconds > 20 && (
          <div className="animate-fade-in flex flex-col items-center mt-4 space-y-3">
            <p className="text-xs text-slate-400">
              Processing large audio files can take 1-3 minutes. <br/> Please do not close this tab.
            </p>
            <button 
              onClick={onCancel}
              className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-1 rounded-md transition-colors font-medium border border-transparent hover:border-red-100"
            >
              Cancel & Go Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProcessingState;
