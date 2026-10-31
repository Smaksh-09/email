import type { EmailJob, EmailTab, Sender, UserProfile } from '@/types/api';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5000';
const TOKEN_KEY = 'outbox_token';

export const tokenStore = {
  get: () => (typeof window === 'undefined' ? null : window.localStorage.getItem(TOKEN_KEY)),
  set: (token: string) => window.localStorage.setItem(TOKEN_KEY, token),
  clear: () => window.localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = tokenStore.get();
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: 'include' });
  } catch {
    throw new ApiError('Cannot reach the server. Is the API running on ' + API_URL + '?', 0);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

export interface SchedulePayload {
  senderId?: string;
  subject: string;
  body: string;
  recipients: string[];
  startTime?: string;
  delayBetweenSec: number;
  hourlyLimit: number;
}

export const api = {
  me: () => request<UserProfile>('/api/auth/me'),
  logout: () => request<{ success: boolean }>('/api/auth/logout', { method: 'POST' }),
  slackDisconnect: () =>
    request<{ success: boolean }>('/api/auth/slack/disconnect', { method: 'POST' }),
  listEmails: async (type: EmailTab, q = '') => {
    const params = new URLSearchParams({ type });
    if (q.trim()) params.set('q', q.trim());
    const res = await request<{ emails: EmailJob[] }>(`/api/emails?${params}`);
    return res.emails;
  },
  getEmail: async (id: string) => (await request<{ email: EmailJob }>(`/api/emails/${id}`)).email,
  schedule: (payload: SchedulePayload) =>
    request<{ message: string; totalScheduled: number }>('/api/emails/schedule', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  createSender: async (body: { name: string; hourlyLimit: number; minDelaySeconds: number }) =>
    (
      await request<{ sender: Sender }>('/api/emails/senders', {
        method: 'POST',
        body: JSON.stringify(body),
      })
    ).sender,
};
