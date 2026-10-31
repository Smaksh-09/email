# 🚀 Database Setup - Quick Start

## Issue Fixed ✅

The Prisma migration issues have been resolved:

1. ✅ Moved `schema.prisma` to the correct location: `prisma/schema.prisma`
2. ✅ Removed incomplete `prisma.config.ts` 
3. ✅ Schema validation passes
4. ✅ Environment variables configured correctly
5. ✅ Created seed script template
6. ✅ Updated package.json scripts

## What Was Wrong?

- **Schema location**: Prisma expects the schema in `prisma/schema.prisma`, not in the root
- **Config file**: The `prisma.config.ts` was incomplete and causing issues
- **No migrations directory**: Fresh setup needed

## Next Steps - Run These Commands

### Step 1: Start Docker Services

```bash
# Make sure Docker Desktop is running first!
# Then from the project root (C:\Users\Asus\email):
npm run docker:up
```

Wait for PostgreSQL to be ready (about 10-15 seconds).

### Step 2: Run Your First Migration

```bash
# Option A: From project root
cd C:\Users\Asus\email\apps\api
npx prisma migrate dev --name init

# Option B: Using workspace command
cd C:\Users\Asus\email
npm run dev:api -- prisma:migrate
```

### Step 3: Generate Prisma Client

```bash
npx prisma generate
```

### Step 4: Verify Setup

```bash
# Open Prisma Studio to see your database
npx prisma studio
```

This will open a web interface at `http://localhost:5555` where you can view your tables.

### Step 5: Start Your API

```bash
# From project root
npm run dev:api
```

## Quick Reference

```bash
# Check if Docker is running
docker ps

# Check if PostgreSQL is ready
docker logs reachinbox_postgres

# Stop all services
npm run docker:down

# Reset database (WARNING: deletes all data)
npx prisma migrate reset

# View database in browser
npx prisma studio
```

## Troubleshooting

### "Docker Desktop is not running"
- Open Docker Desktop application
- Wait for it to fully start (green icon)
- Run `docker ps` to verify

### "Port 5432 already in use"
- Another PostgreSQL instance is running
- Stop it: `net stop postgresql` (Windows)
- Or change the port in `docker-compose.yml`

### "Cannot connect to database"
- Check Docker is running: `docker ps`
- Check container logs: `docker logs reachinbox_postgres`
- Verify .env has correct DATABASE_URL

### "Prisma schema validation failed"
- Run: `npx prisma format` to auto-format
- Run: `npx prisma validate` to check for errors

## Your Database Schema

Your schema includes:
- **User**: OAuth authentication, Slack integration
- **Sender**: SMTP configurations for sending emails
- **Campaign**: Email campaigns with scheduling
- **EmailJob**: Individual email queue jobs with tracking

All tables are ready to use once you run the migration! 🎉
