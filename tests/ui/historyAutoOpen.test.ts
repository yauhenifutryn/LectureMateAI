import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('history auto-open behavior', () => {
  it('does not auto-open the previous session after login', () => {
    const appSource = fs.readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');

    expect(appSource).not.toContain('await handleResumeJob(data.activeJob)');
    expect(appSource).not.toContain('await handleOpenHistory(items[0])');
  });
});
