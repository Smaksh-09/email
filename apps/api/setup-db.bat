@echo off
echo ================================
echo Prisma Database Setup
echo ================================
echo.

echo [1/4] Checking Docker...
docker ps >nul 2>&1
if errorlevel 1 (
    echo ❌ Docker is not running!
    echo Please start Docker Desktop and run this script again.
    pause
    exit /b 1
)
echo ✅ Docker is running

echo.
echo [2/4] Starting PostgreSQL container...
cd ..\..
docker compose up -d postgres
if errorlevel 1 (
    echo ❌ Failed to start PostgreSQL
    pause
    exit /b 1
)
echo ✅ PostgreSQL started

echo.
echo [3/4] Waiting for PostgreSQL to be ready...
timeout /t 5 /nobreak >nul
echo ✅ PostgreSQL should be ready

echo.
echo [4/4] Running Prisma migrations...
cd apps\api
call npx prisma migrate dev --name init
if errorlevel 1 (
    echo ❌ Migration failed
    echo Check the error message above
    pause
    exit /b 1
)

echo.
echo ================================
echo ✅ Setup Complete!
echo ================================
echo.
echo Your database is ready. You can now:
echo   - Run: npm run dev:api (to start the server)
echo   - Run: npx prisma studio (to view the database)
echo.
pause
