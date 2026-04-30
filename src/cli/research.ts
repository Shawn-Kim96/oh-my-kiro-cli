import { Command } from 'commander';
import { startTeamDetached } from '../team/runtime.js';
import { printJson } from '../utils/json.js';

interface ResearchPlan {
  topic: string;
  workers: number;
  tasks: string[];
  command: string;
}

function buildResearchPlan(topic: string, workers: number): ResearchPlan {
  const tasks = [
    `Research source map for: ${topic}. Identify authoritative files, docs, commands, and evidence pointers.`,
    `Synthesize findings for: ${topic}. Separate evidence from inference and call out unknowns.`,
    `Verify research quality for: ${topic}. Challenge assumptions, identify stale claims, and list follow-up implementation work.`,
  ].slice(0, Math.max(1, workers));
  while (tasks.length < workers) {
    tasks.push(`Deepen research lane ${tasks.length + 1} for: ${topic}. Focus on independent evidence and risks.`);
  }
  const numbered = tasks.map((task, i) => `${i + 1}. ${task}`).join(' ');
  return {
    topic,
    workers,
    tasks,
    command: `kch team --detach ${workers}:executor ${JSON.stringify(numbered)}`,
  };
}

export function researchCommand(name = 'research'): Command {
  return new Command(name)
    .description('Plan or launch a tmux-backed Kiro research team')
    .argument('<topic>')
    .option('--workers <n>', 'Number of research workers', '3')
    .option('--execute', 'Launch the research team instead of printing a plan')
    .option('--json', 'Print JSON')
    .action(async (topic: string, opts: { workers: string; execute?: boolean; json?: boolean }) => {
      const workers = Math.max(1, parseInt(opts.workers, 10) || 3);
      const plan = buildResearchPlan(topic, workers);
      if (!opts.execute) {
        if (opts.json) printJson({ execute: false, plan });
        else {
          console.log(`Research plan: ${topic}`);
          for (const [i, task] of plan.tasks.entries()) console.log(`  ${i + 1}. ${task}`);
          console.log(`\nLaunch: ${plan.command}`);
        }
        return;
      }

      const numbered = plan.tasks.map((task, i) => `${i + 1}. ${task}`).join(' ');
      if (opts.json) printJson({ execute: true, plan });
      await startTeamDetached({
        workerCount: workers,
        agentType: 'executor',
        task: numbered,
        cwd: process.cwd(),
        explicitAgentType: false,
        explicitWorkerCount: true,
      });
    });
}
