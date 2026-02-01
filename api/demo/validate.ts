import '../_lib/warnings.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { AccessError, recordDemoValidation, validateDemoCode } from '../_lib/access.js';

type ValidateBody = {
  code?: string;
};

function parseBody(req: VercelRequest): ValidateBody {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    return JSON.parse(req.body) as ValidateBody;
  }
  return req.body as ValidateBody;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { code: 'method_not_allowed', message: 'POST required.' } });
  }

  try {
    const { code } = parseBody(req);
    if (!code) {
      return res.status(400).json({ error: { code: 'missing_code', message: 'Code required.' } });
    }

    const adminPassword = process.env.ADMIN_PASSWORD || '';
    if (adminPassword && code === adminPassword) {
      return res.status(200).json({ mode: 'admin' });
    }

    const remaining = await validateDemoCode(code);
    if (remaining === null) {
      return res
        .status(401)
        .json({ error: { code: 'invalid_code', message: 'Invalid or exhausted demo code.' } });
    }

    await recordDemoValidation(code);
    return res.status(200).json({ remaining, mode: 'demo' });
  } catch (error) {
    if (error instanceof AccessError) {
      return res.status(401).json({ error: { code: error.code, message: error.message } });
    }
    const message = error instanceof Error ? error.message : 'Invalid code.';
    return res.status(500).json({ error: { code: 'kv_error', message } });
  }
}
