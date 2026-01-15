export function isPollingExpired(startMs: number, nowMs: number, timeoutMs: number): boolean {
  if (timeoutMs <= 0) return false;
  return nowMs - startMs >= timeoutMs;
}
