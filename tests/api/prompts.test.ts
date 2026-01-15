import { describe, it, expect } from 'vitest';
import { getSystemInstruction } from '../../api/_lib/prompts';

describe('getSystemInstruction', () => {
  it('returns the prompt from the environment', () => {
    const previous = process.env.SYSTEM_INSTRUCTIONS;
    process.env.SYSTEM_INSTRUCTIONS = 'test prompt';
    try {
      expect(getSystemInstruction()).toBe('test prompt');
    } finally {
      if (previous === undefined) {
        delete process.env.SYSTEM_INSTRUCTIONS;
      } else {
        process.env.SYSTEM_INSTRUCTIONS = previous;
      }
    }
  });

  it('throws when the prompt is missing', () => {
    const previous = process.env.SYSTEM_INSTRUCTIONS;
    delete process.env.SYSTEM_INSTRUCTIONS;
    try {
      expect(() => getSystemInstruction()).toThrow('Missing SYSTEM_INSTRUCTIONS.');
    } finally {
      if (previous !== undefined) {
        process.env.SYSTEM_INSTRUCTIONS = previous;
      }
    }
  });
});
