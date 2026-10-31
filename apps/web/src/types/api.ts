export type EmailStatus = 'SCHEDULED' | 'PROCESSING' | 'RATE_LIMITED' | 'SENT' | 'FAILED';

export interface Sender {
  id: string;
  name: string;
  email: string;
  smtpHost: string;
  smtpPort: number;
  hourlyLimit: number;
  minDelaySeconds: number;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  slackConnected: boolean;
  slackTeamName: string | null;
  senders: Sender[];
}

export interface EmailJob {
  id: string;
  recipientEmail: string;
  subject: string;
  body: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  previewUrl: string | null;
  messageId: string | null;
  attempts: number;
  errorMessage: string | null;
  sender?: {
    name: string;
    email: string;
  };
}

export type EmailTab = 'SCHEDULED' | 'SENT';
