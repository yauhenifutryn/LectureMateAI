import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getStore } from './_lib/store/index.js';

// Deep health probe: this endpoint must FAIL when the data store is unreachable,
// so uptime monitoring detects store outages instead of only confirming that HTML
// still serves. We call hitRateLimit directly (a real write+read transaction) rather
// than enforceRateLimit, because that helper intentionally fails open on store errors
// (in-memory fallback) and would mask exactly the outage we are trying to detect.
// The huge limit guarantees the probe never reports a request as disallowed.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: { code: 'method_not_allowed', message: 'GET required.' } });
  }

  try {
    await getStore().hitRateLimit('healthz-probe', 1_000_000, 60);
    return res.status(200).json({ ok: true, store: process.env.STORE_BACKEND || 'firestore' });
  } catch (error) {
    // Log the real cause server-side only; never leak the raw error to the response.
    console.error('healthz store probe failed:', error instanceof Error ? error.message : error);
    return res
      .status(503)
      .json({ ok: false, error: { code: 'store_unreachable', message: 'Data store probe failed.' } });
  }
}
