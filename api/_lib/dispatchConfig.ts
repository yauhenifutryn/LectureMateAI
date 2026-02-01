const DEFAULT_DISPATCH_TIMEOUT_MS = 5000;

export function getDispatchTimeoutMs(): number {
  const raw = Number(process.env.WORKER_DISPATCH_TIMEOUT_MS ?? DEFAULT_DISPATCH_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_DISPATCH_TIMEOUT_MS;
  return raw;
}
