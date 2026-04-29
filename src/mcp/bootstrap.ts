import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

export async function autoStartStdioMcpServer(name: string, createServer: () => Server): Promise<void> {
  const envKey = `KT_MCP_${name.toUpperCase()}_DISABLE`;
  if (process.env[envKey] === '1') return;

  const server = createServer();
  const transport = new StdioServerTransport();
  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try { await server.close(); } catch { /* ignore */ }
  };

  process.stdin.once('end', () => void shutdown());
  process.stdin.once('close', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());

  try {
    await server.connect(transport);
  } catch (error) {
    console.error(`[kch-${name}-server] failed to start:`, error);
  }
}
