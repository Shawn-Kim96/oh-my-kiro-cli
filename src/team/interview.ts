export interface InterviewResult {
  goal: string;
  scope: string[];
  constraints: string[];
  acceptanceCriteria: string[];
  ambiguities: string[];
}

export function interviewTask(task: string): InterviewResult {
  const goal = task.match(/^[^.!?]+[.!?]?/)?.[0]?.trim() ?? task.trim();
  const scope = task.match(/[\w./]+\.[a-z]{1,4}/g) ?? [];

  const extractPhrases = (pattern: RegExp): string[] => {
    const results: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(task)) !== null) {
      const after = task.slice(m.index + m[0].length).match(/^[^.!?\n]+/);
      if (after) results.push(after[0].trim());
    }
    return results;
  };

  const constraints = extractPhrases(/\b(?:must|should|without|don't)\b/gi);
  const acceptanceCriteria = extractPhrases(/\b(?:so that|verify|ensure|test that)\b/gi);

  const ambiguities: string[] = [];
  // Only flag truly vague verbs (not "fix" or "update" which are specific actions)
  const vagueVerbs = /\b(improve|refactor|handle|manage)\b/gi;
  let vm: RegExpExecArray | null;
  while ((vm = vagueVerbs.exec(task)) !== null) {
    const after = task.slice(vm.index + vm[0].length, vm.index + vm[0].length + 50);
    const nextWords = after.split(/\s+/).slice(0, 5).join(' ');
    if (!/[\w./]+\.[a-z]{1,4}/.test(nextWords)) {
      ambiguities.push(`What specifically should "${vm[1]}" mean here?`);
    }
  }
  if (scope.length === 0) ambiguities.push('Which files/modules are in scope?');
  if (acceptanceCriteria.length === 0 && scope.length === 0) ambiguities.push("What does 'done' look like?");
  if (/\beither\b.*\bor\b/i.test(task)) ambiguities.push('Which approach do you prefer?');

  return { goal, scope, constraints, acceptanceCriteria, ambiguities };
}
