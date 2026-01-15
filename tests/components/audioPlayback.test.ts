import { describe, expect, it, vi } from 'vitest';
import { resetAudioElement, tryPlayAudio } from '../../components/AudioPlayer';

describe('resetAudioElement', () => {
  it('pauses, resets time, sets src, and loads', () => {
    const audio = {
      src: 'old',
      currentTime: 12,
      pause: vi.fn(),
      load: vi.fn()
    };

    resetAudioElement(audio, 'new-url');

    expect(audio.pause).toHaveBeenCalled();
    expect(audio.currentTime).toBe(0);
    expect(audio.src).toBe('new-url');
    expect(audio.load).toHaveBeenCalled();
  });
});

describe('tryPlayAudio', () => {
  it('returns true when play resolves', async () => {
    const audio = { play: vi.fn().mockResolvedValue(undefined) };
    const logger = { error: vi.fn() };

    const result = await tryPlayAudio(audio, logger);

    expect(result).toBe(true);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('returns false when play rejects', async () => {
    const audio = { play: vi.fn().mockRejectedValue(new Error('blocked')) };
    const logger = { error: vi.fn() };

    const result = await tryPlayAudio(audio, logger);

    expect(result).toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });
});
