import { Command } from 'commander';
import { interviewTask } from '../team/interview.js';
import { triageTask } from '../team/triage.js';
import { printJson } from '../utils/json.js';

export function deepInterviewCommand(): Command {
  return new Command('deep-interview')
    .description('Run ambiguity-gated task intake before execution')
    .argument('<task>')
    .option('--json', 'Print JSON')
    .action((task: string, opts: { json?: boolean }) => {
      const interview = interviewTask(task);
      const triage = triageTask(task);
      const result = {
        task,
        triage,
        interview,
        blocked: interview.ambiguities.length > 0,
        recommended_next: interview.ambiguities.length > 0
          ? 'Answer the ambiguity questions, then run kch plan or kch team.'
          : `kch plan ${JSON.stringify(task)}`,
      };
      if (opts.json) {
        printJson(result);
        return;
      }
      console.log(`Goal: ${interview.goal}`);
      console.log(`Triage: ${triage.level} (${triage.reason})`);
      if (interview.ambiguities.length) {
        console.log('\nQuestions:');
        for (const q of interview.ambiguities) console.log(`  - ${q}`);
      } else {
        console.log('\nNo blocking ambiguities detected.');
      }
      console.log(`\nNext: ${result.recommended_next}`);
    });
}
