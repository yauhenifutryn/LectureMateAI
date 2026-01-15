import { describe, expect, it } from 'vitest';
import { getAnalysisStartState } from '../../utils/analysisState';

describe('getAnalysisStartState', () => {
  it('resets result, tab, and error', () => {
    const state = getAnalysisStartState();
    expect(state.result).toBeNull();
    expect(state.activeTab).toBe('study_guide');
    expect(state.error).toBeNull();
  });
});
