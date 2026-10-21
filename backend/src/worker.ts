import { createClient } from "@supabase/supabase-js";
import {
  HubConnectionBuilder,
  HttpTransportType,
  LogLevel,
  type HubConnection,
} from "@microsoft/signalr";
import { pathToFileURL } from "node:url";
import { parseEngineTick } from "./domain.js";
import { setEngineStatus } from "./runtime-state.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const supabase = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const providerUrl = (process.env.BIQUOTE_URL ?? "https://biquote.io").replace(/\/+$/, "");
const allowedSymbols = new Set(
  (
    process.env.ENGINE_SYMBOLS ??
    "EURUSD,GBPUSD,USDJPY,USDCHF,USDCAD,AUDUSD,NZDUSD,XAUUSD,XAGUSD,US500,USTEC,US30"
  )
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean),
);
const retryDelayMs = [1_000, 2_000, 5_000, 10_000, 30_000];
const minimumTickIntervalMs = 250;
let stopRequested = false;
let activeConnection: HubConnection | null = null;
let workerPromise: Promise<void> | null = null;

async function loadInstruments(): Promise<string[]> {
  const response = await fetch(`${providerUrl}/api/symbols?quotedWithinDays=7`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Biquote catalogue HTTP ${response.status}`);
  const items: unknown = await response.json();
  if (!Array.isArray(items)) throw new Error("Invalid Biquote catalogue");

  const rows = (items as unknown[]).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    const symbol = String(raw.name ?? "").toUpperCase();
    const tickSize = Number(raw.tickSize);
    const tickValue = Number(raw.tickValue);
    const contractSize = Number(raw.contractSize ?? 1);
    if (!allowedSymbols.has(symbol) || !(tickSize > 0) || !(tickValue > 0) || !(contractSize > 0)) {
      return [];
    }
    return [
      {
        symbol,
        tick_size: tickSize,
        tick_value: tickValue,
        contract_size: contractSize,
        enabled: true,
        updated_at: new Date().toISOString(),
      },
    ];
  });

  if (!rows.length) {
    throw new Error("No allow-listed instruments have safe valuation metadata; refusing to trade");
  }
  const { error } = await supabase
    .from("pf_engine_instruments")
    .upsert(rows, { onConflict: "symbol" });
  if (error) throw error;
  return rows.map((row) => row.symbol);
}

async function runForever(): Promise<void> {
  let attempt = 0;
  while (!stopRequested) {
    let connection: HubConnection | null = null;
    try {
      setEngineStatus(attempt ? "reconnecting" : "starting");
      const symbols = await loadInstruments();
      const symbolSet = new Set(symbols);
      const lastProcessed = new Map<string, number>();
      const inFlight = new Set<string>();
      const current = new HubConnectionBuilder()
        .withUrl(`${providerUrl}/hubs/tick`, {
          skipNegotiation: true,
          transport: HttpTransportType.WebSockets,
        })
        .withAutomaticReconnect(retryDelayMs)
        .configureLogging(LogLevel.Warning)
        .build();
      connection = current;
      activeConnection = current;

      const closed = new Promise<void>((resolve) => {
        current.onclose((error) => {
          if (!stopRequested) {
            setEngineStatus("disconnected", error);
            console.error("Biquote disconnected", error?.message);
          }
          resolve();
        });
      });
      const onTick = async (tick: unknown) => {
        if (stopRequested || !tick) return;
        const quote = parseEngineTick(tick, symbolSet);
        if (!quote || inFlight.has(quote.symbol)) return;
        const now = Date.now();
        if (now - (lastProcessed.get(quote.symbol) ?? 0) < minimumTickIntervalMs) return;
        lastProcessed.set(quote.symbol, now);
        inFlight.add(quote.symbol);
        try {
          const { error } = await supabase.rpc("pf_engine_process_tick", {
            p_symbol: quote.symbol,
            p_bid: quote.bid,
            p_ask: quote.ask,
            p_quote_at: quote.quoteAt.toISOString(),
          });
          if (error) console.error("Tick rejected", quote.symbol, error.message);
        } catch (error) {
          console.error("Tick processing failed", quote.symbol, error);
        } finally {
          inFlight.delete(quote.symbol);
        }
      };

      current.on("ReceiveTick", onTick);
      current.on("Tick", onTick);
      current.onreconnecting((error) => setEngineStatus("reconnecting", error));
      current.onreconnected(() => {
        void current
          .invoke("Subscribe", symbols)
          .then(() => setEngineStatus("connected"))
          .catch((error) => {
            setEngineStatus("reconnecting", error);
            console.error("Biquote resubscribe failed", error);
          });
      });

      setEngineStatus("connecting");
      await current.start();
      await current.invoke("Subscribe", symbols);
      setEngineStatus("connected");
      attempt = 0;
      console.info(`Paper engine connected; subscribed to ${symbols.length} symbols`);
      await closed;
    } catch (error) {
      setEngineStatus("error", error);
      console.error("Price worker connection failed", error);
    } finally {
      if (connection) await connection.stop().catch(() => undefined);
      if (activeConnection === connection) activeConnection = null;
    }

    if (!stopRequested) {
      const delay = retryDelayMs[Math.min(attempt, retryDelayMs.length - 1)];
      await new Promise((resolve) => setTimeout(resolve, delay));
      attempt += 1;
    }
  }
  setEngineStatus("disconnected");
}

export function startWorker(): () => Promise<void> {
  stopRequested = false;
  workerPromise = runForever();
  return async () => {
    if (stopRequested) return;
    stopRequested = true;
    setEngineStatus("stopping");
    await activeConnection?.stop().catch(() => undefined);
    await workerPromise;
    workerPromise = null;
  };
}

async function main(): Promise<void> {
  const stop = startWorker();
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) void main();
