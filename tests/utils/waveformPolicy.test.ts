import { describe, expect, it } from 'vitest';
import { shouldEnableUploadWaveform } from '../../utils/waveformPolicy';

describe('shouldEnableUploadWaveform', () => {
  it('returns true when size is within limit', () => {
    expect(shouldEnableUploadWaveform(10, 100)).toBe(true);
  });

  it('returns false when size exceeds limit', () => {
    expect(shouldEnableUploadWaveform(101, 100)).toBe(false);
  });
});
