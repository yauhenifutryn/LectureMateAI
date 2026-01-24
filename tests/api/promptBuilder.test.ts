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
});
