import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';

import { env } from './config/env.js';
import { prisma } from './config/db.js';
import { emailQueue, enqueueEmailJob } from './queues/email.queue.js';
import './queues/email.worker.js'; // Starts the BullMQ Worker
import { SearchService } from './services/search.service.js';

import authRoutes from './routes/auth.routes.js';
import emailRoutes from './routes/email.routes.js';

const app = express();

app.use(
  cors({
    origin: env.FRONTEND_URL,
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// BullMQ dashboard
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [new BullMQAdapter(emailQueue)],
  serverAdapter,
});

app.use('/admin/queues', serverAdapter.getRouter());

// REST routes
app.use('/api/auth', authRoutes);
app.use('/api/emails', emailRoutes);

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    workerConcurrency: env.WORKER_CONCURRENCY,
    defaultHourlyLimit: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Ensures any SCHEDULED/RATE_LIMITED jobs in Postgres are present in BullMQ on server restart
 */
async function reconcilePendingJobsOnStartup() {
  try {
    const pendingJobs = await prisma.emailJob.findMany({
      where: {
        status: { in: ['SCHEDULED', 'RATE_LIMITED'] },
      },
      include: { campaign: true },
    });

    let recovered = 0;
    for (const record of pendingJobs) {
      const existingJob = await emailQueue.getJob(`email-job-${record.id}`);
      if (!existingJob) {
        await enqueueEmailJob(
          {
            emailJobId: record.id,
            userId: record.userId,
            senderId: record.senderId,
            campaignHourlyLimit: record.campaign?.hourlyLimit,
            campaignMinDelaySec: record.campaign?.delayBetweenSec,
          },
          record.scheduledAt
        );
        recovered++;
      }
    }
    if (recovered > 0) {
      console.log(`[Startup Reconciliation] Re-enqueued ${recovered} pending jobs into BullMQ.`);
    }
  } catch (error) {
    console.error('[Startup Reconciliation] Warning:', error);
  }
}

async function bootstrap() {
  await SearchService.initIndex();
  await reconcilePendingJobsOnStartup();

  app.listen(env.PORT, () => {
    console.log(`[Server] API running at http://localhost:${env.PORT}`);
    console.log(`[Bull Board] Queue Monitor live at http://localhost:${env.PORT}/admin/queues`);
  });
}

bootstrap();