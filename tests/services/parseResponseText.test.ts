import { describe, it, expect } from 'vitest';
import { parseResponseText } from '../../services/geminiService';

describe('parseResponseText', () => {
  it('splits guide and transcript', () => {
    const raw = '===STUDY_GUIDE===Guide===TRANSCRIPT===Transcript';
    const { studyGuide, transcript } = parseResponseText(raw);
    expect(studyGuide).toBe('Guide');
    expect(transcript).toBe('Transcript');
  });

  it('splits transcript, slides, and raw notes when present', () => {
    const raw =
      '===STUDY_GUIDE===Guide===TRANSCRIPT===Transcript===SLIDES===Slides===RAW_NOTES===Notes';
    const result = parseResponseText(raw);
    expect(result.studyGuide).toBe('Guide');
    expect(result.transcript).toBe('Transcript');
    expect(result.slides).toBe('Slides');
    expect(result.rawNotes).toBe('Notes');
  });
});
