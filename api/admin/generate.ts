import type { VercelRequest, VercelResponse } from '@vercel/node';
import { generateDemoCode, requireAdmin, storeDemoCode } from '../_lib/access.js';

type GenerateBody = {
  uses?: number;
};

function parseBody(req: VercelRequest): GenerateBody {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    return JSON.parse(req.body) as GenerateBody;
  }
  return req.body as GenerateBody;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { code: 'method_not_allowed', message: 'POST required.' } });
  }

  try {
    requireAdmin(req);
    const { uses } = parseBody(req);
    const finalUses = Number.isFinite(uses) && uses && uses > 0 ? Math.floor(uses) : 3;
    const code = generateDemoCode();
    await storeDemoCode(code, finalUses);

    return res.status(200).json({ code, uses: finalUses });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized.';
    return res.status(401).json({ error: { code: 'unauthorized', message } });
  }
}
