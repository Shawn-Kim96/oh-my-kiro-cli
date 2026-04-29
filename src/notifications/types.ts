export interface NotificationConfig {
  desktop?: boolean;
  discord?: { webhookUrl: string };
  telegram?: { botToken: string; chatId: string };
  slack?: { webhookUrl: string };
}

export interface NotificationPayload {
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  teamName?: string;
  workerName?: string;
}
