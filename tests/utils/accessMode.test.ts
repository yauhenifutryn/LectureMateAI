import { describe, expect, it } from 'vitest';
import { resolveAccessMode } from '../../utils/accessMode';

describe('resolveAccessMode', () => {
  it('keeps admin when requested admin', () => {
    expect(resolveAccessMode('admin', 'admin')).toBe('admin');
  });

  it('upgrades demo to admin when response indicates admin', () => {
    expect(resolveAccessMode('demo', 'admin')).toBe('admin');
  });

  it('keeps demo when no response mode provided', () => {
    expect(resolveAccessMode('demo')).toBe('demo');
  });
});
