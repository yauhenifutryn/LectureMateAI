import { describe, expect, it } from 'vitest';
import { shouldRenderWaveform } from '../../components/AudioPlayer';

describe('shouldRenderWaveform', () => {
  const audioFile = { size: 1024, type: 'audio/mpeg' };
  const nonAudioFile = { size: 1024, type: 'application/pdf' };

  it('returns false when waveform is disabled', () => {
    expect(shouldRenderWaveform(audioFile, false)).toBe(false);
  });

  it('returns false for non-audio files', () => {
    expect(shouldRenderWaveform(nonAudioFile, true)).toBe(false);
  });

  it('returns false when file exceeds max size', () => {
    const largeFile = { size: 999, type: 'audio/mpeg' };
    expect(shouldRenderWaveform(largeFile, true, 100)).toBe(false);
  });

  it('returns true for audio files within limit', () => {
    expect(shouldRenderWaveform(audioFile, true, 10 * 1024)).toBe(true);
  });
});
