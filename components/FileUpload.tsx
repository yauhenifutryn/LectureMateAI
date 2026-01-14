import React, { useCallback, useState } from 'react';
import { Icons } from './Icon';
import { FileData } from '../types';

interface FileUploadProps {
  onFileSelect: (files: FileData[]) => void;
  disabled?: boolean;
  accept: string;
  label: string;
  subLabel: string;
  icon?: React.ReactNode;
  multiple?: boolean;
}

const FileUpload: React.FC<FileUploadProps> = ({ 
  onFileSelect, 
  disabled, 
  accept, 
  label, 
  subLabel,
  icon,
  multiple = false
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const processFiles = (fileList: FileList | File[]) => {
    setError(null);
    const filesArray = Array.from(fileList);
    const validFiles: FileData[] = [];

    for (const file of filesArray) {
       let isValid = false;
       const type = file.type.toLowerCase();
       const name = file.name.toLowerCase();
       
       if (accept === "audio/*") {
         if (
           type.startsWith("audio/") || 
           type.startsWith("video/") || 
           name.endsWith('.mp3') || 
           name.endsWith('.wav') || 
           name.endsWith('.m4a') || 
           name.endsWith('.aac') || 
           name.endsWith('.mp4') || 
           name.endsWith('.mov') || 
           name.endsWith('.mkv') || 
           name.endsWith('.webm')
         ) {
           isValid = true;
         }
       } else if (accept === ".pdf") {
         if (type === "application/pdf" || name.endsWith('.pdf')) isValid = true;
       }

       if (!isValid) {
         setError(`Unsupported type: ${file.name}`);
         continue; 
       }

       if (file.size > 2 * 1024 * 1024 * 1024) {
         setError(`File too large: ${file.name} (Max 2GB).`);
         continue;
       }

       const previewUrl = URL.createObjectURL(file);
       validFiles.push({
         file,
         previewUrl,
         id: Math.random().toString(36).substring(7)
       });
    }

    if (validFiles.length > 0) {
      if (!multiple) {
        onFileSelect([validFiles[0]]);
      } else {
        onFileSelect(validFiles);
      }
    }
  };

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);
      if (disabled) return;
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) processFiles(e.dataTransfer.files);
    },
    [disabled, accept, multiple]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!disabled) setIsDragOver(true);
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) processFiles(e.target.files);
  };

  const fileInputAccept = accept === "audio/*" 
    ? "audio/*,video/*,.mp3,.wav,.m4a,.aac,.mp4,.mov,.mkv,.webm" 
    : accept;

  return (
    <div className="w-full h-full">
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`relative group border-2 border-dashed rounded-[1.5rem] p-4 md:p-8 transition-all h-full flex flex-col items-center justify-center ${
          isDragOver ? 'border-primary-500 bg-primary-50/50' : 'border-slate-300 hover:border-primary-400 hover:bg-slate-50/50'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <input
          type="file"
          accept={fileInputAccept}
          multiple={multiple}
          onChange={handleInputChange}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
          disabled={disabled}
        />
        
        <div className="flex flex-col items-center justify-center space-y-4 text-center mx-auto max-w-xs">
          <div className="p-4 rounded-full bg-slate-100 text-slate-400 group-hover:bg-primary-50 group-hover:text-primary-500 transition-colors">
            {icon || <Icons.UploadCloud size={28} />}
          </div>
          <div className="space-y-1 text-center w-full">
            <h3 className="text-base font-semibold text-slate-700 text-center">{label}</h3>
            <p className="text-xs text-slate-500 font-medium text-center">{subLabel}</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-2 p-3 bg-red-50 text-red-700 rounded-lg flex items-center space-x-2 border border-red-100 animate-fade-in">
          <Icons.AlertCircle size={16} />
          <span className="text-xs font-medium">{error}</span>
        </div>
      )}
    </div>
  );
};

export default FileUpload;