import { createError } from "./errors.js";
import { getRequestIp } from "./request.js";

function defaultKeyGenerator(req) {
  if (req.auth?.user?.id) {
    return `user:${req.auth.user.id}`;
  }

  const ip = getRequestIp(req);
  return ip ? `ip:${ip}` : "ip:unknown";
}

export function createRateLimiter(options = {}) {
  const windowMs = Math.max(1000, Number(options.windowMs || 60_000));
  const max = Math.max(1, Number(options.max || 60));
  const code = options.code || "rate_limited";
  const message = options.message || "操作太频繁，请稍后再试";
  const keyGenerator = options.keyGenerator || defaultKeyGenerator;
  const buckets = new Map();

  return function rateLimit(req, res, next) {
    const now = Date.now();
    const bucketKey = `${options.name || "default"}:${keyGenerator(req)}`;
    const existing = buckets.get(bucketKey);
    const entry = !existing || existing.resetAt <= now
      ? { count: 0, resetAt: now + windowMs }
      : existing;

    entry.count += 1;
    buckets.set(bucketKey, entry);

    for (const [key, value] of buckets) {
      if (value.resetAt <= now) {
        buckets.delete(key);
      }
    }

    const remaining = Math.max(0, max - entry.count);
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));

    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(retryAfterSeconds));

    if (entry.count > max) {
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return next(createError(429, message, { code }));
    }

    next();
  };
}
