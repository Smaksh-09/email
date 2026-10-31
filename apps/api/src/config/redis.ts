import { Redis } from 'ioredis';
import { env } from './env.js';

let errorCount = 0;
const MAX_ERROR_LOGS = 3;
const MAX_RETRIES = 10;
let retryCount = 0;

export const redisConnection = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  maxRetriesPerRequest: null,
  lazyConnect: true,
  retryStrategy(times) {
    retryCount = times;
    
    if (times > MAX_RETRIES) {
      if (errorCount < MAX_ERROR_LOGS) {
        console.error(`[Redis] Max retries (${MAX_RETRIES}) exceeded. Giving up.`);
      }
      return null; // Stop retrying
    }
    
    // Exponential backoff: 200ms, 400ms, 800ms, 1600ms, etc., capped at 30s
    const delay = Math.min(200 * Math.pow(2, times - 1), 30000);
    
    if (errorCount < MAX_ERROR_LOGS) {
      console.warn(`[Redis] Retry attempt ${times}/${MAX_RETRIES} in ${delay}ms...`);
    }
    
    return delay;
  },
});

redisConnection.on('error', (err) => {
  errorCount++;
  if (errorCount <= MAX_ERROR_LOGS) {
    console.error('[Redis] Connection Error:', err.message);
    if (errorCount === MAX_ERROR_LOGS) {
      console.warn('[Redis] Suppressing further error logs to avoid spam.');
    }
  }
});

redisConnection.on('connect', () => {
  console.log('[Redis] Connected successfully');
  errorCount = 0; // Reset error count on successful connection
  retryCount = 0;
});

redisConnection.on('ready', () => {
  console.log('[Redis] Ready to accept commands');
});

/**
 * Gracefully connect to Redis
 * Returns true if connected, false otherwise
 */
export async function connectRedis(): Promise<boolean> {
  try {
    await redisConnection.connect();
    return true;
  } catch (error) {
    if (errorCount < MAX_ERROR_LOGS) {
      console.error('[Redis] Failed to connect:', error instanceof Error ? error.message : error);
    }
    return false;
  }
}