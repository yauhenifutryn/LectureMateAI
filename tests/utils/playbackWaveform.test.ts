import { describe, expect, it } from 'vitest';
import { shouldEnablePlaybackWaveform } from '../../utils/playbackWaveform';

describe('shouldEnablePlaybackWaveform', () => {
  it('enables waveform for recording mode', () => {
    expect(shouldEnablePlaybackWaveform('record', false)).toBe(true);
  });

  it('disables waveform for upload mode', () => {
    expect(shouldEnablePlaybackWaveform('upload', false)).toBe(false);
  });

  it('disables waveform on mobile', () => {
    expect(shouldEnablePlaybackWaveform('record', true)).toBe(false);
  });
});
