import { describe, expect, it, vi } from 'vitest';
import { cleanupUploadedFiles } from '../../services/geminiService';
import type { AccessContext } from '../../types';

describe('cleanupUploadedFiles', () => {
  it('skips when no urls', async () => {
    const fetchMock = vi.fn();
    // @ts-expect-error test override
    global.fetch = fetchMock;

    await cleanupUploadedFiles([], { mode: 'demo', token: 'CODE' } as AccessContext);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends demo code in body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    // @ts-expect-error test override
    global.fetch = fetchMock;

    await cleanupUploadedFiles(['https://blob/a'], { mode: 'demo', token: 'CODE' } as AccessContext);

    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body as string);

    expect(body.demoCode).toBe('CODE');
    expect(body.urls).toEqual(['https://blob/a']);
  });

  it('uses authorization header for admin', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    // @ts-expect-error test override
    global.fetch = fetchMock;

    await cleanupUploadedFiles(['https://blob/a'], { mode: 'admin', token: 'SECRET' } as AccessContext);

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.Authorization).toBe('Bearer SECRET');
  });
});
