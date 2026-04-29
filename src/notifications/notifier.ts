import { execFile } from 'child_process';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';
import { promisify } from 'util';
import type { NotificationConfig, NotificationPayload } from './types.js';

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 10_000;

export async function loadNotificationConfig(projectRoot?: string): Promise<NotificationConfig | null> {
  const configPath = join(projectRoot ?? homedir(), '.kt', 'notifications.json');
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(await readFile(configPath, 'utf-8')) as NotificationConfig;
  } catch {
    return null;
  }
}

export async function notify(payload: NotificationPayload, config?: NotificationConfig | null): Promise<void> {
  if (!config) {
    config = await loadNotificationConfig();
    if (!config) return;
  }

  const promises: Promise<void>[] = [];
  if (config.desktop) promises.push(sendDesktopNotification(payload));
  if (config.discord?.webhookUrl) promises.push(sendDiscordWebhook(config.discord.webhookUrl, payload));
  if (config.telegram?.botToken && config.telegram.chatId) {
    promises.push(sendTelegramMessage(config.telegram.botToken, config.telegram.chatId, payload));
  }
  if (config.slack?.webhookUrl) promises.push(sendSlackWebhook(config.slack.webhookUrl, payload));

  await Promise.allSettled(promises);
}

async function sendDesktopNotification(payload: NotificationPayload): Promise<void> {
  try {
    if (process.platform === 'darwin') {
      const title = payload.title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const msg = payload.message.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      await execFileAsync('osascript', ['-e', `display notification "${msg}" with title "${title}"`]);
    } else if (process.platform === 'linux') {
      await execFileAsync('notify-send', [payload.title, payload.message]);
    }
  } catch { /* best-effort */ }
}

async function sendDiscordWebhook(url: string, payload: NotificationPayload): Promise<void> {
  const colorMap = { info: 3447003, success: 3066993, warning: 15105570, error: 15158332 };
  const body = JSON.stringify({
    embeds: [{
      title: `[kt] ${payload.title}`,
      description: payload.message,
      color: colorMap[payload.type],
      timestamp: new Date().toISOString(),
    }],
  });

  try {
    const parsed = new URL(url);
    const { default: https } = await import('https');
    await new Promise<void>((resolve, reject) => {
      const req = https.request({
        hostname: parsed.hostname, path: parsed.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, (res) => { res.resume(); resolve(); });
      req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  } catch { /* best-effort */ }
}

async function sendTelegramMessage(botToken: string, chatId: string, payload: NotificationPayload): Promise<void> {
  const text = `*[kt] ${payload.title}*\n${payload.message}`;
  const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' });

  try {
    const { default: https } = await import('https');
    await new Promise<void>((resolve, reject) => {
      const req = https.request({
        hostname: 'api.telegram.org', path: `/bot${botToken}/sendMessage`, method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, (res) => { res.resume(); resolve(); });
      req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  } catch { /* best-effort */ }
}

async function sendSlackWebhook(url: string, payload: NotificationPayload): Promise<void> {
  const body = JSON.stringify({ text: `[kt] ${payload.title}: ${payload.message}` });

  try {
    const parsed = new URL(url);
    const { default: https } = await import('https');
    await new Promise<void>((resolve, reject) => {
      const req = https.request({
        hostname: parsed.hostname, path: parsed.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, (res) => { res.resume(); resolve(); });
      req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  } catch { /* best-effort */ }
}
