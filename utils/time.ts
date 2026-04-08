export function getElapsedSeconds(startMs: number, nowMs: number): number {
  if (!Number.isFinite(startMs) || !Number.isFinite(nowMs)) return 0;
  return Math.max(0, Math.floor((nowMs - startMs) / 1000));
}

export function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
