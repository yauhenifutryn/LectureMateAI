export type AudioInputMode = 'record' | 'upload';

export function shouldEnablePlaybackWaveform(
  inputMode: AudioInputMode,
  isMobile: boolean
): boolean {
  if (isMobile) return false;
  return inputMode === 'record';
}
