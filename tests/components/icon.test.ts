import { describe, expect, it } from 'vitest';
import { Icons } from '../../components/Icon';

describe('Icons map', () => {
  it('exposes Sparkles icon for model selection UI', () => {
    expect(Icons.Sparkles).toBeDefined();
  });
});
