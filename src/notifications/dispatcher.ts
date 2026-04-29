import type { NotificationConfig, NotificationPayload } from './types.js';
import { notify, loadNotificationConfig } from './notifier.js';

export class NotificationDispatcher {
  private config: NotificationConfig | null;
  private cooldownMs: number;
  private lastSent: Map<string, number>;

  constructor(config?: NotificationConfig | null, cooldownMs = 30000) {
    this.config = config ?? null;
    this.cooldownMs = cooldownMs;
    this.lastSent = new Map();
  }

  async init(): Promise<void> {
    if (!this.config) {
      this.config = await loadNotificationConfig();
    }
  }

  async dispatch(payload: NotificationPayload): Promise<void> {
    const key = `${payload.type}:${payload.title}`;
    const now = Date.now();
    const last = this.lastSent.get(key);
    if (last && now - last < this.cooldownMs) return;

    this.lastSent.set(key, now);
    await notify(payload, this.config);
  }
}
