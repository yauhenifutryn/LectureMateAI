import { describe, expect, it } from 'vitest';
import { buildPrompt } from '../../api/_lib/promptBuilder';

describe('buildPrompt', () => {
  it('keeps system prompt and user context', () => {
    const prompt = buildPrompt({
      systemPrompt: 'SYSTEM',
      userContext: 'Focus on leverage.',
      hasAudio: true,
      hasSlides: false,
      hasRawNotes: false
    });

    expect(prompt).toContain('SYSTEM');
    expect(prompt).toContain('Focus on leverage.');
  });

  it('lists transcript as the only allowed source when audio only', () => {
    const prompt = buildPrompt({
      systemPrompt: 'SYSTEM',
      hasAudio: true,
      hasSlides: false,
      hasRawNotes: false
    });

    expect(prompt).toContain('Allowed Evidence Snapshot sources: Transcript.');
  });

  it('lists slides as the only allowed source when slides only', () => {
    const prompt = buildPrompt({
      systemPrompt: 'SYSTEM',
      hasAudio: false,
      hasSlides: true,
      hasRawNotes: false
    });

    expect(prompt).toContain('Allowed Evidence Snapshot sources: Slides.');
  });

  it('lists transcript and slides when both exist', () => {
    const prompt = buildPrompt({
      systemPrompt: 'SYSTEM',
      hasAudio: true,
      hasSlides: true,
      hasRawNotes: false
    });

    expect(prompt).toContain('Allowed Evidence Snapshot sources: Transcript, Slides.');
  });

  it('adds a compact runtime budget for short transcripts', () => {
    const prompt = buildPrompt({
      systemPrompt: 'SYSTEM\n\nBEGIN NOW',
      hasAudio: true,
      hasSlides: false,
      hasRawNotes: false,
      transcriptText: 'word '.repeat(900)
    });

    expect(prompt).toContain('CONTENT BUDGET (RUNTIME)');
    expect(prompt).toContain('Transcript word count estimate: 900.');
    expect(prompt).toContain('Lecture size class: short.');
    expect(prompt).toContain('Executive Summary: 4 to 6 lines.');
    expect(prompt).toContain('Key Takeaways: 5 to 8 bullets.');
    expect(prompt).toContain('Core Concepts: 3 to 5 concepts.');
    expect(prompt).toContain('Deal Walkthrough: 4 to 6 steps.');
  });

  it('adds an expanded runtime budget for very long transcripts', () => {
    const prompt = buildPrompt({
      systemPrompt: 'SYSTEM\n\nBEGIN NOW',
      hasAudio: true,
      hasSlides: true,
      hasRawNotes: false,
      transcriptText: 'word '.repeat(15000)
    });

    expect(prompt).toContain('CONTENT BUDGET (RUNTIME)');
    expect(prompt).toContain('Transcript word count estimate: 15000.');
    expect(prompt).toContain('Lecture size class: very_long.');
    expect(prompt).toContain('Executive Summary: 10 to 14 lines.');
    expect(prompt).toContain('Key Takeaways: 12 to 18 bullets.');
    expect(prompt).toContain('Core Concepts: 7 to 10 concepts.');
    expect(prompt).toContain('Deal Walkthrough: 8 to 12 steps.');
  });

  it('tells the model to write in the transcript language with English fallback', () => {
    const prompt = buildPrompt({
      systemPrompt: 'SYSTEM\n\nBEGIN NOW',
      hasAudio: true,
      hasSlides: true,
      hasRawNotes: false,
      transcriptText: 'To jest wyklad o strukturze kapitalowej i wycenie przedsiebiorstwa.'
    });

    expect(prompt).toContain('OUTPUT LANGUAGE (RUNTIME)');
    expect(prompt).toContain('Write the study guide in the dominant language of the transcript, which should match the audio language.');
    expect(prompt).toContain('If the transcript language is unclear or unsupported for high-quality output, fall back softly to English.');
    expect(prompt).toContain('Do not switch the study-guide language to match slide language when slides differ from the transcript.');
  });
});
