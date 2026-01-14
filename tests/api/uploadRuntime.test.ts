import { describe, it, expect } from 'vitest';
import { config } from '../../api/upload';

describe('upload runtime', () => {
  it('uses nodejs runtime for blob upload', () => {
    expect(config.runtime).toBe('nodejs');
  });
});
