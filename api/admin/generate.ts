import '../_lib/warnings.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  AccessError,
  generateDemoCode,
  normalizeDemoCode,
  requireAdmin,
  storeDemoCode
} from '../_lib/access.js';

type GenerateBody = {
  uses?: number;
  code?: string;
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
    const { uses, code } = parseBody(req);
    const finalUses = Number.isFinite(uses) && uses && uses > 0 ? Math.floor(uses) : 3;
    let normalizedCode = code ? normalizeDemoCode(code) : '';
    if (normalizedCode) {
      if (!/^[A-Z0-9-]{3,32}$/.test(normalizedCode)) {
        return res.status(400).json({
          error: {
            code: 'invalid_code_format',
            message: 'Custom code must be 3-32 characters using A-Z, 0-9, or hyphen.'
          }
        });
      }
    } else {
      normalizedCode = generateDemoCode();
    }

    await storeDemoCode(normalizedCode, finalUses);

    return res.status(200).json({ code: normalizedCode, uses: finalUses });
  } catch (error) {
    if (error instanceof AccessError) {
      return res.status(401).json({ error: { code: error.code, message: error.message } });
    }
    const message = error instanceof Error ? error.message : 'Unable to generate code.';
    return res.status(500).json({ error: { code: 'kv_error', message } });
  }
}
