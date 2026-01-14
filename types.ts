
export enum AppStatus {
  IDLE = 'IDLE',
  UPLOADING = 'UPLOADING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR',
}

export interface AnalysisResult {
  studyGuide: string;
  transcript: string;
}

export interface FileData {
  file: File;
  previewUrl: string;
  base64?: string;
  id?: string; // unique id for list management
}

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
  id: string;
  isStreaming?: boolean;
}
