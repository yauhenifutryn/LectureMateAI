import { describe, it, expect } from 'vitest';
import { buildVercelRequest } from '../../server/adapter';

describe('cloud run adapter', () => {
  it('builds query and body from request', async () => {
    const req = new Request('http://localhost/api/process?jobId=123', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ demoCode: 'ABC' })
    });

    const { vercelRequest } = await buildVercelRequest(req);

    expect(vercelRequest.method).toBe('POST');
    expect(vercelRequest.query.jobId).toBe('123');
    expect(vercelRequest.body.demoCode).toBe('ABC');
  });
});
