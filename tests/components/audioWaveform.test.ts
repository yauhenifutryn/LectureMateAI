import { describe, expect, it } from 'vitest';
import { appendAmplitude, resampleWaveformData } from '../../components/audioWaveform';

describe('appendAmplitude', () => {
  it('appends until max length then trims oldest', () => {
    const start = [0.1, 0.2, 0.3];
    const next = appendAmplitude(start, 0.4, 3);
    expect(next).toEqual([0.2, 0.3, 0.4]);
  });

  it('does not trim when under max', () => {
    const next = appendAmplitude([], 0.5, 3);
    expect(next).toEqual([0.5]);
  });
});

describe('resampleWaveformData', () => {
  it('returns requested length', () => {
    const data = Array.from({ length: 100 }, (_, i) => i / 100);
    const result = resampleWaveformData(data, 10);
    expect(result).toHaveLength(10);
  });

  it('averages segments', () => {
    const data = [0, 0, 1, 1];
    const result = resampleWaveformData(data, 2);
    expect(result).toEqual([0, 1]);
  });
});
