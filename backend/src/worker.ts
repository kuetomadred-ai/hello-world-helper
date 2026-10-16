import { createClient } from "@supabase/supabase-js";
import { HubConnectionBuilder, HttpTransportType, LogLevel } from "@microsoft/signalr";
import { parseEngineTick } from "./domain.js";

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const supabase = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const providerUrl = process.env.BIQUOTE_URL ?? "https://biquote.io";
const allowed = new Set(
  (
    process.env.ENGINE_SYMBOLS ??
    "EURUSD,GBPUSD,USDJPY,USDCHF,USDCAD,AUDUSD,NZDUSD,XAUUSD,XAGUSD,US500,USTEC,US30"
  )
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
);
const seen = new Map<string, number>();
const minTickIntervalMs = 250;
let stopping = false;

async function loadInstruments() {
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
    if (!allowed.has(symbol) || !(tickSize > 0) || !(tickValue > 0) || !(contractSize > 0))
      return [];
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
  if (!rows.length)
    throw new Error(
      "No allow-listed instruments with provider tick-value metadata; engine refuses unsafe valuation",
    );
  const { error } = await supabase
    .from("pf_engine_instruments")
    .upsert(rows, { onConflict: "symbol" });
  if (error) throw error;
  return rows.map((x) => x.symbol);
}

async function main() {
  const symbols = await loadInstruments();
  const symbolSet = new Set(symbols);
  console.info(`Loaded ${symbols.length} server-valued instruments`);
  const connection = new HubConnectionBuilder()
    .withUrl(`${providerUrl}/hubs/tick`, {
      skipNegotiation: true,
      transport: HttpTransportType.WebSockets,
    })
    .withAutomaticReconnect([1000, 2000, 5000, 10000, 30000])
    .configureLogging(LogLevel.Warning)
    .build();
  const onTick = async (tick: unknown) => {
    if (stopping || !tick) return;
    const quote = parseEngineTick(tick, symbolSet);
    if (!quote) return;
    const { symbol, bid, ask, quoteAt } = quote;
    const now = Date.now();
    if (now - (seen.get(symbol) ?? 0) < minTickIntervalMs) return;
    seen.set(symbol, now);
    const { error } = await supabase.rpc("pf_engine_process_tick", {
      p_symbol: symbol,
      p_bid: bid,
      p_ask: ask,
      p_quote_at: quoteAt.toISOString(),
    });
    if (error) console.error("tick rejected", symbol, error.message);
  };
  connection.on("ReceiveTick", onTick);
  connection.on("Tick", onTick);
  connection.onreconnected(async () => {
    await connection.invoke("Subscribe", symbols);
    console.info("Biquote reconnected");
  });
  connection.onclose((error) => {
    if (!stopping) console.error("Biquote disconnected", error?.message);
  });
  await connection.start();
  await connection.invoke("Subscribe", symbols);
  console.info(`Server-side paper engine running; broker execution is disabled`);
  const stop = async () => {
    stopping = true;
    await connection.stop();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
main().catch((error) => {
  console.error("Engine startup failed", error);
  process.exitCode = 1;
});
