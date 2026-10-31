import { redisConnection } from '../config/redis.js';

const HOURLY_LIMIT_LUA = `
  local counterKey = KEYS[1]
  local overflowSeqKey = KEYS[2]
  local maxLimit = tonumber(ARGV[1])
  local ttlSeconds = tonumber(ARGV[2])

  local current = tonumber(redis.call('GET', counterKey) or "0")
  if current >= maxLimit then
    local overflowIndex = redis.call('INCR', overflowSeqKey)
    if overflowIndex == 1 then
      redis.call('EXPIRE', overflowSeqKey, 7200)
    end
    return { 0, current, overflowIndex }
  end

  local updated = redis.call('INCR', counterKey)
  if updated == 1 then
    redis.call('EXPIRE', counterKey, ttlSeconds)
  end

  return { 1, updated, 0 }
`;

const MIN_DELAY_SLOT_LUA = `
  local slotKey = KEYS[1]
  local nowMs = tonumber(ARGV[1])
  local minDelayMs = tonumber(ARGV[2])

  local nextAvailableMs = tonumber(redis.call('GET', slotKey) or "0")
  if nowMs >= nextAvailableMs then
    redis.call('SET', slotKey, nowMs + minDelayMs, 'PX', minDelayMs * 10)
    return 0
  else
    local waitMs = nextAvailableMs - nowMs
    redis.call('SET', slotKey, nextAvailableMs + minDelayMs, 'PX', (waitMs + minDelayMs) * 2)
    return waitMs
  end
`;

export interface HourlyCheckResult {
  allowed: boolean;
  currentCount: number;
  rescheduleTimestampMs?: number;
  hourWindowKey: string;
}

export class RateLimitService {
  /**
   * Returns current UTC hour window string: e.g. "2026-10-31T10"
   */
  static getHourWindowKey(date = new Date()): string {
    return date.toISOString().slice(0, 13);
  }

  /**
   * Atomically checks & increments the hourly counter for a sender.
   * If limit is reached, computes a staggered timestamp in the next hour window.
   */
  static async checkAndIncrementHourlyLimit(
    senderId: string,
    maxPerHour: number,
    minDelaySeconds: number
  ): Promise<HourlyCheckResult> {
    const now = new Date();
    const hourWindowKey = this.getHourWindowKey(now);

    // Calculate start of the NEXT hour
    const nextHourDate = new Date(now);
    nextHourDate.setUTCMinutes(0, 0, 0);
    nextHourDate.setUTCHours(nextHourDate.getUTCHours() + 1);
    const nextHourWindowKey = this.getHourWindowKey(nextHourDate);

    const counterKey = `ratelimit:hourly:${senderId}:${hourWindowKey}`;
    const overflowSeqKey = `ratelimit:overflow_seq:${senderId}:${nextHourWindowKey}`;

    const result = (await redisConnection.eval(
      HOURLY_LIMIT_LUA,
      2,
      counterKey,
      overflowSeqKey,
      maxPerHour,
      7200 // 2 hour expiry
    )) as [number, number, number];

    const [allowedFlag, currentCount, overflowIndex] = result;

    if (allowedFlag === 1) {
      return {
        allowed: true,
        currentCount,
        hourWindowKey,
      };
    }

    // Limit reached: reschedule into next hour window, staggered by overflowIndex * minDelaySeconds
    // so queued jobs preserve order and don't stampede at minute 00:00.
    const staggerOffsetMs = (overflowIndex - 1) * (minDelaySeconds * 1000);
    const rescheduleTimestampMs = nextHourDate.getTime() + staggerOffsetMs;

    return {
      allowed: false,
      currentCount,
      rescheduleTimestampMs,
      hourWindowKey,
    };
  }

  /**
   * Ensures a minimum gap (e.g. 2 seconds) between consecutive sends for a given sender,
   * even across multiple concurrent workers.
   */
  static async acquireMinDelaySlot(senderId: string, minDelaySeconds: number): Promise<number> {
    const slotKey = `ratelimit:min_delay:${senderId}`;
    const nowMs = Date.now();
    const minDelayMs = minDelaySeconds * 1000;

    const waitMs = (await redisConnection.eval(
      MIN_DELAY_SLOT_LUA,
      1,
      slotKey,
      nowMs,
      minDelayMs
    )) as number;

    return waitMs;
  }

  /**
   * Ensures we only fire ONE Slack alert per sender per hour window when the limit is hit.
   */
  static async shouldSendSlackRateLimitAlert(senderId: string, hourWindowKey: string): Promise<boolean> {
    const alertKey = `ratelimit:slack_alerted:${senderId}:${hourWindowKey}`;
    const setResult = await redisConnection.set(alertKey, '1', 'EX', 3600, 'NX');
    return setResult === 'OK';
  }
}