import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis.js';

export const EMAIL_QUEUE_NAME = 'email-delivery-queue';

export interface EmailJobPayload {
  emailJobId: string;
  userId: string;
  senderId: string;
  campaignHourlyLimit?: number;
  campaignMinDelaySec?: number;
}

export const emailQueue = new Queue<EmailJobPayload>(EMAIL_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: false, // Keep in Bull Board for observability
    removeOnFail: false,
  },
});

export async function enqueueEmailJob(payload: EmailJobPayload, scheduledAt: Date) {
  const delayMs = Math.max(0, scheduledAt.getTime() - Date.now());
  const deterministicJobId = `email-job-${payload.emailJobId}`;

  return emailQueue.add('send-email', payload, {
    jobId: deterministicJobId,
    delay: delayMs,
  });
}