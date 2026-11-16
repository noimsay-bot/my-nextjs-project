import "server-only";

// 서버 인스턴스 메모리 기반의 고정 창(fixed window) 호출 횟수 제한.
// 서버리스 인스턴스마다 카운터가 따로라 완전한 차단은 아니고, 한 곳에서 몰아치는
// 반복 호출을 늦추는 용도다. 계정 단위의 확실한 제한은 DB/Auth 쪽 값으로 따로 건다.

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const MAX_BUCKETS = 5000;
const buckets = new Map<string, RateLimitBucket>();

function pruneExpiredBuckets(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
  // 만료된 것만 지워도 여전히 넘치면 가장 오래된 키부터 버린다.
  while (buckets.size >= MAX_BUCKETS) {
    const oldestKey = buckets.keys().next().value;
    if (oldestKey === undefined) break;
    buckets.delete(oldestKey);
  }
}

export function getClientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for") ?? "";
  const firstForwarded = forwardedFor.split(",")[0]?.trim();
  return firstForwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function consumeRateLimit(input: { key: string; limit: number; windowMs: number; now?: number }) {
  const now = input.now ?? Date.now();
  const existing = buckets.get(input.key);

  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) {
      pruneExpiredBuckets(now);
    }
    buckets.set(input.key, { count: 1, resetAt: now + input.windowMs });
    return { allowed: true as const, retryAfterSeconds: 0 };
  }

  if (existing.count >= input.limit) {
    return {
      allowed: false as const,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return { allowed: true as const, retryAfterSeconds: 0 };
}
