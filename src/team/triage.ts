export type TriageLevel = 'PASS' | 'LIGHT' | 'HEAVY';
export type ModelRoute = 'fast' | 'standard' | 'reasoning';

export interface TriageResult {
  level: TriageLevel;
  workerCount: number;
  modelRoute: ModelRoute;
  reason: string;
}

export function triageTask(task: string): TriageResult {
  const trimmed = task.trim();
  if (!trimmed) {
    return { level: 'PASS', workerCount: 1, modelRoute: 'fast', reason: 'Empty task' };
  }
  const words = trimmed.split(/\s+/).length;
  const fileRefs = (task.match(/[\w./]+\.[a-z]{1,4}/g) ?? []).length;
  const archKeywords = (task.match(/redesign|migrate|overhaul|refactor entire|rewrite|rearchitect/gi) ?? []).length;

  if (words <= 15 && fileRefs <= 1 && archKeywords === 0) {
    return { level: 'PASS', workerCount: 1, modelRoute: 'fast', reason: 'Simple task' };
  }
  if (words > 50 || fileRefs > 3 || archKeywords > 0) {
    const details = [
      words > 50 ? `${words} words` : '',
      fileRefs > 3 ? `${fileRefs} file refs` : '',
      archKeywords > 0 ? `${archKeywords} architectural keywords` : '',
    ].filter(Boolean).join(', ');
    return { level: 'HEAVY', workerCount: 3, modelRoute: 'reasoning', reason: `Complex task: ${details}` };
  }
  return { level: 'LIGHT', workerCount: 2, modelRoute: 'standard', reason: 'Moderate task' };
}
