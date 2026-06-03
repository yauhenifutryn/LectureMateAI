// tests/store/types.test.ts
import { describe, expect, it } from 'vitest';
import type { AppStore } from '../../api/_lib/store/types';

describe('AppStore contract', () => {
  it('declares the required domain methods', () => {
    const methods: Array<keyof AppStore> = [
      'isConfigured',
      'hitRateLimit',
      'setDemoCode',
      'getDemoRemaining',
      'consumeDemoCode',
      'revokeDemoCode',
      'listDemoCodes',
      'appendEvent',
      'listEvents',
      'setJob',
      'getJob',
      'setActiveJob',
      'getActiveJob',
      'clearActiveJob',
      'acquireLease',
      'getLease',
      'releaseLease',
      'appendHistory',
      'listHistory'
    ];
    expect(methods.length).toBe(19);
  });
});
