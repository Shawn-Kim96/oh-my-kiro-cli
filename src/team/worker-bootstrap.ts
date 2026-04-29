import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const WORKER_PROTOCOL_TEMPLATE = `## You are a kiro-team worker

Team: {team_name}
Worker: {worker_name}
Role: {role}
State Root: {state_root}

## State Root Resolution
Use this order to find the team state root:
1. $KT_STATE_ROOT environment variable
2. Your identity file: {state_root}/teams/{team_name}/workers/{worker_name}/identity.json → team_state_root
3. Team config: {state_root}/teams/{team_name}/config.json → team_state_root
4. Default: ~/.kt/

## Startup Protocol (REQUIRED — do this FIRST before any work)
1. Send startup ACK to leader:
   \`\`\`bash
   kt api send-message --input '{"team_name":"{team_name}","from_worker":"{worker_name}","to_worker":"leader","body":"ACK: {worker_name} initialized"}' --json
   \`\`\`
   CRITICAL: Never omit from_worker. The API cannot auto-detect your identity.

2. Read your inbox:
   Read file: {state_root}/teams/{team_name}/workers/{worker_name}/inbox.md

3. Start with the first non-blocked task listed in your inbox.

## Work Protocol
1. Read the task file at: {state_root}/teams/{team_name}/tasks/task-<id>.json
2. Claim your task:
   \`\`\`bash
   kt api claim-task --input '{"team_name":"{team_name}","task_id":"<id>","worker":"{worker_name}"}' --json
   \`\`\`

3. Update your status to "working":
   Write to {state_root}/teams/{team_name}/workers/{worker_name}/status.json:
   {"state":"working","current_task_id":"<id>","reason":null,"updated_at":"<ISO>"}

4. Do the work using your tools.

5. When work is complete, commit your changes BEFORE reporting:
   \`\`\`bash
   git add -A && git commit -m "task: <task-subject>"
   \`\`\`

6. Write your result:
   Write to {state_root}/teams/{team_name}/workers/{worker_name}/result.json:
   {"status":"done","result":"<your detailed findings/output>","updated_at":"<ISO>"}

7. Transition task to completed:
   \`\`\`bash
   kt api transition-task-status --input '{"team_name":"{team_name}","task_id":"<id>","from":"in_progress","to":"completed","result":"<summary>"}' --json
   \`\`\`

8. Update your status to "idle":
   Write to status.json: {"state":"idle","current_task_id":null,"reason":null,"updated_at":"<ISO>"}

9. Send completion message to leader:
   \`\`\`bash
   kt api send-message --input '{"team_name":"{team_name}","from_worker":"{worker_name}","to_worker":"leader","body":"DONE: task-<id> completed"}' --json
   \`\`\`

10. If you have more tasks in your inbox, proceed to the next one. Otherwise wait for next instruction.

## Mailbox Protocol
Check your mailbox when instructed:
\`\`\`bash
kt api mailbox-list --input '{"team_name":"{team_name}","worker":"{worker_name}"}' --json
\`\`\`

After reading a message, mark it delivered:
\`\`\`bash
kt api mailbox-mark-delivered --input '{"team_name":"{team_name}","worker":"{worker_name}","message_id":"<MESSAGE_ID>"}' --json
\`\`\`

## Failure Protocol
If your task fails:
1. Write error to result.json: {"status":"failed","error":"<what went wrong>","updated_at":"<ISO>"}
2. Transition task:
   \`\`\`bash
   kt api transition-task-status --input '{"team_name":"{team_name}","task_id":"<id>","from":"in_progress","to":"failed","error":"<reason>"}' --json
   \`\`\`
3. Update status to "idle"
4. Send failure message to leader

## Blocked Protocol
If you cannot proceed:
1. Update status: {"state":"blocked","current_task_id":"<id>","reason":"<why blocked>","updated_at":"<ISO>"}
2. Send message to leader explaining the blocker

## Shutdown Protocol
If leader sends shutdown instruction:
1. Finish current atomic operation (don't leave files half-written)
2. Commit any uncommitted changes
3. Write shutdown ACK:
   \`\`\`bash
   kt api send-message --input '{"team_name":"{team_name}","from_worker":"{worker_name}","to_worker":"leader","body":"SHUTDOWN_ACK: {worker_name}"}' --json
   \`\`\`
4. Exit your session

## Rules
- Focus ONLY on your assigned tasks
- Do NOT spawn subagents (no use_subagent tool)
- Do NOT modify files outside your task scope
- Do NOT write task lifecycle fields (status, owner, claim_token) directly — use kt api
- Always write result.json BEFORE reporting completion via kt api
- Always commit changes BEFORE reporting completion
- Always include from_worker in every kt api call
- Only edit files described in your task descriptions
- If you need to modify a shared file, write blocked status and wait
`;

function replacePlaceholders(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{${key}}`, value);
  }
  return result;
}

export interface TaskForInbox {
  id: string;
  subject: string;
  description: string;
  status: string;
  role?: string | null;
  blocked_by?: string[];
}

/**
 * Load role-specific prompt content from prompts directory.
 */
function loadRolePrompt(role: string, promptsDir: string): string | null {
  const filePath = join(promptsDir, `${role}.md`);
  if (existsSync(filePath)) {
    return readFileSync(filePath, 'utf-8');
  }
  return null;
}

/**
 * Generate a per-worker differentiated inbox.
 * Each worker gets ONLY their assigned tasks + role-specific guidance.
 */
export function generateWorkerInbox(params: {
  teamName: string;
  workerName: string;
  role: string;
  agent: string;
  tasks: TaskForInbox[];
  stateRoot: string;
  leaderCwd: string;
  rolePromptContent?: string | null;
}): string {
  const protocol = replacePlaceholders(WORKER_PROTOCOL_TEMPLATE, {
    team_name: params.teamName,
    worker_name: params.workerName,
    role: params.role,
    state_root: params.stateRoot,
  });

  const taskList = params.tasks
    .map((t) => {
      let entry = `- **Task ${t.id}**: ${t.subject}\n  Description: ${t.description}\n  Status: ${t.status}`;
      if (t.blocked_by && t.blocked_by.length > 0) {
        entry += `\n  Blocked by: ${t.blocked_by.join(', ')}`;
      }
      if (t.role) {
        entry += `\n  Role: ${t.role}`;
      }
      return entry;
    })
    .join('\n');

  const displayRole = params.role;

  const specializationSection = params.rolePromptContent
    ? `\n## Your Specialization\n\nYou are operating as a **${displayRole}** agent. Follow these behavioral guidelines:\n\n${params.rolePromptContent}\n`
    : '';

  const header = `# Worker Assignment: ${params.workerName}

**Team:** ${params.teamName}
**Role:** ${displayRole}
**Agent:** ${params.agent}
**Leader CWD:** ${params.leaderCwd}

## Your Assigned Tasks

${taskList || '(no tasks assigned yet)'}

`;

  return header + protocol + specializationSection;
}

/**
 * Legacy single-task inbox generation (backward compat for rebalance/resume).
 */
export function generateWorkerInboxLegacy(params: {
  teamName: string;
  workerName: string;
  role: string;
  agent: string;
  taskId: string;
  taskSubject: string;
  taskDescription: string;
  stateRoot: string;
  leaderCwd: string;
}): string {
  return generateWorkerInbox({
    teamName: params.teamName,
    workerName: params.workerName,
    role: params.role,
    agent: params.agent,
    tasks: [{
      id: params.taskId,
      subject: params.taskSubject,
      description: params.taskDescription,
      status: 'pending',
    }],
    stateRoot: params.stateRoot,
    leaderCwd: params.leaderCwd,
  });
}

export function generateTriggerMessage(params: {
  workerName: string;
  teamName: string;
  stateRoot: string;
}): string {
  const msg = `You are ${params.workerName} in team ${params.teamName}. Read your inbox at ${params.stateRoot}/teams/${params.teamName}/workers/${params.workerName}/inbox.md and follow ALL instructions.`;
  if (msg.length > 200) {
    const short = `You are ${params.workerName} in ${params.teamName}. Read ${params.stateRoot}/teams/${params.teamName}/workers/${params.workerName}/inbox.md now.`;
    if (short.length > 200) {
      throw new Error(`Trigger message exceeds 200 chars (${short.length})`);
    }
    return short;
  }
  return msg;
}

export function generateShutdownInbox(params: {
  teamName: string;
  workerName: string;
  reason: string;
}): string {
  return `# SHUTDOWN INSTRUCTION

Team: ${params.teamName}
Worker: ${params.workerName}
Reason: ${params.reason}

## Instructions
1. Finish your current atomic operation (do not leave files half-written)
2. Commit any uncommitted changes: \`git add -A && git commit -m "shutdown: ${params.workerName}"\`
3. Send shutdown ACK:
   \`\`\`bash
   kt api send-message --input '{"team_name":"${params.teamName}","from_worker":"${params.workerName}","to_worker":"leader","body":"SHUTDOWN_ACK: ${params.workerName}"}' --json
   \`\`\`
4. Exit your session
`;
}
