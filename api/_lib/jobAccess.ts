import type { VercelRequest } from '@vercel/node';
import { AccessError, normalizeDemoCode, requireAdmin } from './access.js';
import type { JobAccess } from './jobStore.js';

export function authorizeJobAccess(
  req: VercelRequest,
  access: JobAccess,
  demoCode?: string
): void {
  if (access.mode === 'admin') {
    requireAdmin(req);
    return;
  }

  if (!demoCode) {
    throw new AccessError('missing_access_code', 'Access code required.', 401);
  }

  const normalized = normalizeDemoCode(demoCode);
  if (!access.code || normalized !== access.code) {
    throw new AccessError('invalid_access_code', 'Invalid access code.', 403);
  }
}
