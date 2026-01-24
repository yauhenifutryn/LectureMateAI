import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('system_instructions.txt', () => {
  it('requires SOURCE_APPENDIX_MODE always for transcript output', () => {
    const promptPath = path.join(process.cwd(), 'prompts', 'system_instructions.txt');
    const prompt = fs.readFileSync(promptPath, 'utf8');

    expect(prompt).toContain('SOURCE_APPENDIX_MODE (ALWAYS REQUIRED FOR THIS APP)');
  });

  it('forbids slide citations when slides are missing', () => {
    const promptPath = path.join(process.cwd(), 'prompts', 'system_instructions.txt');
    const prompt = fs.readFileSync(promptPath, 'utf8');

    expect(prompt).toContain('If the SLIDES section is "(No slides provided.)", do not cite Slides.');
  });

  it('requires evidence sources to match runtime availability', () => {
    const promptPath = path.join(process.cwd(), 'prompts', 'system_instructions.txt');
    const prompt = fs.readFileSync(promptPath, 'utf8');

    expect(prompt).toContain(
      'Evidence Snapshot sources must use only sources marked as provided in SOURCE AVAILABILITY (RUNTIME).'
    );
  });
});
