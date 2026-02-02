import React, { useEffect, useState, useRef } from 'react';
import { Icons } from './Icon';
import { getElapsedSeconds } from '../utils/time';

interface ProcessingStateProps {
  onCancel: () => void;
  uploadCheckpoint?: string | null;
  logMessage?: string | null;
  logTone?: 'info' | 'warning' | 'error';
}

const ProcessingState: React.FC<ProcessingStateProps> = ({
  onCancel,
  uploadCheckpoint,
  logMessage,
  logTone = 'info'
}) => {
  const [progress, setProgress] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    // 1. Elapsed Time Timer
    startTimeRef.current = Date.now();
    setElapsedSeconds(0);

    const timerInterval = setInterval(() => {
      setElapsedSeconds(getElapsedSeconds(startTimeRef.current, Date.now()));
    }, 1000);

    // 2. Asymptotic Progress Bar Logic
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
      clearInterval(progressInterval);
    };
  }, []);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        setElapsedSeconds(getElapsedSeconds(startTimeRef.current, Date.now()));
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
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

      {uploadCheckpoint && (
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-50 rounded-full text-xs font-medium text-emerald-700 mb-4 border border-emerald-100">
          <Icons.Check size={12} />
          <span>{uploadCheckpoint}</span>
        </div>
      )}

      {/* Progress Bar Container */}
      <div className="w-full max-w-md space-y-3">
        {/* Real-time Status */}
        {logMessage && (
          <div className="min-h-[1.5rem]">
            <p
              className={`text-sm font-medium animate-fade-in-up transition-all ${
                logTone === 'error'
                  ? 'text-red-600'
                  : logTone === 'warning'
                    ? 'text-amber-600'
                    : 'text-primary-700'
              }`}
            >
              {logMessage}
            </p>
          </div>
        )}

        {/* The Bar */}
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
          <div 
            className="h-full bg-gradient-to-r from-primary-500 to-primary-600 rounded-full transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          ></div>
        </div>
        
        <div className="animate-fade-in flex flex-col items-center mt-4 space-y-3">
          {elapsedSeconds > 20 && (
            <p className="text-xs text-slate-400">
              Processing large audio files can take 1-3 minutes. <br /> Please do not close this tab.
            </p>
          )}
          <button
            onClick={onCancel}
            className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-1 rounded-md transition-colors font-medium border border-transparent hover:border-red-100"
          >
            Cancel & Go Back
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProcessingState;
