import { Redis } from 'ioredis';
import { env } from './env.js';

export const redisConnection = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  maxRetriesPerRequest: null,
});

// ioredis emits one error per retry; log only the first of each outage.
let outageLogged = false;

redisConnection.on('error', (err) => {
  if (outageLogged) return;
  outageLogged = true;
  const reason = err.message || (err as NodeJS.ErrnoException).code || err.name;
  console.error(`[Redis] Connection error (${reason}) at ${env.REDIS_HOST}:${env.REDIS_PORT}. Retrying...`);
});

redisConnection.on('ready', () => {
  if (outageLogged) console.log('[Redis] Connection restored');
  outageLogged = false;
});
