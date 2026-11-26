const ErrorResponse = require('./errorResponse');

/**
 * Tiny fixed-window in-memory rate limiter (no external dependency).
 * Good enough for a single Node instance; swap for a Redis-backed limiter when scaling out.
 * `key(req)` chooses the bucket (default: client IP).
 */
const MAX_KEYS = 100000; // bounded memory even if a client invents endless keys

const rateLimit = ({ windowMs, max, keyPrefix, message, key = (req) => req.ip }) => {
  const hits = new Map();

  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [bucket, entry] of hits) {
      if (entry.reset <= now) hits.delete(bucket);
    }
  }, windowMs);
  sweeper.unref();

  return (req, res, next) => {
    if (process.env.RATE_LIMIT === 'off') return next();

    const bucket = `${keyPrefix}:${key(req)}`;
    const now = Date.now();
    let entry = hits.get(bucket);
    if (!entry || entry.reset <= now) {
      if (hits.size >= MAX_KEYS) hits.clear();
      entry = { count: 0, reset: now + windowMs };
      hits.set(bucket, entry);
    }
    entry.count += 1;

    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
      return next(new ErrorResponse(message || 'Too many requests. Please try again later.', 429));
    }
    next();
  };
};

module.exports = rateLimit;
