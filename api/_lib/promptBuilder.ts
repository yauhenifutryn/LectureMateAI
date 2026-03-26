type PromptInputs = {
  systemPrompt: string;
  userContext?: string;
  hasAudio: boolean;
  hasSlides: boolean;
  hasRawNotes: boolean;
  transcriptText?: string;
};

type RuntimeBudget = {
  sizeClass: 'short' | 'medium' | 'long' | 'very_long';
  executiveSummary: string;
  keyTakeaways: string;
  coreConcepts: string;
  dealWalkthrough: string;
  evidenceSnapshot: string;
  examEssentials: string;
};

const countWords = (text?: string): number => {
  const trimmed = text?.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
};

function getRuntimeBudget(wordCount: number): RuntimeBudget | null {
  if (wordCount <= 0) return null;
  if (wordCount <= 1200) {
    return {
      sizeClass: 'short',
      executiveSummary: '4 to 6 lines.',
      keyTakeaways: '5 to 8 bullets.',
      coreConcepts: '3 to 5 concepts.',
      dealWalkthrough: '4 to 6 steps.',
      evidenceSnapshot: '3 to 4 rows.',
      examEssentials: 'Keep only the source-supported definitions, formulas, and distinctions that are central.'
    };
  }
  if (wordCount <= 7000) {
    return {
      sizeClass: 'medium',
      executiveSummary: '6 to 10 lines.',
      keyTakeaways: '8 to 12 bullets.',
      coreConcepts: '4 to 7 concepts.',
      dealWalkthrough: '5 to 8 steps.',
      evidenceSnapshot: '3 to 6 rows.',
      examEssentials: 'Cover the important source-supported definitions, formulas, and distinctions without padding.'
    };
  }
  if (wordCount <= 14000) {
    return {
      sizeClass: 'long',
      executiveSummary: '8 to 12 lines.',
      keyTakeaways: '10 to 16 bullets.',
      coreConcepts: '6 to 9 concepts.',
      dealWalkthrough: '7 to 10 steps.',
      evidenceSnapshot: '4 to 7 rows.',
      examEssentials: 'Include the full set of source-supported definitions, formulas, thresholds, and contrasts.'
    };
  }
  return {
    sizeClass: 'very_long',
    executiveSummary: '10 to 14 lines.',
    keyTakeaways: '12 to 18 bullets.',
    coreConcepts: '7 to 10 concepts.',
    dealWalkthrough: '8 to 12 steps.',
    evidenceSnapshot: '5 to 8 rows.',
    examEssentials: 'Be comprehensive about source-supported formulas, definitions, thresholds, and decision rules.'
  };
}

export function buildContentBudgetDirective(transcriptText?: string): string {
  const wordCount = countWords(transcriptText);
  const runtimeBudget = getRuntimeBudget(wordCount);
  if (!runtimeBudget) return '';

  return [
    'CONTENT BUDGET (RUNTIME)',
    `Transcript word count estimate: ${wordCount}.`,
    `Lecture size class: ${runtimeBudget.sizeClass}.`,
    'These runtime size instructions override the default section size limits when they conflict.',
    `Executive Summary: ${runtimeBudget.executiveSummary}`,
    `Key Takeaways: ${runtimeBudget.keyTakeaways}`,
    `Exam Essentials: ${runtimeBudget.examEssentials}`,
    `Core Concepts: ${runtimeBudget.coreConcepts}`,
    `Deal Walkthrough: ${runtimeBudget.dealWalkthrough}`,
    `Evidence Snapshot: ${runtimeBudget.evidenceSnapshot}`,
    'If the lecture contains multiple distinct parts, preserve them instead of compressing them into the same fixed-length summary.'
  ].join('\n');
}

export function buildOutputLanguageDirective(transcriptText?: string): string {
  if (!transcriptText?.trim()) {
    return [
      'OUTPUT LANGUAGE (RUNTIME)',
      'No transcript language signal is available.',
      'Default to English unless the user explicitly requested another language.'
    ].join('\n');
  }

  return [
    'OUTPUT LANGUAGE (RUNTIME)',
    'Write the study guide in the dominant language of the transcript, which should match the audio language.',
    'If the transcript language is unclear or unsupported for high-quality output, fall back softly to English.',
    'Do not switch the study-guide language to match slide language when slides differ from the transcript.',
    'Preserve formulas, symbols, and source terminology when translation would reduce precision.'
  ].join('\n');
}

export function buildSourceDirective(
  inputs: Pick<PromptInputs, 'hasAudio' | 'hasSlides' | 'hasRawNotes'>
): string {
  const allowedSources: string[] = [];
  if (inputs.hasAudio) allowedSources.push('Transcript');
  if (inputs.hasSlides) allowedSources.push('Slides');
  if (inputs.hasRawNotes) allowedSources.push('Raw notes');

  const lines = [
    'SOURCE AVAILABILITY (RUNTIME)',
    inputs.hasAudio
      ? 'Transcript source: provided from audio.'
      : 'Transcript source: not provided. Use "(No transcript provided.)" and do not cite Transcript.',
    inputs.hasSlides
      ? 'Slides source: provided.'
      : 'Slides source: not provided. Use "(No slides provided.)" and do not cite Slides.',
    inputs.hasRawNotes
      ? 'Raw notes source: provided.'
      : 'Raw notes source: not provided. Use "(No raw notes provided.)" and do not cite Raw notes.'
  ];

  if (allowedSources.length > 0) {
    lines.push(`Allowed Evidence Snapshot sources: ${allowedSources.join(', ')}.`);
    lines.push('Do not use any other source labels.');
  }

  return lines.join('\n');
}

export function buildPrompt(inputs: PromptInputs): string {
  const systemPrompt = inputs.systemPrompt?.trim() ?? '';
  const userContext = inputs.userContext?.trim() ?? '';
  const directive = buildSourceDirective(inputs);
  const contentBudgetDirective = buildContentBudgetDirective(inputs.transcriptText);
  const outputLanguageDirective = buildOutputLanguageDirective(inputs.transcriptText);

  const marker = 'BEGIN NOW';
  const markerIndex = systemPrompt.lastIndexOf(marker);
  let before = systemPrompt;
  let after = '';
  if (markerIndex !== -1) {
    before = systemPrompt.slice(0, markerIndex).trim();
    after = systemPrompt.slice(markerIndex).trim();
  }

  const parts = [before, directive, outputLanguageDirective, contentBudgetDirective];
  if (userContext) {
    parts.push(`User focus:\n${userContext}`);
  }
  if (after) {
    parts.push(after);
  }

  return parts.filter(Boolean).join('\n\n');
}
