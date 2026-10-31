# ReachInbox — Distributed Email Job Scheduler & Outreach Engine

A production-grade, full-stack email scheduling and delivery platform built for the **Outbox Labs (ReachInbox.ai) SDE Internship Assignment**.

This system accepts batch and individual email campaigns via REST APIs, schedules them deterministically using **BullMQ delayed jobs** (zero cron jobs), enforces **distributed per-sender hourly rate limits and inter-email throttling** via atomic **Redis Lua scripts**, indexes all email states in **Elasticsearch**, fires live **Slack OAuth notifications** upon rate-limit breaches, and guarantees **idempotent, fault-tolerant delivery across server restarts**.

---

## Table of Contents

1. [Tech Stack & Monorepo Structure](#1-tech-stack--monorepo-structure)
2. [Features & Assignment Requirements Mapping](#2-features--assignment-requirements-mapping)
3. [System Architecture & Engineering Deep-Dive](#3-system-architecture--engineering-deep-dive)
   - [How Scheduling Works (Zero Cron)](#a-how-scheduling-works-zero-cron)
   - [Persistence & Crash Recovery Across Restarts](#b-persistence--crash-recovery-across-restarts)
   - [Distributed Rate Limiting, Concurrency & Minimum Delay](#c-distributed-rate-limiting-concurrency--minimum-delay)
   - [Idempotency & Duplicate Send Prevention](#d-idempotency--duplicate-send-prevention)
   - [Live Slack Notification on Rate Limit Hit](#e-live-slack-notification-on-rate-limit-hit)
4. [Prerequisites & Infrastructure Setup](#4-prerequisites--infrastructure-setup)
5. [Environment Variables Setup](#5-environment-variables-setup)
6. [How to Run the Application](#6-how-to-run-the-application)
7. [Design Decisions, Assumptions & Trade-offs](#7-design-decisions-assumptions--trade-offs)

---

## 1. Tech Stack & Monorepo Structure

```text
.
├── apps/
│   ├── api/                        # Express.js + TypeScript Backend & BullMQ Worker
│   │   ├── prisma/schema.prisma    # PostgreSQL relational schema (User, Sender, Campaign, EmailJob)
│   │   └── src/
│   │       ├── config/             # Zod env validation, Prisma client, Redis connection
│   │       ├── controllers/        # Auth (Google & Slack OAuth) & Email scheduling controllers
│   │       ├── middleware/         # JWT authentication middleware
│   │       ├── queues/             # BullMQ Queue definition & Concurrency-safe Worker
│   │       ├── routes/             # Express route definitions
│   │       └── services/           # Redis Lua RateLimiter, Ethereal SMTP, Elasticsearch, Slack
│   └── web/                        # Next.js (App Router) + TypeScript + Tailwind CSS Frontend
├── packages/
│   └── types/                      # Shared TypeScript interfaces
├── docker-compose.yml              # PostgreSQL 16, Redis 7 (AOF persistence), Elasticsearch 8.13
└── package.json                    # NPM Workspaces configuration
```

* **Backend:** Node.js, Express.js, TypeScript, Zod
* **Database & ORM:** PostgreSQL 16, Prisma ORM
* **Queue & Distributed State:** BullMQ, Redis 7 (`ioredis` + custom atomic Lua scripts)
* **Queue Observability:** Bull Board (`/admin/queues`)
* **Search Engine:** Elasticsearch 8.13 (`@elastic/elasticsearch`)
* **SMTP Delivery:** Nodemailer + Ethereal Email (Fake SMTP with live message preview URLs)
* **Authentication & Integrations:** Google OAuth 2.0 (`google-auth-library`), Slack OAuth v2 (`incoming-webhook` & `chat:write`)
* **Frontend:** Next.js (App Router), React, TypeScript, Tailwind CSS, Lucide Icons

---

## 2. Features & Assignment Requirements Mapping

### Backend Requirements
| Requirement | Implementation Status & Details |
| :--- | :--- |
| **Accept & Store Email Schedules** | `POST /api/emails/schedule` validates payloads with Zod, bulk-inserts `Campaign` and `EmailJob` records into PostgreSQL, and enqueues delayed jobs into BullMQ via `addBulk`. |
| **No Cron Jobs** | Zero OS cron or Node cron libraries used. All future executions rely strictly on BullMQ delayed jobs (`delay = scheduledAt - Date.now()`). |
| **Multi-Sender Support via Ethereal** | Users get a primary Ethereal SMTP account auto-provisioned upon Google login and can provision additional Ethereal senders (`POST /api/emails/senders`) with independent rate limits. |
| **Elasticsearch Indexing & Search** | Every email job is indexed in `emails_index` on creation and updated on status transitions (`SCHEDULED` $\rightarrow$ `RATE_LIMITED` $\rightarrow$ `SENT`/`FAILED`). Searchable via `GET /api/emails?q=<term>`. |
| **Live BullMQ Dashboard** | Mounted via `@bull-board/express` at `http://localhost:5000/admin/queues` for real-time inspection of delayed, active, completed, and failed jobs. |
| **Configurable Worker Concurrency** | Controlled via `WORKER_CONCURRENCY` env variable (default: `5` parallel jobs per worker). |
| **Minimum Delay Between Sends** | Enforced via `DEFAULT_MIN_DELAY_SECONDS` (default: **`2 seconds`** between individual email sends) and configurable per campaign. Enforced across concurrent workers using an atomic Redis Lua slot reservation script. |
| **Distributed Hourly Rate Limiting** | Configurable via `MAX_EMAILS_PER_HOUR_PER_SENDER` (default: `50`) and overrideable per campaign. Enforced via Redis Lua counters keyed by `ratelimit:hourly:{senderId}:{YYYY-MM-DDTHH}`. |
| **Non-Destructive Rescheduling on Limit** | When the hourly cap is reached, jobs are **never dropped or failed**. Excess jobs are atomically assigned an overflow sequence index and moved to the next hour window via `job.moveToDelayed(nextWindowMs, token)` while preserving FIFO order and the minimum inter-email delay. |
| **Live Slack Notification on Rate Limit** | Full Slack OAuth v2 connect/disconnect flow. On the exact moment a sender breaches their hourly cap, a single atomic alert (guarded by Redis `SETNX`) is sent to the user's Slack channel. |
| **Crash & Restart Persistence** | Redis runs with Append-Only File (`--appendonly yes`) persistence alongside a PostgreSQL-to-BullMQ startup reconciliation routine (`reconcilePendingJobsOnStartup()`). |

### Frontend Requirements
| Requirement | Implementation Status & Details |
| :--- | :--- |
| **Real Google OAuth Login** | Full OAuth 2.0 flow (`/api/auth/google`), displaying user Name, Email, Avatar, and Logout in the dashboard header. |
| **Main Dashboard & Tabs** | Matches the ReachInbox Figma design with **Scheduled Emails** and **Sent Emails** tabs, live counts, and a debounced Elasticsearch search bar. |
| **Compose New Email & CSV Parser** | Supports rich text body, sender selection, start time picker, delay between emails, hourly limit, and client-side `.csv`/`.txt` lead parsing that displays the exact count of valid, deduplicated email addresses detected. |
| **Scheduled & Sent Tables** | Includes skeleton loading states, empty states, status badges (`Scheduled`, `Rate limited` in amber, `Sent` in green, `Failed` in red), Ethereal preview links, and a sandboxed HTML email detail drawer. |

---

## 3. System Architecture & Engineering Deep-Dive

### A. How Scheduling Works (Zero Cron)
When a batch of $N$ leads is submitted via `POST /api/emails/schedule` with `startTime`, `delayBetweenSec` (e.g., `2s`), and `hourlyLimit`:
1. Each lead $i \in [0, N-1]$ is assigned an initial staggered target timestamp:
   $$T_i = \max(\text{now}, \text{startTime}) + (i \times \text{delayBetweenSec} \times 1000)$$
2. All $N$ records are persisted in PostgreSQL (`EmailJob` table) with status `SCHEDULED` and a deterministic `bullJobId = email-job-${id}`.
3. All $N$ jobs are bulk-enqueued into BullMQ (`emailQueue.addBulk`) with `delay = T_i - Date.now()`. BullMQ stores these in a Redis Sorted Set (`ZSET`) scored by execution timestamp.

### B. Persistence & Crash Recovery Across Restarts
The system survives abrupt process termination (`SIGINT`, `SIGKILL`, or container restart) through three layers:
1. **Redis Persistence:** Redis is configured with `--appendonly yes` in Docker, persisting BullMQ delayed sorted sets to disk.
2. **Startup Reconciliation (`reconcilePendingJobsOnStartup`):** On backend boot (`src/index.ts`), the server queries PostgreSQL for all jobs in `SCHEDULED` or `RATE_LIMITED` status and verifies their presence in BullMQ (`emailQueue.getJob(bullJobId)`). Any job that was committed to PostgreSQL right before a crash is deterministically re-enqueued for its exact remaining delay.
3. **No Re-Sending from Day 1:** Completed jobs are marked `SENT` in PostgreSQL immediately upon SMTP acknowledgement. Upon restart, only future/pending jobs remain in the queue.

### C. Distributed Rate Limiting, Concurrency & Minimum Delay
Because `emailWorker` runs with configurable concurrency (`WORKER_CONCURRENCY=5`) and can scale horizontally across multiple Node instances, in-memory counters cannot be used. We solve both rate-limiting requirements using two **atomic Redis Lua scripts** in `src/services/ratelimit.service.ts`:

1. **Hourly Rate Limit & Order-Preserving Window Rollover (`HOURLY_LIMIT_LUA`):**
   - Keys are scoped per sender and UTC hour window: `ratelimit:hourly:{senderId}:{YYYY-MM-DDTHH}`.
   - The Lua script atomically reads the current count. If `current < maxLimit`, it increments the counter and sets a 2-hour TTL.
   - **Behavior Under Load (e.g., 1,000+ emails scheduled simultaneously):** Once `current >= maxLimit`, the Lua script does **not** fail the job. Instead, it atomically increments a next-hour overflow sequence counter (`ratelimit:overflow_seq:{senderId}:{nextHourKey}`) and returns `overflowIndex` ($1, 2, 3, \dots$).
   - The worker computes the exact rescheduled timestamp in the next hour window staggered by `overflowIndex`:
     $$T_{\text{reschedule}} = T_{\text{nextHourStart}} + (\text{overflowIndex} - 1) \times (\text{minDelaySeconds} \times 1000)$$
   - The worker updates the PostgreSQL & Elasticsearch status to `RATE_LIMITED`, calls `await job.moveToDelayed(T_reschedule, token)`, and throws `new DelayedError()`. This moves the job cleanly back into BullMQ's delayed set without consuming retry attempts or losing FIFO ordering.

2. **Minimum Delay Between Individual Sends (`MIN_DELAY_SLOT_LUA`):**
   - We enforce a minimum delay of **`2 seconds`** (`DEFAULT_MIN_DELAY_SECONDS=2`, configurable via `.env` and per campaign) between consecutive sends to mimic SMTP provider throttling.
   - Before opening an SMTP connection, the worker executes `MIN_DELAY_SLOT_LUA` against `ratelimit:min_delay:{senderId}`. The script atomically reserves the next send slot (`nextAvailableMs + minDelayMs`) and returns the exact `waitMs` required so parallel worker threads never fire simultaneously.

### D. Idempotency & Duplicate Send Prevention
1. **Schedule-Time Deduplication:** Each email job generates a deterministic SHA-256 `idempotencyKey = sha256(userId:senderId:campaignId:recipientEmail)` enforced by a PostgreSQL `@unique` constraint and deterministic BullMQ `jobId` (`email-job-${id}`).
2. **Execution-Time Guard:** At the start of `emailWorker`, the worker checks `if (emailRecord.status === 'SENT') return;`. Even if a worker crashes 1ms after SMTP delivery before acknowledging BullMQ, the retry inspection sees `status === 'SENT'` and exits idempotently without sending a duplicate email.

### E. Live Slack Notification on Rate Limit Hit
- Users click **Connect Slack** in the dashboard profile menu to complete a real Slack OAuth v2 flow (`/api/auth/slack` $\rightarrow$ `/api/auth/slack/callback`), storing the workspace token/webhook in PostgreSQL.
- When a sender hits their hourly limit, `RateLimitService.shouldSendSlackRateLimitAlert()` executes `SET ratelimit:slack_alerted:{senderId}:{hourWindowKey} 1 EX 3600 NX`.
- Only the first job that breaches the cap in that hour window receives `'OK'` from Redis `SETNX`, triggering `SlackService.notifyRateLimitHit()` to post a live message to the user's Slack channel (preventing alert storms when hundreds of jobs overflow). If Slack is disconnected, the service safely no-ops.

---

## 4. Prerequisites & Infrastructure Setup

Ensure you have the following installed:
* **Node.js** (v18+ / v20+) and **npm**
* **Docker & Docker Compose** (for PostgreSQL, Redis, and Elasticsearch)

Start the infrastructure containers from the repository root:
```bash
npm run docker:up
```
This launches:
* `reachinbox_postgres` on port `5432`
* `reachinbox_redis` on port `6379` (with AOF persistence)
* `reachinbox_elasticsearch` on port `9200`

---

## 5. Environment Variables Setup

### A. Backend (`apps/api/.env`)
Create `apps/api/.env`:

```env
PORT=5000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000

# Database
DATABASE_URL="postgresql://user:password@localhost:5432/xxxxyyyy?schema=public"

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Elasticsearch
ELASTICSEARCH_NODE=http://localhost:9200

# Worker Concurrency, Throttle & Rate Limiting Defaults
WORKER_CONCURRENCY=5
DEFAULT_MIN_DELAY_SECONDS=2
MAX_EMAILS_PER_HOUR_PER_SENDER=50

# JWT Secret
JWT_SECRET=super_secret_abcdfgihjwt_key_change_in_prod

# Google OAuth 2.0 Credentials
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:5000/api/auth/google/callback

# Slack OAuth 2.0 Credentials
SLACK_CLIENT_ID=your_slack_client_id
SLACK_CLIENT_SECRET=your_slack_client_secret
SLACK_REDIRECT_URI=http://localhost:5000/api/auth/slack/callback
```

* **Ethereal Email Setup:** No manual Ethereal credentials are required in `.env`! The backend automatically provisions real Ethereal SMTP accounts via `nodemailer.createTestAccount()` when a user registers or clicks **+ New Sender** in the dashboard, storing the generated `smtpUser` and `smtpPass` in PostgreSQL and returning live `https://ethereal.email/message/...` preview URLs for every sent email.

### B. Frontend (`apps/web/.env.local`)
Create `apps/web/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:5000
```

---

## 6. How to Run the Application

1. **Install dependencies across the monorepo (from root):**
   ```bash
   npm install
   ```

2. **Start Docker services (PostgreSQL, Redis, Elasticsearch):**
   ```bash
   npm run docker:up
   ```

3. **Run Prisma database migrations (from `apps/api`):**
   ```bash
   cd apps/api
   npx prisma migrate dev
   npx prisma generate
   cd ../..
   ```

4. **Start the Express API & BullMQ Worker (Terminal 1):**
   ```bash
   npm run dev:api
   ```
   * Backend API: `http://localhost:5000`
   * Live Bull Board Queue Monitor: `http://localhost:5000/admin/queues`

5. **Start the Next.js Frontend (Terminal 2):**
   ```bash
   npm run dev:web
   ```
   * Frontend Dashboard: `http://localhost:3000`

---

## 7. Design Decisions, Assumptions & Trade-offs

1. **BullMQ `moveToDelayed` vs. Native BullMQ Global Limiter:**
   - BullMQ's built-in queue-level `limiter` applies globally across the entire queue rather than dynamically per-sender with configurable per-campaign hourly caps. By implementing custom atomic Redis Lua scripts (`HOURLY_LIMIT_LUA` and `MIN_DELAY_SLOT_LUA`) paired with `job.moveToDelayed()`, we support heterogeneous per-sender hourly limits, preserve FIFO order across hour boundaries, and update PostgreSQL/Elasticsearch states (`RATE_LIMITED`) transparently so users can see exact rescheduled times in the UI.
2. **Co-located Express Server & Worker Process for Local Dev Ergonomics:**
   - For streamlined local evaluation (`npm run dev:api`), the BullMQ worker (`src/queues/email.worker.ts`) boots alongside the Express server. Because all state (rate-limit counters, send-slot locks, Slack alert locks, and job payloads) lives in Redis and PostgreSQL, the worker can be split into $N$ standalone container replicas in production with zero code changes.
3. **Auto-Provisioned Ethereal Senders:**
   - To eliminate manual credential copy-pasting while testing multi-sender workflows, logging in via Google automatically provisions an Ethereal test account for the user, and clicking **+ New Sender** dynamically creates additional isolated Ethereal accounts.