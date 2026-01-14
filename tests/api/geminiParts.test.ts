import { describe, it, expect } from 'vitest';
import { buildGenerateParts } from '../../api/_lib/gemini';

describe('buildGenerateParts', () => {
  it('creates separate fileData and text parts', () => {
    const parts = buildGenerateParts(
      [
        { uri: 'file://one', mimeType: 'audio/mpeg' },
        { uri: 'file://two', mimeType: 'application/pdf' }
      ],
      'Prompt text'
    );

    expect(parts.length).toBe(3);
    expect(parts[0]).toEqual({ fileData: { fileUri: 'file://one', mimeType: 'audio/mpeg' } });
    expect(parts[1]).toEqual({ fileData: { fileUri: 'file://two', mimeType: 'application/pdf' } });
    expect(parts[2]).toEqual({ text: 'Prompt text' });
  });
});
