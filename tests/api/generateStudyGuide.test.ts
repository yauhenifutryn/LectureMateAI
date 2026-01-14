import { describe, it, expect } from 'vitest';
import { generateStudyGuide } from '../../api/_lib/gemini';

describe('generateStudyGuide', () => {
  it('is exported for backend usage', () => {
    expect(typeof generateStudyGuide).toBe('function');
  });
});
