import type { VercelRequest, VercelResponse } from '@vercel/node';
import { AccessError, listAccessEvents, requireAdmin } from '../_lib/access.js';

type EventsQuery = {
  limit?: string;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: { code: 'method_not_allowed', message: 'GET required.' } });
  }

  try {
    requireAdmin(req);
    const { limit } = req.query as EventsQuery;
    const parsed = limit ? Number.parseInt(limit, 10) : 50;
    const events = await listAccessEvents(Number.isFinite(parsed) ? parsed : 50);
    return res.status(200).json({ events });
  } catch (error) {
    if (error instanceof AccessError) {
      return res.status(401).json({ error: { code: error.code, message: error.message } });
    }
    const message = error instanceof Error ? error.message : 'Unable to load events.';
    return res.status(500).json({ error: { code: 'kv_error', message } });
  }
}
