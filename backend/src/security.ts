import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

/**
 * Generates a fresh request identifier for Fastify's `genReqId` option.
 *
 * An incoming `X-Request-ID` is deliberately not trusted or echoed: callers
 * can still correlate requests using the identifier returned in the response.
 */
export function requestIdGenerator(_request: IncomingMessage): string {
  return randomUUID();
}

export interface RateLimitOptions {
  /** Length of a fixed window in milliseconds. Defaults to one minute. */
  windowMs?: number;
  /** Maximum requests allowed for one IP in a window. Defaults to 100. */
  max?: number;
  /** Maximum number of IP entries retained in this process. Defaults to 10,000. */
  maxEntries?: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface WindowEntry {
  windowStart: number;
  count: number;
  lastSeenAt: number;
}

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 100;
const DEFAULT_MAX_ENTRIES = 10_000;

function positiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/**
 * A bounded, process-local fixed-window limiter.
 *
 * This is intentionally single-instance protection, not a complete production
 * rate-limiting solution. Multi-instance production deployments need a shared
 * Redis/Key Value store (or an equivalent central limiter). Cleanup is lazy,
 * and insertion also evicts the oldest entry so the map cannot grow beyond
 * `maxEntries` even when an attacker supplies many distinct source addresses.
 */
export class FixedWindowRateLimiter {
  private readonly entries = new Map<string, WindowEntry>();
  private readonly windowMs: number;
  private readonly max: number;
  private readonly maxEntries: number;

  public constructor(options: RateLimitOptions = {}) {
    this.windowMs = positiveInteger(options.windowMs, DEFAULT_WINDOW_MS);
    this.max = positiveInteger(options.max, DEFAULT_MAX_REQUESTS);
    this.maxEntries = positiveInteger(options.maxEntries, DEFAULT_MAX_ENTRIES);
  }

  public get size(): number {
    return this.entries.size;
  }

  /** Remove expired entries. There is no timer, so idle processes stay idle. */
  public cleanup(now = Date.now()): void {
    for (const [key, entry] of this.entries) {
      if (entry.windowStart + this.windowMs <= now) {
        this.entries.delete(key);
      }
    }
  }

  public check(key: string, now = Date.now()): RateLimitDecision {
    const windowStart = Math.floor(now / this.windowMs) * this.windowMs;
    const windowEnd = windowStart + this.windowMs;

    this.cleanup(now);

    let entry = this.entries.get(key);
    if (entry?.windowStart !== windowStart) {
      entry = undefined;
      this.entries.delete(key);
    }

    if (entry === undefined) {
      this.evictOneIfFull();
      entry = { windowStart, count: 0, lastSeenAt: now };
      this.entries.set(key, entry);
    }

    entry.lastSeenAt = now;

    if (entry.count >= this.max) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((windowEnd - now) / 1_000)),
      };
    }

    entry.count += 1;
    return {
      allowed: true,
      remaining: this.max - entry.count,
      retryAfterSeconds: 0,
    };
  }

  private evictOneIfFull(): void {
    if (this.entries.size < this.maxEntries) {
      return;
    }

    let oldestKey: string | undefined;
    let oldestSeenAt = Number.POSITIVE_INFINITY;
    for (const [key, entry] of this.entries) {
      if (entry.lastSeenAt < oldestSeenAt) {
        oldestKey = key;
        oldestSeenAt = entry.lastSeenAt;
      }
    }
    if (oldestKey !== undefined) {
      this.entries.delete(oldestKey);
    }
  }
}

export interface SecurityOptions {
  /**
   * Exact browser origins allowed to reach non-preflight requests. When
   * omitted, this hook does not apply an Origin policy; existing CORS remains
   * responsible for CORS behavior.
   */
  allowedOrigins?: readonly string[];
  /**
   * Path or paths exempt from rate limiting, for example `/health`. Headers
   * and Origin checks are still applied. Query strings are ignored.
   */
  healthPath?: string | readonly string[];
  /** Set false to keep a health endpoint rate-limited despite `healthPath`. */
  excludeHealthFromRateLimit?: boolean;
  rateLimit?: RateLimitOptions;
  /** Override the response cache policy; defaults to `no-store`. */
  cacheControl?: string;
  /** Supply a limiter in tests or to share one deliberately within this process. */
  limiter?: FixedWindowRateLimiter;
}

const DEFAULT_CACHE_CONTROL = "no-store";

function normalizeOrigin(origin: string): string | undefined {
  const value = origin.trim();
  if (value === "null") {
    return value;
  }

  try {
    const parsed = new URL(value);
    // An Origin is scheme + host only. Reject paths, query strings, fragments,
    // credentials, and other malformed values instead of making them permissive.
    if (
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      return undefined;
    }
    return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}`;
  } catch {
    return undefined;
  }
}

/**
 * Pure origin predicate exported for unit tests and for callers that need to
 * inspect the same exact-origin policy without registering Fastify hooks.
 */
export function isAllowedOrigin(
  origin: string | undefined,
  allowedOrigins: readonly string[],
): boolean {
  if (origin === undefined) {
    return true;
  }
  const normalizedOrigin = normalizeOrigin(origin);
  if (normalizedOrigin === undefined) {
    return false;
  }
  return allowedOrigins.some((allowed) => normalizeOrigin(allowed) === normalizedOrigin);
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function requestPath(url: string): string {
  const queryStart = url.indexOf("?");
  return queryStart === -1 ? url : url.slice(0, queryStart);
}

function normalizedHealthPaths(
  healthPath: string | readonly string[] | undefined,
): ReadonlySet<string> {
  const paths =
    healthPath === undefined ? [] : typeof healthPath === "string" ? [healthPath] : healthPath;

  return new Set(
    paths.map((path) => {
      if (path.length > 1 && path.endsWith("/")) {
        return path.slice(0, -1);
      }
      return path;
    }),
  );
}

function isHealthRequest(request: FastifyRequest, healthPaths: ReadonlySet<string>): boolean {
  const path = requestPath(request.url);
  return healthPaths.has(path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path);
}

/**
 * Register baseline security hooks. This does not replace Fastify CORS.
 *
 * Register it alongside the existing CORS `onRequest` hook. OPTIONS requests
 * receive the security headers but are intentionally not rejected or counted:
 * the existing CORS hook owns preflight processing, so this hook cannot break
 * an otherwise valid preflight. Non-OPTIONS requests with an Origin are
 * rejected when `allowedOrigins` is supplied and do not expose request data.
 */
export function registerSecurity(app: FastifyInstance, options: SecurityOptions = {}): void {
  const allowedOrigins = options.allowedOrigins;
  const limiter = options.limiter ?? new FixedWindowRateLimiter(options.rateLimit);
  const healthPaths = normalizedHealthPaths(options.healthPath);
  const excludeHealthFromRateLimit = options.excludeHealthFromRateLimit ?? true;
  const cacheControl = options.cacheControl ?? DEFAULT_CACHE_CONTROL;

  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id;
    reply.header("X-Request-ID", requestId);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    reply.header("Cache-Control", cacheControl);

    // Do not intercept OPTIONS: api.ts already owns CORS preflight handling.
    if (request.method === "OPTIONS") {
      return;
    }

    const origin = headerValue(request.headers.origin);
    if (
      allowedOrigins !== undefined &&
      origin !== undefined &&
      !isAllowedOrigin(origin, allowedOrigins)
    ) {
      return reply.code(403).type("application/json").send({
        error: "forbidden_origin",
        requestId,
      });
    }

    if (excludeHealthFromRateLimit && isHealthRequest(request, healthPaths)) {
      return;
    }

    // Fastify's request.ip is used deliberately. With trustProxy:false in
    // api.ts it is the socket peer, not an untrusted X-Forwarded-For value.
    // If trustProxy is ever enabled, restrict it to known proxy addresses.
    const decision = limiter.check(request.ip);
    if (!decision.allowed) {
      reply.header("Retry-After", String(decision.retryAfterSeconds));
      return reply.code(429).type("application/json").send({
        error: "rate_limit_exceeded",
        requestId,
      });
    }
  });
}
