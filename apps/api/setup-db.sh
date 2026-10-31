#!/bin/bash

echo "================================"
echo "Prisma Database Setup"
echo "================================"
echo ""

echo "[1/4] Checking Docker..."
if ! docker ps > /dev/null 2>&1; then
    echo "❌ Docker is not running!"
    echo "Please start Docker Desktop and run this script again."
    exit 1
fi
echo "✅ Docker is running"

echo ""
echo "[2/4] Starting PostgreSQL container..."
cd ../..
docker compose up -d postgres
if [ $? -ne 0 ]; then
    echo "❌ Failed to start PostgreSQL"
    exit 1
fi
echo "✅ PostgreSQL started"

echo ""
echo "[3/4] Waiting for PostgreSQL to be ready..."
sleep 5
echo "✅ PostgreSQL should be ready"

echo ""
echo "[4/4] Running Prisma migrations..."
cd apps/api
npx prisma migrate dev --name init
if [ $? -ne 0 ]; then
    echo "❌ Migration failed"
    echo "Check the error message above"
    exit 1
fi

echo ""
echo "================================"
echo "✅ Setup Complete!"
echo "================================"
echo ""
echo "Your database is ready. You can now:"
echo "  - Run: npm run dev:api (to start the server)"
echo "  - Run: npx prisma studio (to view the database)"
echo ""
