import { describe, expect, it, vi } from 'vitest';

describe('warnings module auto install', () => {
  it('registers the warning handler on import', async () => {
    vi.resetModules();
    const onSpy = vi.spyOn(process, 'on').mockImplementation((event, handler) => {
      return process as unknown as NodeJS.Process;
    });

    await import('../../api/_lib/warnings');

    expect(onSpy).toHaveBeenCalledWith('warning', expect.any(Function));
    onSpy.mockRestore();
  });
});
