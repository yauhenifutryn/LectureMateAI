import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('markdown math rendering wiring', () => {
  it('enables math plugins in markdown components and loads KaTeX styles', () => {
    const studyGuideSource = fs.readFileSync(
      new URL('../../components/StudyGuide.tsx', import.meta.url),
      'utf8'
    );
    const chatSource = fs.readFileSync(
      new URL('../../components/ChatInterface.tsx', import.meta.url),
      'utf8'
    );
    const entrySource = fs.readFileSync(new URL('../../index.tsx', import.meta.url), 'utf8');

    expect(studyGuideSource).toContain("import remarkMath from 'remark-math';");
    expect(studyGuideSource).toContain("import rehypeKatex from 'rehype-katex';");
    expect(studyGuideSource).toContain('remarkPlugins={[remarkGfm, remarkMath]}');
    expect(studyGuideSource).toContain('rehypePlugins={[rehypeKatex]}');

    expect(chatSource).toContain("import remarkMath from 'remark-math';");
    expect(chatSource).toContain("import rehypeKatex from 'rehype-katex';");
    expect(chatSource).toContain('remarkPlugins={[remarkGfm, remarkMath]}');
    expect(chatSource).toContain('rehypePlugins={[rehypeKatex]}');

    expect(entrySource).toContain("import 'katex/dist/katex.min.css';");
  });
});
