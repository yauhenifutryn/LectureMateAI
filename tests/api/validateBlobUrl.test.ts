import { describe, it, expect } from 'vitest';
import { validateObjectName } from '../../api/_lib/gcs';

describe('validateObjectName', () => {
  it('accepts upload objects', () => {
    expect(() => validateObjectName('uploads/job-1/audio.mp3')).not.toThrow();
  });

  it('accepts result objects', () => {
    expect(() => validateObjectName('results/job-1/study-guide.md')).not.toThrow();
  });

  it('rejects traversal', () => {
    expect(() => validateObjectName('../secrets')).toThrow(/invalid object name/i);
  });
});
