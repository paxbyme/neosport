// In-memory windows. On Vercel each function instance keeps its own map, so this
// slows an attacker down rather than stopping them dead; it is the right shape
// for the traffic this shop sees, and the Vercel firewall is the next step up.
const buckets = new Map();

export const clientAddress = (request) =>
  String(request?.headers?.["x-forwarded-for"] || request?.socket?.remoteAddress || "unknown")
    .split(",")[0]
    .trim();

export const checkRateLimit = (bucket, key, { max, windowMs }) => {
  const now = Date.now();
  const windowStart = now - windowMs;
  const hits = buckets.get(bucket) || new Map();
  const recent = (hits.get(key) || []).filter((time) => time > windowStart);

  if (recent.length >= max) {
    hits.set(key, recent);
    buckets.set(bucket, hits);
    return false;
  }

  recent.push(now);
  hits.set(key, recent);
  buckets.set(bucket, hits);

  // Drop keys whose window has fully passed, so a long-running instance does
  // not hold every address it has ever seen.
  if (hits.size > 500) {
    for (const [candidate, times] of hits) {
      if (times.every((time) => time <= windowStart)) hits.delete(candidate);
    }
  }

  return true;
};

export const resetRateLimits = () => buckets.clear();
