import { Worker, Job, DelayedError } from 'bullmq';
import { redisConnection } from '../config/redis.js';
import { env } from '../config/env.js';
import { prisma } from '../config/db.js';
import { EMAIL_QUEUE_NAME, EmailJobPayload } from './email.queue.js';
import { RateLimitService } from '../services/ratelimit.service.js';
import { MailService } from '../services/mail.service.js';
import { SearchService } from '../services/search.service.js';
import { SlackService } from '../services/slack.service.js';

export const emailWorker = new Worker<EmailJobPayload>(
  EMAIL_QUEUE_NAME,
  async (job: Job<EmailJobPayload>, token?: string) => {
    const { emailJobId, campaignHourlyLimit, campaignMinDelaySec } = job.data;

    // Load the job and its sender
    const emailRecord = await prisma.emailJob.findUnique({
      where: { id: emailJobId },
      include: { sender: true },
    });

    if (!emailRecord) {
      console.warn(`[Worker] EmailJob ${emailJobId} not found in DB. Skipping.`);
      return { skipped: true, reason: 'NOT_FOUND' };
    }

    // Never re-send an already sent email
    if (emailRecord.status === 'SENT') {
      console.log(`[Worker] EmailJob ${emailJobId} already marked SENT. Idempotent exit.`);
      return { skipped: true, reason: 'ALREADY_SENT' };
    }

    const sender = emailRecord.sender;
    const effectiveHourlyLimit =
      campaignHourlyLimit || sender.hourlyLimit || env.MAX_EMAILS_PER_HOUR_PER_SENDER;
    const effectiveMinDelaySec =
      campaignMinDelaySec || sender.minDelaySeconds || env.DEFAULT_MIN_DELAY_SECONDS;

    // Hourly rate limit
    const rateCheck = await RateLimitService.checkAndIncrementHourlyLimit(
      sender.id,
      effectiveHourlyLimit,
      effectiveMinDelaySec
    );

    if (!rateCheck.allowed && rateCheck.rescheduleTimestampMs) {
      const nextWindowDate = new Date(rateCheck.rescheduleTimestampMs);
      console.warn(
        `[RateLimit] Hourly cap (${effectiveHourlyLimit}/hr) hit for ${sender.email}. Rescheduling job ${emailJobId} to ${nextWindowDate.toISOString()}`
      );

      // Update DB & Elasticsearch so UI reflects rescheduled time & status
      const updatedJob = await prisma.emailJob.update({
        where: { id: emailJobId },
        data: {
          status: 'RATE_LIMITED',
          scheduledAt: nextWindowDate,
        },
      });
      await SearchService.indexEmailJob(updatedJob);

      // Fire live Slack notification once per hour breach
      const shouldNotifySlack = await RateLimitService.shouldSendSlackRateLimitAlert(
        sender.id,
        rateCheck.hourWindowKey
      );
      if (shouldNotifySlack) {
        await SlackService.notifyRateLimitHit({
          userId: emailRecord.userId,
          senderEmail: sender.email,
          hourlyLimit: effectiveHourlyLimit,
          hourWindowKey: rateCheck.hourWindowKey,
          nextWindowTime: nextWindowDate,
        });
      }

      // Move job back to BullMQ delayed state without failing or losing it
      if (token) {
        await job.moveToDelayed(rateCheck.rescheduleTimestampMs, token);
        throw new DelayedError();
      }
    }

    // Minimum delay between sends
    const waitMs = await RateLimitService.acquireMinDelaySlot(sender.id, effectiveMinDelaySec);
    if (waitMs > 0) {
      if (waitMs > 5000 && token) {
        // If wait is large (e.g. massive burst), release worker thread via moveToDelayed
        await job.moveToDelayed(Date.now() + waitMs, token);
        throw new DelayedError();
      } else {
        // Short throttle pause
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }

    // Mark as PROCESSING
    await prisma.emailJob.update({
      where: { id: emailJobId },
      data: {
        status: 'PROCESSING',
        attempts: { increment: 1 },
      },
    });

    try {
      // Send via SMTP
      const smtpResult = await MailService.sendEmail({
        smtpHost: sender.smtpHost,
        smtpPort: sender.smtpPort,
        smtpUser: sender.smtpUser,
        smtpPass: sender.smtpPass,
        fromName: sender.name,
        fromEmail: sender.email,
        to: emailRecord.recipientEmail,
        subject: emailRecord.subject,
        html: emailRecord.body,
      });

      // Persist SENT state in Postgres and Elasticsearch
      const sentJob = await prisma.emailJob.update({
        where: { id: emailJobId },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          messageId: smtpResult.messageId,
          previewUrl: smtpResult.previewUrl,
          errorMessage: null,
        },
      });

      await SearchService.indexEmailJob(sentJob);

      console.log(
        `[Worker] Sent email ${emailJobId} to ${emailRecord.recipientEmail} | Preview: ${smtpResult.previewUrl}`
      );
      return { success: true, messageId: smtpResult.messageId, previewUrl: smtpResult.previewUrl };
    } catch (smtpError: any) {
      const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts || 1);

      const failedJob = await prisma.emailJob.update({
        where: { id: emailJobId },
        data: {
          status: isFinalAttempt ? 'FAILED' : 'SCHEDULED',
          errorMessage: smtpError?.message || 'SMTP delivery failed',
        },
      });

      await SearchService.indexEmailJob(failedJob);
      throw smtpError; // Let BullMQ trigger exponential backoff retry
    }
  },
  {
    connection: redisConnection,
    concurrency: env.WORKER_CONCURRENCY,
  }
);

emailWorker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job?.id} failed with error: ${err.message}`);
});