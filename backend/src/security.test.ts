import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  FixedWindowRateLimiter,
  isAllowedOrigin,
  registerSecurity,
  requestIdGenerator,
} from "./security.js";

describe("PLUTUS API security baseline", () => {
  let app: ReturnType<typeof Fastify> | undefined;

  afterEach(async () => {
    if (app) await app.close();
    app = undefined;
  });

  it("sets security headers and returns a fresh request ID rather than trusting the client", async () => {
    app = Fastify({
      logger: false,
      genReqId: requestIdGenerator,
      trustProxy: false,
    });
    registerSecurity(app, {
      allowedOrigins: ["https://app.example"],
      rateLimit: { max: 10 },
    });
    app.get("/api", async () => ({ ok: true }));

    const response = await app.inject({
      method: "GET",
      url: "/api",
      headers: {
        origin: "https://app.example",
        "x-request-id": "attacker-value",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-request-id"]).not.toBe("attacker-value");
    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("rate limits by bounded process-local key and exempts the configured health route", async () => {
    app = Fastify({
      logger: false,
      genReqId: requestIdGenerator,
      trustProxy: false,
    });
    const limiter = new FixedWindowRateLimiter({
      windowMs: 60_000,
      max: 1,
      maxEntries: 2,
    });
    registerSecurity(app, { limiter, healthPath: "/health" });
    app.get("/health", async () => ({ healthy: true }));
    app.get("/api", async () => ({ ok: true }));

    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api" })).statusCode).toBe(200);
    const limited = await app.inject({ method: "GET", url: "/api" });
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    expect(limited.headers["x-request-id"]).toBeTruthy();
    expect(limiter.size).toBeLessThanOrEqual(2);
  });

  it("rejects disallowed browser origins but permits native requests without Origin", async () => {
    app = Fastify({
      logger: false,
      genReqId: requestIdGenerator,
      trustProxy: false,
    });
    registerSecurity(app, { allowedOrigins: ["https://app.example"] });
    app.get("/api", async () => ({ ok: true }));

    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api",
          headers: { origin: "https://evil.example" },
        })
      ).statusCode,
    ).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api" })).statusCode).toBe(200);
    expect(isAllowedOrigin("https://app.example", ["https://app.example"])).toBe(true);
    expect(isAllowedOrigin("https://evil.example", ["https://app.example"])).toBe(false);
  });
});
