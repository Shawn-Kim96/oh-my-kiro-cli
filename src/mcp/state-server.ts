import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readFile, writeFile, readdir, mkdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { autoStartStdioMcpServer } from './bootstrap.js';
import { ktStateDir } from '../utils/paths.js';

const SUPPORTED_MODES = ['team', 'ralph', 'plan'] as const;

const stateTools = [
  {
    name: 'kch_state_read',
    description: 'Read mode state.',
    inputSchema: {
      type: 'object' as const,
      properties: { mode: { type: 'string', enum: [...SUPPORTED_MODES] } },
      required: ['mode'],
    },
  },
  {
    name: 'kch_state_write',
    description: 'Write/update mode state.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        mode: { type: 'string', enum: [...SUPPORTED_MODES] },
        state: { type: 'object', description: 'State fields to merge' },
      },
      required: ['mode', 'state'],
    },
  },
  {
    name: 'kch_state_clear',
    description: 'Clear state for a mode.',
    inputSchema: {
      type: 'object' as const,
      properties: { mode: { type: 'string', enum: [...SUPPORTED_MODES] } },
      required: ['mode'],
    },
  },
  {
    name: 'kch_state_list',
    description: 'List active states.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
];

const legacyStateTools = stateTools.map(tool => ({
  ...tool,
  name: tool.name.replace(/^kch_/, 'kt_'),
  description: `${tool.description} Compatibility alias for ${tool.name}.`,
}));

function normalizeStateToolName(name: string): string {
  return name.startsWith('kt_') ? `kch_${name.slice(3)}` : name;
}

function stateDir(): string {
  return join(ktStateDir(), 'state');
}

function statePath(mode: string): string {
  return join(stateDir(), `${mode}-state.json`);
}

function createStateServer(): Server {
  const server = new Server(
    { name: 'kch-state-server', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...stateTools, ...legacyStateTools],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name: rawName, arguments: args } = request.params;
    const name = normalizeStateToolName(rawName);
    const a = (args ?? {}) as Record<string, unknown>;

    try {
      await mkdir(stateDir(), { recursive: true });

      switch (name) {
        case 'kch_state_read': {
          const mode = a['mode'] as string;
          const path = statePath(mode);
          if (!existsSync(path)) {
            return { content: [{ type: 'text' as const, text: JSON.stringify({ exists: false, mode }) }] };
          }
          const data = await readFile(path, 'utf-8');
          return { content: [{ type: 'text' as const, text: data }] };
        }

        case 'kch_state_write': {
          const mode = a['mode'] as string;
          const path = statePath(mode);
          let existing: Record<string, unknown> = {};
          if (existsSync(path)) {
            try { existing = JSON.parse(await readFile(path, 'utf-8')) as Record<string, unknown>; } catch { /* ignore */ }
          }
          const merged = { ...existing, ...(a['state'] as Record<string, unknown>) };
          await writeFile(path, JSON.stringify(merged, null, 2), 'utf-8');
          return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true, mode }) }] };
        }

        case 'kch_state_clear': {
          const mode = a['mode'] as string;
          const path = statePath(mode);
          if (existsSync(path)) await unlink(path);
          return { content: [{ type: 'text' as const, text: JSON.stringify({ cleared: true, mode }) }] };
        }

        case 'kch_state_list': {
          const dir = stateDir();
          const active: string[] = [];
          if (existsSync(dir)) {
            const files = await readdir(dir);
            for (const f of files) {
              if (!f.endsWith('-state.json')) continue;
              const mode = f.replace('-state.json', '');
              try {
                const data = JSON.parse(await readFile(join(dir, f), 'utf-8')) as Record<string, unknown>;
                if (data['active']) active.push(mode);
              } catch { /* skip */ }
            }
          }
          return { content: [{ type: 'text' as const, text: JSON.stringify({ active_modes: active }) }] };
        }

        default:
          return { content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }], isError: true };
      }
    } catch (error) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: (error as Error).message }) }], isError: true };
    }
  });

  return server;
}

void autoStartStdioMcpServer('state', createStateServer);
