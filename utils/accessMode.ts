import type { AccessMode } from '../types';

export function resolveAccessMode(
  requested: AccessMode,
  responseMode?: AccessMode
): AccessMode {
  if (responseMode === 'admin') return 'admin';
  return requested;
}
