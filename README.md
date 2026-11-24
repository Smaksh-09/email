# Outbox

Email campaign scheduling with background delivery, multiple senders, and searchable message history.

Outbox brings recipient lists, message composition, scheduling, and delivery status into one dashboard. It lets an operator prepare a batch, choose a sender, set the sending pace, and inspect individual message outcomes.

The project uses Nodemailer and Ethereal for test email delivery. Each accepted test message has an Ethereal preview link.

## Features

- Sign in with Google and manage multiple sender accounts.
- Compose rich-text emails and import recipients from CSV or text files.
- Schedule a campaign with a start time, spacing between messages, and an hourly limit.
- Process delivery in BullMQ workers with configurable concurrency and retry backoff.
- Defer queued messages when the hourly limit is reached.
- Browse scheduled and completed messages, inspect errors, and search message history.
- Connect Slack for rate-limit notifications and inspect queue state through Bull Board.

## Architecture

```text
Next.js dashboard
       |
       v
Express API ---- PostgreSQL / Prisma
       |         Campaigns, senders, and email job records
       |
       +------- Redis / BullMQ ---- Delivery worker ---- Nodemailer / Ethereal
       |
       +------- Elasticsearch
       |
       +------- Slack
```

PostgreSQL stores campaign and message records. BullMQ runs delayed delivery jobs, while Redis persists queue state using append-only storage. Elasticsearch supports message search. Google handles sign-in, and Slack provides optional operational notifications.

The API and delivery worker run together during local development. Message records carry individual delivery status, timestamps, attempts, and SMTP metadata so an operator can inspect a campaign at recipient level.

### Delivery behavior

A scheduled time is a target. Worker availability, throttling, and retries can move the actual attempt later. Deterministic queue IDs and persisted message status help prevent repeat processing, and reconciliation recovers pending work after restarts.

The `SENT` status records SMTP acceptance. Inbox delivery requires additional provider signals. A crash between SMTP acceptance and recording the result creates an uncertain outcome, so SMTP delivery alone cannot provide an exactly-once guarantee.

## Stack

- **Frontend** — Next.js App Router, React, TypeScript, Tailwind CSS
- **API** — Express, TypeScript, Zod
- **Storage** — PostgreSQL 16 and Prisma
- **Background jobs** — BullMQ and Redis 7
- **Search** — Elasticsearch 8.13
- **Email** — Nodemailer and Ethereal
- **Integrations** — Google OAuth, Slack OAuth, Bull Board

## Run locally

Use Node.js 20.9 or later, npm, and Docker Compose. Google OAuth credentials are required for sign-in. Slack credentials are optional.

### 1. Install dependencies

From the repository root, run the following command.

```bash
npm install
```

### 2. Configure the API

Create `apps/api/.env`.

```env
PORT=5000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000

DATABASE_URL="postgresql://user:password@localhost:5432/reachinbox_db?schema=public"
REDIS_HOST=localhost
REDIS_PORT=6379
ELASTICSEARCH_NODE=http://localhost:9200

WORKER_CONCURRENCY=5
DEFAULT_MIN_DELAY_SECONDS=2
MAX_EMAILS_PER_HOUR_PER_SENDER=50

JWT_SECRET=replace_with_a_long_random_secret

GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:5000/api/auth/google/callback

# Optional Slack integration
SLACK_CLIENT_ID=your_slack_client_id
SLACK_CLIENT_SECRET=your_slack_client_secret
SLACK_REDIRECT_URI=http://localhost:5000/api/auth/slack/callback
```

Register the Google callback URL in your OAuth client configuration and allow your Google account to use the application during local testing. Configure the matching Slack redirect URL if you enable Slack.

Ethereal accounts are created automatically when a user first signs in or adds a sender.

### 3. Configure the frontend

Create `apps/web/.env.local`.

```env
NEXT_PUBLIC_API_URL=http://localhost:5000
```

### 4. Start services and apply migrations

```bash
npm run docker:up
npm run prisma:migrate --workspace=apps/api
npm run prisma:generate --workspace=apps/api
```

PostgreSQL runs on port 5432, Redis on 6379, and Elasticsearch on 9200. The Compose credentials are intended for local development.

### 5. Start the application

Run each command in its own terminal.

```bash
npm run dev:api
```

```bash
npm run dev:web
```

Open [the dashboard](http://localhost:3000). The API runs on port 5000, and [Bull Board](http://localhost:5000/admin/queues) shows the delivery queue.

## Try the workflow

1. Sign in with Google to create your first Ethereal sender.
2. Open Compose and add a few test recipient addresses.
3. Write a subject and message, select the sending pace, and schedule the batch.
4. Watch the status change in the dashboard and inspect the jobs in Bull Board.
5. Open an accepted message's Ethereal preview to inspect its content.
6. Optionally connect Slack and schedule enough messages to exercise the hourly limit.

## Repository layout

```text
apps/api/       Express API, Prisma schema, queues, and delivery services
apps/web/       Next.js dashboard, composer, and message detail views
packages/types/ Shared TypeScript package
docker-compose.yml Local PostgreSQL, Redis, and Elasticsearch services
```

## Build

```bash
npm run build:api
npm run build:web
```
