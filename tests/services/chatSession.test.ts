import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initializeChatSession } from '../../services/geminiService';

describe('initializeChatSession', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ reply: 'ok' })
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('includes slides and raw notes in the chat payload', async () => {
    const session = initializeChatSession(
      'transcript',
      'study guide',
      { mode: 'demo', token: 'demo-code' },
      'slide text',
      'raw notes'
    );

    const history = [{ role: 'user', content: 'Question?', id: '1' }];
    const iterator = session.sendMessageStream({ message: 'Question?', history });

    for await (const _chunk of iterator) {
      // consume stream
    }

    const call = fetchMock.mock.calls[0][1] as { body: string };
    const payload = JSON.parse(call.body) as { slides?: string; rawNotes?: string };

    expect(payload.slides).toBe('slide text');
    expect(payload.rawNotes).toBe('raw notes');
  });
});
