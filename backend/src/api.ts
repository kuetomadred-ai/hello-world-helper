import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { orderPayloadSchema } from "./domain.js";
import { getEngineStatus } from "./runtime-state.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const supabaseUrl = required("SUPABASE_URL");
const anonKey = required("SUPABASE_ANON_KEY");
const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const adminClient = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const verifier = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const app = Fastify({
  logger: true,
  bodyLimit: 16_384,
  trustProxy: false,
  genReqId: () => randomUUID(),
});
const rateWindowMs = 60_000;
const rateLimit = 120;
const rateBuckets = new Map<string, { count: number; expiresAt: number }>();

app.addHook("onRequest", async (request, reply) => {
  reply
    .header("X-Request-Id", request.id)
    .header("X-Content-Type-Options", "nosniff")
    .header("X-Frame-Options", "DENY")
    .header("Referrer-Policy", "no-referrer")
    .header("Cache-Control", "no-store");

  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    reply.header("Access-Control-Allow-Origin", origin).header("Vary", "Origin");
    reply
      .header("Access-Control-Allow-Headers", "authorization,content-type")
      .header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  } else if (origin) {
    return reply.code(403).send({ error: "Origin not allowed" });
  }
  if (request.method === "OPTIONS") return reply.code(204).send();
  if (request.url === "/health") return;

  const now = Date.now();
  let bucket = rateBuckets.get(request.ip);
  if (!bucket || bucket.expiresAt <= now) {
    bucket = { count: 0, expiresAt: now + rateWindowMs };
    rateBuckets.set(request.ip, bucket);
  }
  bucket.count += 1;
  reply
    .header("X-RateLimit-Limit", rateLimit)
    .header("X-RateLimit-Remaining", Math.max(0, rateLimit - bucket.count));
  if (bucket.count > rateLimit) {
    reply.header("Retry-After", Math.ceil((bucket.expiresAt - now) / 1000));
    return reply.code(429).send({ error: "Too many requests" });
  }
  if (rateBuckets.size > 10_000) {
    for (const [ip, current] of rateBuckets) {
      if (current.expiresAt <= now) rateBuckets.delete(ip);
    }
  }
});

async function auth(request: FastifyRequest) {
  const token = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  const { data, error } = await verifier.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, role: data.user.app_metadata?.role as string | undefined };
}

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await auth(request);
  if (!user) {
    await reply.code(401).send({ error: "Valid Supabase session required" });
    return null;
  }
  return user;
}

function rpcError(error: { message: string; code?: string }) {
  const status =
    error.code === "42501"
      ? 403
      : error.code === "P0002"
        ? 404
        : error.code === "55000" || error.code === "23505" || error.code === "P0001"
          ? 409
          : error.code === "22023"
            ? 400
            : 503;
  return {
    status,
    body: { error: status === 503 ? "Trading service unavailable" : error.message },
  };
}

async function readTradingState(userId: string) {
  const { data: accounts, error: accountError } = await adminClient
    .from("pf_engine_accounts")
    .select("id,initial_balance,balance,leverage,status,created_at,updated_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(100);
  if (accountError) throw accountError;
  if (!accounts?.length) {
    return { accounts: [], openPositions: [], pendingOrders: [], closedTrades: [], ledger: [] };
  }

  const [positions, orders, trades, ledger] = await Promise.all([
    adminClient
      .from("pf_engine_positions")
      .select(
        "id,order_id,account_id,symbol,side,lots,entry_price,stop_loss,take_profit,status,opened_at",
      )
      .eq("user_id", userId)
      .eq("status", "OPEN")
      .order("opened_at", { ascending: false })
      .limit(500),
    adminClient
      .from("pf_engine_orders")
      .select(
        "id,account_id,symbol,side,order_type,lots,trigger_price,stop_loss,take_profit,status,reason,created_at",
      )
      .eq("user_id", userId)
      .eq("status", "PENDING")
      .order("created_at", { ascending: false })
      .limit(500),
    adminClient
      .from("pf_engine_trades_history")
      .select(
        "id,request_id,position_id,account_id,symbol,side,lots_closed,entry_price,exit_price,realized_pnl,close_reason,opened_at,closed_at,details",
      )
      .eq("user_id", userId)
      .order("closed_at", { ascending: false })
      .limit(500),
    adminClient
      .from("pf_engine_ledger")
      .select("id,request_id,account_id,position_id,event,amount,balance_after,details,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  const failure = positions.error ?? orders.error ?? trades.error ?? ledger.error;
  if (failure) throw failure;
  return {
    accounts: accounts ?? [],
    openPositions: positions.data ?? [],
    pendingOrders: orders.data ?? [],
    closedTrades: trades.data ?? [],
    ledger: ledger.data ?? [],
  };
}

async function readAccountState(userId: string, accountId: string) {
  const { data: account, error: accountError } = await adminClient
    .from("pf_engine_accounts")
    .select("id,initial_balance,balance,leverage,status,created_at,updated_at")
    .eq("user_id", userId)
    .eq("id", accountId)
    .maybeSingle();
  if (accountError) throw accountError;
  if (!account) return null;

  const [positions, orders, trades, ledger] = await Promise.all([
    adminClient
      .from("pf_engine_positions")
      .select(
        "id,order_id,account_id,symbol,side,lots,entry_price,stop_loss,take_profit,status,opened_at",
      )
      .eq("user_id", userId)
      .eq("account_id", account.id)
      .eq("status", "OPEN")
      .order("opened_at", { ascending: false })
      .limit(500),
    adminClient
      .from("pf_engine_orders")
      .select(
        "id,account_id,symbol,side,order_type,lots,trigger_price,stop_loss,take_profit,status,reason,created_at",
      )
      .eq("user_id", userId)
      .eq("account_id", account.id)
      .eq("status", "PENDING")
      .order("created_at", { ascending: false })
      .limit(500),
    adminClient
      .from("pf_engine_trades_history")
      .select(
        "id,request_id,position_id,account_id,symbol,side,lots_closed,entry_price,exit_price,realized_pnl,close_reason,opened_at,closed_at,details",
      )
      .eq("user_id", userId)
      .eq("account_id", account.id)
      .order("closed_at", { ascending: false })
      .limit(500),
    adminClient
      .from("pf_engine_ledger")
      .select("id,request_id,account_id,position_id,event,amount,balance_after,details,created_at")
      .eq("user_id", userId)
      .eq("account_id", account.id)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  const failure = positions.error ?? orders.error ?? trades.error ?? ledger.error;
  if (failure) throw failure;
  const openPositions = positions.data ?? [];
  const pendingOrders = orders.data ?? [];
  const closedTrades = trades.data ?? [];
  return {
    account,
    positions: openPositions,
    orders: pendingOrders,
    ledger: ledger.data ?? [],
    openPositions,
    pendingOrders,
    closedTrades,
  };
}

app.get("/health", async () => {
  const engine = getEngineStatus();
  return {
    ok: true,
    service: "paper-trading-api",
    workerStatus: engine.status,
    brokerConnected: engine.brokerConnected,
    updatedAt: engine.updatedAt,
  };
});

app.get("/v1/trading/state", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  try {
    return await readTradingState(user.id);
  } catch (error) {
    request.log.error({ err: error }, "Unable to load trading state");
    return reply.code(503).send({ error: "Trading state unavailable" });
  }
});

app.get("/v1/admin/accounts", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (user.role !== "ADMIN") return reply.code(403).send({ error: "ADMIN role required" });
  const { data, error } = await adminClient
    .from("pf_engine_accounts")
    .select("id,user_id,initial_balance,balance,leverage,status,created_at,updated_at")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return reply.code(503).send({ error: "Trading accounts unavailable" });
  return { accounts: data ?? [] };
});

app.post("/v1/admin/accounts", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  if (user.role !== "ADMIN") return reply.code(403).send({ error: "ADMIN role required" });
  const parsed = z
    .object({
      userId: z.string().uuid(),
      accountId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
      initialBalance: z.number().positive().max(10_000_000),
      leverage: z.number().min(1).max(1000).default(100),
    })
    .strict()
    .safeParse(request.body);
  if (!parsed.success)
    return reply
      .code(400)
      .send({ error: "Invalid account provisioning request", issues: parsed.error.issues });
  const { data, error } = await adminClient.rpc("pf_engine_provision_account", {
    p_admin_id: user.id,
    p_user_id: parsed.data.userId,
    p_account_id: parsed.data.accountId,
    p_initial_balance: parsed.data.initialBalance,
    p_leverage: parsed.data.leverage,
  });
  if (error) {
    const result = rpcError(error);
    return reply.code(result.status).send(result.body);
  }
  return reply.code(201).send(data);
});

app.post("/v1/orders", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const parsed = orderPayloadSchema.safeParse(request.body);
  if (!parsed.success)
    return reply.code(400).send({ error: "Invalid order", issues: parsed.error.issues });
  const order = parsed.data;
  const { data, error } = await adminClient.rpc("pf_engine_place_order", {
    p_user_id: user.id,
    p_account_id: order.accountId,
    p_request_id: order.requestId,
    p_symbol: order.symbol,
    p_side: order.side,
    p_order_type: order.type,
    p_lots: order.lots,
    p_trigger: order.price ?? null,
    p_sl: order.stopLoss ?? null,
    p_tp: order.takeProfit ?? null,
  });
  if (error) {
    const result = rpcError(error);
    return reply.code(result.status).send(result.body);
  }
  return reply.code(201).send(data);
});

app.post("/v1/positions/:id/close", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
  const body = z.object({ requestId: z.string().uuid() }).strict().safeParse(request.body);
  if (!params.success || !body.success)
    return reply.code(400).send({ error: "Position id and idempotency key must be UUIDs" });
  const { data, error } = await adminClient.rpc("pf_engine_close_position", {
    p_user_id: user.id,
    p_position_id: params.data.id,
    p_request_id: body.data.requestId,
  });
  if (error) {
    const result = rpcError(error);
    return reply.code(result.status).send(result.body);
  }
  return data;
});

app.post("/v1/positions/:id/close-partial", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
  const body = z
    .object({ requestId: z.string().uuid(), lots: z.number().finite().min(0.01).max(99.99) })
    .strict()
    .safeParse(request.body);
  if (!params.success || !body.success)
    return reply.code(400).send({ error: "Invalid partial close request" });
  const { data, error } = await adminClient.rpc("pf_engine_close_partial", {
    p_user_id: user.id,
    p_position_id: params.data.id,
    p_close_lots: body.data.lots,
    p_request_id: body.data.requestId,
  });
  if (error) {
    const result = rpcError(error);
    return reply.code(result.status).send(result.body);
  }
  return data;
});

app.post("/v1/positions/:id/protection", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
  const body = z
    .object({
      stopLoss: z.number().positive().nullable(),
      takeProfit: z.number().positive().nullable(),
    })
    .strict()
    .safeParse(request.body);
  if (!params.success || !body.success)
    return reply.code(400).send({ error: "Invalid protection request" });
  const { data, error } = await adminClient.rpc("pf_engine_modify_position", {
    p_user_id: user.id,
    p_position_id: params.data.id,
    p_sl: body.data.stopLoss,
    p_tp: body.data.takeProfit,
  });
  if (error) {
    const result = rpcError(error);
    return reply.code(result.status).send(result.body);
  }
  return data;
});

app.post("/v1/orders/:id/cancel", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: "Invalid order id" });
  const { data, error } = await adminClient.rpc("pf_engine_cancel_order", {
    p_user_id: user.id,
    p_order_id: params.data.id,
  });
  if (error) {
    const result = rpcError(error);
    return reply.code(result.status).send(result.body);
  }
  return data;
});

app.post("/v1/orders/:id/modify", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
  const body = z
    .object({
      price: z.number().positive(),
      stopLoss: z.number().positive().nullable(),
      takeProfit: z.number().positive().nullable(),
    })
    .strict()
    .safeParse(request.body);
  if (!params.success || !body.success)
    return reply.code(400).send({ error: "Invalid order modification" });
  const { data, error } = await adminClient.rpc("pf_engine_modify_order", {
    p_user_id: user.id,
    p_order_id: params.data.id,
    p_trigger: body.data.price,
    p_sl: body.data.stopLoss,
    p_tp: body.data.takeProfit,
  });
  if (error) {
    const result = rpcError(error);
    return reply.code(result.status).send(result.body);
  }
  return data;
});

app.get("/v1/accounts", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const { data, error } = await adminClient
    .from("pf_engine_accounts")
    .select("id,initial_balance,balance,leverage,status,created_at,updated_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) return reply.code(503).send({ error: "Trading accounts unavailable" });
  return { accounts: data ?? [] };
});

app.get("/v1/accounts/:id/state", async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string().min(1).max(80) }).safeParse(request.params);
  if (!params.success) return reply.code(400).send({ error: "Invalid account id" });
  let state: Awaited<ReturnType<typeof readAccountState>>;
  try {
    state = await readAccountState(user.id, params.data.id);
  } catch (error) {
    request.log.error({ err: error }, "Unable to load account state");
    return reply.code(503).send({ error: "Trading state unavailable" });
  }
  if (!state) return reply.code(404).send({ error: "Account not found" });
  return state;
});

export async function startApi() {
  const port = Number(process.env.PORT ?? 8787);
  await app.listen({ host: "0.0.0.0", port });
  return app;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) await startApi();
