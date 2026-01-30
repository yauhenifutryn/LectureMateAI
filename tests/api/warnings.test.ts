import { describe, expect, it, vi } from 'vitest';
import { installWarningFilter } from '../../api/_lib/warnings';

describe('installWarningFilter', () => {
  it('suppresses DEP0169 warnings and logs others', async () => {
    vi.resetModules();
    const originalOn = process.on.bind(process);
    const handlers: ((warning: any) => void)[] = [];
    const onSpy = vi.spyOn(process, 'on').mockImplementation((event, handler) => {
      if (event === 'warning') {
        handlers.push(handler as (warning: any) => void);
      }
      return process as unknown as NodeJS.Process;
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { installWarningFilter: install } = await import('../../api/_lib/warnings');
    install();

    expect(handlers.length).toBeGreaterThan(0);

    handlers.forEach((handler) =>
      handler({ name: 'DeprecationWarning', code: 'DEP0169', message: 'legacy' })
    );
    expect(warnSpy).not.toHaveBeenCalled();

    handlers.forEach((handler) =>
      handler({ name: 'DeprecationWarning', code: 'OTHER', message: 'other warning' })
    );
    expect(warnSpy).toHaveBeenCalled();

    onSpy.mockRestore();
    warnSpy.mockRestore();
    process.on = originalOn;
  });
});
