import { describe, it, expect } from 'vitest';
import { parseResponseText } from '../../services/geminiService';

describe('parseResponseText', () => {
  it('splits guide and transcript', () => {
    const raw = '===STUDY_GUIDE===Guide===TRANSCRIPT===Transcript';
    const { studyGuide, transcript } = parseResponseText(raw);
    expect(studyGuide).toBe('Guide');
    expect(transcript).toBe('Transcript');
  });
});
