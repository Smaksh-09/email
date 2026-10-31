import { Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { AuthRequest } from '../middleware/auth.middleware.js';
import { emailQueue } from '../queues/email.queue.js';
import { SearchService } from '../services/search.service.js';
import { MailService } from '../services/mail.service.js';

const scheduleCampaignSchema = z.object({
  senderId: z.string().uuid().optional(),
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Email body is required'),
  recipients: z.array(z.string().email()).min(1, 'At least one valid email is required'),
  startTime: z.string().datetime().optional(), // ISO string; defaults to now
  delayBetweenSec: z.coerce.number().min(1).default(env.DEFAULT_MIN_DELAY_SECONDS),
  hourlyLimit: z.coerce.number().min(1).default(env.MAX_EMAILS_PER_HOUR_PER_SENDER),
});

export class EmailController {
  /**
   * Creates an additional Ethereal sender.
   */
  static async createSender(req: AuthRequest, res: Response) {
    try {
      const { name, hourlyLimit, minDelaySeconds } = req.body;
      const ethereal = await MailService.createEtherealAccount();

      const sender = await prisma.sender.create({
        data: {
          userId: req.user!.id,
          name: name || 'Outreach Sender',
          email: ethereal.smtpUser,
          smtpHost: ethereal.smtpHost,
          smtpPort: ethereal.smtpPort,
          smtpUser: ethereal.smtpUser,
          smtpPass: ethereal.smtpPass,
          hourlyLimit: Number(hourlyLimit) || env.MAX_EMAILS_PER_HOUR_PER_SENDER,
          minDelaySeconds: Number(minDelaySeconds) || env.DEFAULT_MIN_DELAY_SECONDS,
        },
      });

      res.status(201).json({ sender });
    } catch (error) {
      console.error('[EmailController] createSender Error:', error);
      res.status(500).json({ error: 'Failed to create Ethereal sender' });
    }
  }

  /**
   * Schedules emails as BullMQ delayed jobs (no cron).
   */
  static async scheduleEmails(req: AuthRequest, res: Response) {
    try {
      const parsed = scheduleCampaignSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
        return;
      }

      const {
        senderId,
        subject,
        body,
        recipients,
        startTime,
        delayBetweenSec,
        hourlyLimit,
      } = parsed.data;

      const userId = req.user!.id;

      // Deduplicate recipient emails within the same payload
      const uniqueRecipients = Array.from(new Set(recipients.map((r) => r.trim().toLowerCase())));

      // Resolve sender (use specified senderId or fallback to user's primary sender)
      let sender = senderId
        ? await prisma.sender.findFirst({ where: { id: senderId, userId } })
        : await prisma.sender.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } });

      if (!sender) {
        const ethereal = await MailService.createEtherealAccount();
        sender = await prisma.sender.create({
          data: {
            userId,
            name: 'Default Sender',
            email: ethereal.smtpUser,
            smtpHost: ethereal.smtpHost,
            smtpPort: ethereal.smtpPort,
            smtpUser: ethereal.smtpUser,
            smtpPass: ethereal.smtpPass,
            hourlyLimit,
            minDelaySeconds: delayBetweenSec,
          },
        });
      }

      const baseStartMs = startTime ? Math.max(Date.now(), new Date(startTime).getTime()) : Date.now();


      const campaign = await prisma.campaign.create({
        data: {
          userId,
          senderId: sender.id,
          subject,
          body,
          startTime: new Date(baseStartMs),
          delayBetweenSec,
          hourlyLimit,
          totalLeads: uniqueRecipients.length,
        },
      });

      // Prepare EmailJob records with staggered schedule times & deterministic idempotency keys
      const emailJobsData = uniqueRecipients.map((recipientEmail, index) => {
        const scheduledAtMs = baseStartMs + index * (delayBetweenSec * 1000);
        const idempotencyKey = crypto
          .createHash('sha256')
          .update(`${userId}:${sender!.id}:${campaign.id}:${recipientEmail}`)
          .digest('hex');

        const id = crypto.randomUUID();

        return {
          id,
          idempotencyKey,
          userId,
          senderId: sender!.id,
          campaignId: campaign.id,
          recipientEmail,
          subject,
          body,
          status: 'SCHEDULED' as const,
          scheduledAt: new Date(scheduledAtMs),
          bullJobId: `email-job-${id}`,
        };
      });

      // Bulk insert into Postgres
      await prisma.emailJob.createMany({
        data: emailJobsData,
        skipDuplicates: true,
      });

      // Bulk enqueue into BullMQ with exact delay
      const nowMs = Date.now();
      const bullJobs = emailJobsData.map((jobRecord) => ({
        name: 'send-email',
        data: {
          emailJobId: jobRecord.id,
          userId,
          senderId: sender!.id,
          campaignHourlyLimit: hourlyLimit,
          campaignMinDelaySec: delayBetweenSec,
        },
        opts: {
          jobId: jobRecord.bullJobId,
          delay: Math.max(0, jobRecord.scheduledAt.getTime() - nowMs),
        },
      }));

      await emailQueue.addBulk(bullJobs);

      // Index asynchronously in Elasticsearch so API returns fast
      Promise.all(emailJobsData.map((job) => SearchService.indexEmailJob(job))).catch((err) =>
        console.error('[Elasticsearch] Bulk index warning:', err)
      );

      res.status(201).json({
        message: `Successfully scheduled ${emailJobsData.length} emails`,
        campaignId: campaign.id,
        totalScheduled: emailJobsData.length,
        senderEmail: sender.email,
      });
    } catch (error) {
      console.error('[EmailController] scheduleEmails Error:', error);
      res.status(500).json({ error: 'Failed to schedule emails' });
    }
  }

  /**
   * Lists scheduled or sent emails; uses Elasticsearch when `q` is given, Postgres otherwise.
   */
  static async listEmails(req: AuthRequest, res: Response) {
    try {
      const userId = req.user!.id;
      const type = (req.query.type as string)?.toUpperCase(); // 'SCHEDULED' | 'SENT'
      const search = (req.query.q as string) || '';

      // If search query is provided, query Elasticsearch first
      if (search.trim().length > 0) {
        const esResults = await SearchService.searchEmails(
          userId,
          search,
          type === 'SCHEDULED' || type === 'SENT' ? type : undefined
        );
        res.json({ emails: esResults, source: 'elasticsearch' });
        return;
      }

      // Standard tabular fetch from PostgreSQL
      const statusFilter =
        type === 'SCHEDULED'
          ? { in: ['SCHEDULED' as const, 'PROCESSING' as const, 'RATE_LIMITED' as const] }
          : type === 'SENT'
          ? { in: ['SENT' as const, 'FAILED' as const] }
          : undefined;

      const emails = await prisma.emailJob.findMany({
        where: {
          userId,
          ...(statusFilter ? { status: statusFilter } : {}),
        },
        include: {
          sender: {
            select: { email: true, name: true },
          },
        },
        orderBy: type === 'SENT' ? { sentAt: 'desc' } : { scheduledAt: 'asc' },
        take: 500,
      });

      res.json({ emails, source: 'postgres' });
    } catch (error) {
      console.error('[EmailController] listEmails Error:', error);
      res.status(500).json({ error: 'Failed to fetch emails' });
    }
  }

  /**
   * Returns a single email job.
   */
  static async getEmailById(req: AuthRequest, res: Response) {
    try {
      const email = await prisma.emailJob.findFirst({
        where: {
          id: req.params.id,
          userId: req.user!.id,
        },
        include: {
          sender: {
            select: { email: true, name: true },
          },
        },
      });

      if (!email) {
        res.status(404).json({ error: 'Email not found' });
        return;
      }

      res.json({ email });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch email details' });
    }
  }
}