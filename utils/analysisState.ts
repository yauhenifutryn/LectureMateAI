import type { AnalysisResult } from '../types';

type AnalysisStartState = {
  result: AnalysisResult | null;
  activeTab: 'study_guide';
  error: string | null;
};

export function getAnalysisStartState(): AnalysisStartState {
  return {
    result: null,
    activeTab: 'study_guide',
    error: null
  };
}
