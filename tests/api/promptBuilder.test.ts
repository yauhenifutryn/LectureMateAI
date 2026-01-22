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

  it('requires transcript sources when audio only', () => {
    const prompt = buildPrompt({
      systemPrompt: 'SYSTEM',
      hasAudio: true,
      hasSlides: false,
      hasRawNotes: false
    });

    expect(prompt).toContain('Evidence Snapshot sources must be Transcript');
  });

  it('requires slide sources when slides only', () => {
    const prompt = buildPrompt({
      systemPrompt: 'SYSTEM',
      hasAudio: false,
      hasSlides: true,
      hasRawNotes: false
    });

    expect(prompt).toContain('Evidence Snapshot sources must be Slides');
  });

  it('allows transcript or slides when both exist', () => {
    const prompt = buildPrompt({
      systemPrompt: 'SYSTEM',
      hasAudio: true,
      hasSlides: true,
      hasRawNotes: false
    });

    expect(prompt).toContain('Evidence Snapshot sources must be Transcript or Slides');
  });
});
