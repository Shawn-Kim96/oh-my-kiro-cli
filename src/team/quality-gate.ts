export interface QualityResult {
  pass: boolean;
  issues: string[];
}

const ERROR_PATTERNS = [
  /Error:/i,
  /FAILED/i,
  /stack trace/i,
  /TypeError:/i,
  /ReferenceError:/i,
  /SyntaxError:/i,
  /ENOENT/i,
  /EPERM/i,
  /Cannot read properties of/i,
];

const SUCCESS_CONTEXT = /\b(?:fixed|resolved|handled|addressed|patched|corrected|cleared|eliminated|caught|prevented)\b/i;

function isRealError(line: string): boolean {
  // If the line also contains success context words, it's likely describing a fix, not an error
  if (SUCCESS_CONTEXT.test(line)) return false;
  return ERROR_PATTERNS.some(p => p.test(line));
}

function keywordOverlap(result: string, task: string): number {
  const taskWords = new Set(
    task.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2)
  );
  if (taskWords.size === 0) return 1; // no meaningful words to compare
  const resultLower = result.toLowerCase();
  let matches = 0;
  for (const word of taskWords) {
    if (resultLower.includes(word)) matches++;
  }
  return matches / taskWords.size;
}

export function assessOutput(result: string, taskDescription: string): QualityResult {
  const issues: string[] = [];

  // Check 1: non-empty
  if (!result || result.trim().length === 0) {
    issues.push('Result is empty');
    return { pass: false, issues };
  }

  // Check 2: error patterns (line-by-line, skip lines with success context)
  const lines = result.split('\n');
  for (const line of lines) {
    if (isRealError(line)) {
      const matched = ERROR_PATTERNS.find(p => p.test(line));
      if (matched) issues.push(`Contains error pattern: ${matched.source}`);
    }
  }
  // Only fail on errors if there are multiple or the result is very short
  if (issues.length > 0 && (issues.length >= 2 || result.trim().length < 100)) {
    return { pass: false, issues };
  }

  // Check 3: keyword overlap
  const overlap = keywordOverlap(result, taskDescription);
  if (overlap < 0.3) {
    issues.push(`Low keyword overlap with task (${(overlap * 100).toFixed(0)}%, need 30%)`);
    return { pass: false, issues };
  }

  return { pass: true, issues };
}
