type PromptInputs = {
  systemPrompt: string;
  userContext?: string;
  hasAudio: boolean;
  hasSlides: boolean;
  hasRawNotes: boolean;
};

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

  const marker = 'BEGIN NOW';
  const markerIndex = systemPrompt.lastIndexOf(marker);
  let before = systemPrompt;
  let after = '';
  if (markerIndex !== -1) {
    before = systemPrompt.slice(0, markerIndex).trim();
    after = systemPrompt.slice(markerIndex).trim();
  }

  const parts = [before, directive];
  if (userContext) {
    parts.push(`User focus:\n${userContext}`);
  }
  if (after) {
    parts.push(after);
  }

  return parts.filter(Boolean).join('\n\n');
}
