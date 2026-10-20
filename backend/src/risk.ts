/*
 * Deterministic, server-side-only risk primitives for the paper engine.
 *
 * This module deliberately has no database, clock, network, or provider dependency.
 * Callers pass `now` and all quote/event inputs explicitly, which makes every function
 * deterministic and straightforward to unit test. Values are assumed to be in the
 * account currency. There is intentionally no FX lookup or implicit conversion:
 * `tickValue` must already be expressed in account currency (or a follow-up server
 * conversion layer must be added before production use).
 *
 * All reset timestamps and the risk profile timezone are UTC. The profile's
 * `resetTimeUtc` is an explicit UTC wall-clock time; DST/local-time interpretation is
 * not supported. Quote freshness is fail-closed for new-trade admission.
 */

export type Side = "buy" | "sell";
export type OrderType = "MARKET" | "LIMIT" | "STOP";
export type Timestamp = string;
export type DrawdownMode = "STATIC_INITIAL" | "TRAILING_PEAK";
export type DailyDrawdownMode = "STATIC_INITIAL" | "DAY_START" | "TRAILING_PEAK";
export type ProfitTargetBasis = "EQUITY" | "REALIZED";

export interface EngineQuote {
  readonly symbol: string;
  readonly bid: number;
  readonly ask: number;
  readonly quoteAt: Timestamp;
  readonly receivedAt: Timestamp;
}

export interface RiskInstrument {
  readonly symbol: string;
  readonly tickSize: number;
  /** Monetary value of one tick for one lot, already in account currency. */
  readonly tickValue: number;
  /** Units represented by one lot; used for notional and margin. */
  readonly contractSize: number;
  readonly enabled?: boolean;
}

export interface OpenPosition {
  readonly id: string;
  readonly symbol: string;
  readonly side: Side;
  readonly lots: number;
  readonly entryPrice: number;
  readonly openedAt: Timestamp;
}

export interface ClosedTrade {
  readonly id: string;
  readonly symbol?: string;
  readonly side?: Side;
  readonly lots?: number;
  readonly openedAt: Timestamp;
  readonly closedAt: Timestamp;
  readonly realizedPnl: number;
}

export interface RiskProfile {
  readonly timezone: "UTC";
  readonly resetTimeUtc: string;
  readonly dailyDrawdownMode: DailyDrawdownMode;
  readonly dailyDrawdownPct: number;
  readonly totalDrawdownMode: DrawdownMode;
  readonly totalDrawdownPct: number;
  readonly profitTargetPct?: number;
  readonly profitTargetBasis?: ProfitTargetBasis;
  readonly minTradingDays: number;
  /** Largest winning day / total realized profit, expressed as 0..100. */
  readonly consistencyMaxWinningDayPct?: number;
  /** Optional paper-payout economics; approval and payment remain separate workflows. */
  readonly payoutSharePct?: number;
  readonly payoutCap?: number;
  readonly payoutMinProfitPct?: number;
  readonly payoutMinTradingDays?: number;
  readonly quoteMaxAgeMs?: number;
}

export interface RiskAccountInput {
  readonly initialBalance: number;
  /** Cash balance after realized P&L; it is not equity. */
  readonly balance: number;
  readonly leverage: number;
  readonly now: Timestamp;
  readonly priorPeakEquity?: number;
  /** Server-owned metric; never infer this from the recent trade history. */
  readonly dailyStartEquity: number;
  /** Server-owned UTC risk-day key for the metric row. */
  readonly riskDay: string;
  /** Peak scoped to `riskDay`, not the account's historical peak. */
  readonly priorDailyPeakEquity?: number;
  readonly positions: readonly OpenPosition[];
  readonly closedTrades: readonly ClosedTrade[];
  readonly instruments: Readonly<Record<string, RiskInstrument>>;
  readonly quotes: Readonly<Record<string, EngineQuote>>;
  readonly profile: RiskProfile;
}

export interface PositionMark {
  readonly positionId: string;
  readonly symbol: string;
  readonly side: Side;
  readonly lots: number;
  readonly markPrice: number;
  readonly floatingPnl: number;
  readonly usedMargin: number;
  readonly quoteFresh: boolean;
}

export interface RiskSnapshot {
  readonly asOf: Timestamp;
  readonly balance: number;
  readonly floatingPnl: number;
  readonly equity: number;
  readonly usedMargin: number;
  readonly freeMargin: number;
  readonly marginLevelPct: number | null;
  readonly peakEquity: number;
  readonly dailyStartEquity: number;
  readonly dailyPeakEquity: number;
  readonly dailyReferenceEquity: number;
  readonly dailyDrawdown: number;
  readonly dailyDrawdownLimit: number;
  readonly totalReferenceEquity: number;
  readonly totalDrawdown: number;
  readonly totalDrawdownLimit: number;
  readonly dailyDrawdownBreached: boolean;
  readonly totalDrawdownBreached: boolean;
  readonly profitTarget: number | null;
  readonly profitProgress: number;
  readonly profitTargetReached: boolean;
  readonly tradingDays: number;
  readonly minTradingDaysMet: boolean;
  readonly totalRealizedPnl: number;
  readonly largestWinningDayPnl: number;
  readonly consistencyRatioPct: number | null;
  readonly consistencyMet: boolean;
  readonly allQuotesFresh: boolean;
  readonly positions: readonly PositionMark[];
  readonly riskDay: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface NewsEvent {
  readonly id: string;
  readonly startsAt: Timestamp;
  readonly endsAt: Timestamp;
  /** null means all symbols; otherwise only listed symbols are blocked. */
  readonly symbols: readonly string[] | null;
  readonly verified: boolean;
  readonly verifiedAt?: Timestamp;
  readonly source?: string;
}

export interface NewsBlockInput {
  readonly enabled: boolean;
  readonly now: Timestamp;
  readonly symbol: string;
  readonly events: readonly NewsEvent[];
  /** Must be explicitly true; an absent/unknown news source fails closed. */
  readonly sourceHealthy?: boolean;
}

export interface NewsBlockResult {
  readonly evaluated: boolean;
  readonly blocked: boolean;
  readonly reason:
    | "FEATURE_DISABLED"
    | "NEWS_SOURCE_UNHEALTHY"
    | "NO_VERIFIED_EVENTS"
    | "VERIFIED_EVENT_WINDOW"
    | "INVALID_VERIFIED_EVENT_METADATA";
  readonly matchingEventIds: readonly string[];
  readonly ignoredUnverifiedEventIds: readonly string[];
  readonly invalidVerifiedEventIds: readonly string[];
}

export interface TradeAdmissionInput {
  readonly now: Timestamp;
  readonly symbol: string;
  readonly side: Side;
  readonly orderType: OrderType;
  readonly lots: number;
  readonly triggerPrice?: number;
  readonly stopLoss?: number;
  readonly takeProfit?: number;
  readonly instrument: RiskInstrument;
  readonly quote?: EngineQuote;
  readonly maxQuoteAgeMs?: number;
  /** Pass true from a server-owned risk profile; missing news input then fails closed. */
  readonly newsProtectionEnabled?: boolean;
  readonly news?: NewsBlockInput;
}

export interface TradeAdmissionResult {
  readonly accepted: boolean;
  readonly code:
    | "ACCEPTED"
    | "INSTRUMENT_UNAVAILABLE"
    | "INVALID_QUOTE"
    | "NO_SERVER_QUOTE"
    | "STALE_SERVER_QUOTE"
    | "INVALID_ORDER"
    | "INVALID_TRIGGER_SIDE"
    | "INVALID_PROTECTION"
    | "NEWS_BLOCKED";
  readonly details: Readonly<Record<string, unknown>>;
}

export interface PayoutEligibilityResult {
  readonly eligible: boolean;
  readonly paperOnly: true;
  readonly paymentProcessed: false;
  readonly reasons: readonly string[];
  readonly requirements: Readonly<Record<string, boolean>>;
  readonly payoutRules: Readonly<{
    profitTarget: number | null;
    minTradingDays: number;
    consistencyMaxWinningDayPct: number | null;
    payoutSharePct: number;
    payoutCap: number | null;
    payoutMinProfitPct: number;
    payoutMinTradingDays: number;
  }>;
  readonly illustrativePayoutAmount: number;
  readonly amountIsIllustrative: true;
  readonly payoutEstimateBasis: "CUMULATIVE_REALIZED_PNL_NOT_NET_OF_PRIOR_PAYOUTS";
  readonly approvalAndPayment: "SEPARATE_WORKFLOW_REQUIRED";
  readonly snapshot: RiskSnapshot;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positive(value: unknown, name: string): asserts value is number {
  if (!isFiniteNumber(value) || value <= 0)
    throw new RangeError(`${name} must be positive and finite`);
}

function nonNegative(value: unknown, name: string): asserts value is number {
  if (!isFiniteNumber(value) || value < 0)
    throw new RangeError(`${name} must be non-negative and finite`);
}

function timestampMs(value: Timestamp, name: string): number {
  if (typeof value !== "string" || value.trim() === "")
    throw new TypeError(`${name} must be an ISO timestamp`);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new TypeError(`${name} must include an explicit UTC/offset timezone`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new RangeError(`${name} must be a valid timestamp`);
  return parsed;
}

function normalizeSymbol(value: string, name: string): string {
  if (typeof value !== "string" || !/^[A-Z0-9_]{2,20}$/.test(value))
    throw new TypeError(`${name} is invalid`);
  return value;
}

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function validateInstrument(instrument: RiskInstrument): void {
  normalizeSymbol(instrument.symbol, "instrument.symbol");
  positive(instrument.tickSize, "instrument.tickSize");
  positive(instrument.tickValue, "instrument.tickValue");
  positive(instrument.contractSize, "instrument.contractSize");
  if (instrument.enabled === false) throw new RangeError("instrument is disabled");
}

function validateQuote(quote: EngineQuote, expectedSymbol: string): void {
  normalizeSymbol(quote.symbol, "quote.symbol");
  if (quote.symbol !== expectedSymbol)
    throw new RangeError("quote symbol does not match instrument");
  positive(quote.bid, "quote.bid");
  if (!isFiniteNumber(quote.ask) || quote.ask < quote.bid)
    throw new RangeError("quote.ask must be finite and >= bid");
  timestampMs(quote.quoteAt, "quote.quoteAt");
  timestampMs(quote.receivedAt, "quote.receivedAt");
}

function validatePosition(position: OpenPosition): void {
  if (typeof position.id !== "string" || position.id.length === 0)
    throw new TypeError("position.id is required");
  normalizeSymbol(position.symbol, "position.symbol");
  if (position.side !== "buy" && position.side !== "sell")
    throw new TypeError("position.side is invalid");
  positive(position.lots, "position.lots");
  if (position.lots > 100 || position.lots !== Math.round(position.lots * 100) / 100)
    throw new RangeError("position.lots must be between 0.01 and 100 with at most two decimals");
  positive(position.entryPrice, "position.entryPrice");
  timestampMs(position.openedAt, "position.openedAt");
}

function markPrice(side: Side, quote: EngineQuote): number {
  // Closing a buy sells into bid; closing a sell buys at ask. Never use midpoint.
  return side === "buy" ? quote.bid : quote.ask;
}

function openingPrice(side: Side, quote: EngineQuote): number {
  // Opening conservatively crosses the spread: buy at ask and sell at bid.
  return side === "buy" ? quote.ask : quote.bid;
}

function quoteIsFresh(quote: EngineQuote, now: Timestamp, maxAgeMs: number): boolean {
  const nowMs = timestampMs(now, "now");
  const receivedMs = timestampMs(quote.receivedAt, "quote.receivedAt");
  const quoteMs = timestampMs(quote.quoteAt, "quote.quoteAt");
  return (
    receivedMs <= nowMs + 5_000 &&
    receivedMs >= nowMs - maxAgeMs &&
    quoteMs <= nowMs + 5_000 &&
    quoteMs >= nowMs - maxAgeMs
  );
}

function validateProfile(profile: RiskProfile): void {
  if (profile.timezone !== "UTC") throw new RangeError("risk profile timezone must be UTC");
  if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(profile.resetTimeUtc))
    throw new RangeError("resetTimeUtc must be HH:MM in UTC");
  if (
    profile.dailyDrawdownMode !== "STATIC_INITIAL" &&
    profile.dailyDrawdownMode !== "DAY_START" &&
    profile.dailyDrawdownMode !== "TRAILING_PEAK"
  )
    throw new TypeError("invalid dailyDrawdownMode");
  if (
    profile.totalDrawdownMode !== "STATIC_INITIAL" &&
    profile.totalDrawdownMode !== "TRAILING_PEAK"
  )
    throw new TypeError("invalid totalDrawdownMode");
  positive(profile.dailyDrawdownPct, "dailyDrawdownPct");
  positive(profile.totalDrawdownPct, "totalDrawdownPct");
  if (profile.dailyDrawdownPct > 100 || profile.totalDrawdownPct > 100)
    throw new RangeError("drawdown percentages must be > 0 and <= 100");
  if (
    profile.profitTargetPct !== undefined &&
    (!isFiniteNumber(profile.profitTargetPct) || profile.profitTargetPct < 0)
  )
    throw new RangeError("profitTargetPct must be non-negative");
  if (
    profile.profitTargetBasis !== undefined &&
    profile.profitTargetBasis !== "EQUITY" &&
    profile.profitTargetBasis !== "REALIZED"
  )
    throw new TypeError("invalid profitTargetBasis");
  if (!Number.isInteger(profile.minTradingDays) || profile.minTradingDays < 0)
    throw new RangeError("minTradingDays must be a non-negative integer");
  if (
    profile.consistencyMaxWinningDayPct !== undefined &&
    (!isFiniteNumber(profile.consistencyMaxWinningDayPct) ||
      profile.consistencyMaxWinningDayPct <= 0 ||
      profile.consistencyMaxWinningDayPct > 100)
  )
    throw new RangeError("consistencyMaxWinningDayPct must be > 0 and <= 100");
  if (
    profile.payoutSharePct !== undefined &&
    (!isFiniteNumber(profile.payoutSharePct) ||
      profile.payoutSharePct < 0 ||
      profile.payoutSharePct > 100)
  )
    throw new RangeError("payoutSharePct must be >= 0 and <= 100");
  if (
    profile.payoutCap !== undefined &&
    (!isFiniteNumber(profile.payoutCap) || profile.payoutCap < 0)
  )
    throw new RangeError("payoutCap must be non-negative");
  if (
    profile.payoutMinProfitPct !== undefined &&
    (!isFiniteNumber(profile.payoutMinProfitPct) || profile.payoutMinProfitPct < 0)
  )
    throw new RangeError("payoutMinProfitPct must be non-negative");
  if (
    profile.payoutMinTradingDays !== undefined &&
    (!Number.isInteger(profile.payoutMinTradingDays) || profile.payoutMinTradingDays < 0)
  )
    throw new RangeError("payoutMinTradingDays must be a non-negative integer");
  if (
    profile.quoteMaxAgeMs !== undefined &&
    (!Number.isInteger(profile.quoteMaxAgeMs) || profile.quoteMaxAgeMs <= 0)
  )
    throw new RangeError("quoteMaxAgeMs must be a positive integer");
}

function resetMinutes(resetTimeUtc: string): number {
  const parts = resetTimeUtc.split(":").map(Number);
  return parts[0] * 60 + parts[1];
}

/** Return the UTC risk-day key after applying the explicit UTC reset time. */
export function riskDayKey(value: Timestamp, resetTimeUtc: string): string {
  timestampMs(value, "timestamp");
  if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(resetTimeUtc))
    throw new RangeError("resetTimeUtc must be HH:MM in UTC");
  const date = new Date(value);
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  if (minutes < resetMinutes(resetTimeUtc)) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** Calculate realized/floating P&L using the current instrument tick size and tick value. */
export function calculatePositionPnl(
  position: OpenPosition,
  instrument: RiskInstrument,
  quote: EngineQuote,
): number {
  validatePosition(position);
  validateInstrument(instrument);
  validateQuote(quote, position.symbol);
  const price = markPrice(position.side, quote);
  const direction = position.side === "buy" ? 1 : -1;
  return money(
    ((price - position.entryPrice) / instrument.tickSize) *
      instrument.tickValue *
      position.lots *
      direction,
  );
}

export const calculateFloatingPnl = calculatePositionPnl;

/** Margin uses the current mark price and current instrument contract size. */
export function calculatePositionMargin(
  position: OpenPosition,
  instrument: RiskInstrument,
  quote: EngineQuote,
  leverage: number,
): number {
  validatePosition(position);
  validateInstrument(instrument);
  validateQuote(quote, position.symbol);
  positive(leverage, "leverage");
  return money(
    (position.lots * instrument.contractSize * openingPrice(position.side, quote)) / leverage,
  );
}

export function evaluateNewsBlock(input: NewsBlockInput): NewsBlockResult {
  normalizeSymbol(input.symbol, "news.symbol");
  const nowMs = timestampMs(input.now, "news.now");
  if (!Array.isArray(input.events)) throw new TypeError("news.events must be an array");
  if (!input.enabled)
    return {
      evaluated: false,
      blocked: false,
      reason: "FEATURE_DISABLED",
      matchingEventIds: [],
      ignoredUnverifiedEventIds: [],
      invalidVerifiedEventIds: [],
    };
  if (input.sourceHealthy !== true)
    return {
      evaluated: true,
      blocked: true,
      reason: "NEWS_SOURCE_UNHEALTHY",
      matchingEventIds: [],
      ignoredUnverifiedEventIds: [],
      invalidVerifiedEventIds: [],
    };
  const matching: string[] = [];
  const ignored: string[] = [];
  const invalidVerified: string[] = [];
  for (const event of input.events) {
    if (typeof event.id !== "string" || event.id.trim() === "")
      throw new TypeError("news event id is required");
    const starts = timestampMs(event.startsAt, "news event startsAt");
    const ends = timestampMs(event.endsAt, "news event endsAt");
    if (ends <= starts) throw new RangeError("news event endsAt must be after startsAt");
    if (!Array.isArray(event.symbols) && event.symbols !== null)
      throw new TypeError("news event symbols must be null or an array");
    if (event.symbols)
      event.symbols.forEach((symbol: string) => normalizeSymbol(symbol, "news event symbol"));
    if (!event.verified) {
      ignored.push(event.id);
      continue;
    }
    const source = event.source?.trim() ?? "";
    const verifiedAtMs = event.verifiedAt === undefined ? NaN : Date.parse(event.verifiedAt);
    if (
      event.verified &&
      (source.length === 0 || !Number.isFinite(verifiedAtMs) || verifiedAtMs > nowMs)
    ) {
      invalidVerified.push(event.id);
      continue;
    }
    const symbolMatches = event.symbols === null || event.symbols.includes(input.symbol);
    // Windows are [startsAt, endsAt); there is no invented grace period.
    if (symbolMatches && nowMs >= starts && nowMs < ends) matching.push(event.id);
  }
  return {
    evaluated: true,
    blocked: matching.length > 0 || invalidVerified.length > 0,
    reason:
      matching.length > 0
        ? "VERIFIED_EVENT_WINDOW"
        : invalidVerified.length > 0
          ? "INVALID_VERIFIED_EVENT_METADATA"
          : "NO_VERIFIED_EVENTS",
    matchingEventIds: matching,
    ignoredUnverifiedEventIds: ignored,
    invalidVerifiedEventIds: invalidVerified,
  };
}

export const evaluateEconomicNewsBlock = evaluateNewsBlock;

function admissionFailure(
  code: TradeAdmissionResult["code"],
  details: Readonly<Record<string, unknown>> = {},
): TradeAdmissionResult {
  return { accepted: false, code, details };
}

/**
 * Fail-closed admission check. A quote is required and both receipt and quote time
 * must be within the supplied freshness window; cached/untimed prices cannot admit a trade.
 */
export function evaluateTradeAdmission(input: TradeAdmissionInput): TradeAdmissionResult {
  normalizeSymbol(input.symbol, "symbol");
  validateInstrument(input.instrument);
  if (input.instrument.symbol !== input.symbol)
    throw new RangeError("instrument does not match symbol");
  if (input.side !== "buy" && input.side !== "sell") throw new TypeError("side is invalid");
  if (input.orderType !== "MARKET" && input.orderType !== "LIMIT" && input.orderType !== "STOP")
    throw new TypeError("orderType is invalid");
  positive(input.lots, "lots");
  if (input.lots > 100 || input.lots !== Math.round(input.lots * 100) / 100)
    throw new RangeError("lots must be between 0.01 and 100 with at most two decimals");
  if (input.orderType !== "MARKET") positive(input.triggerPrice, "triggerPrice");
  if (input.stopLoss !== undefined) positive(input.stopLoss, "stopLoss");
  if (input.takeProfit !== undefined) positive(input.takeProfit, "takeProfit");
  const nowMs = timestampMs(input.now, "now");
  const maxAgeMs = input.maxQuoteAgeMs ?? 15_000;
  if (!Number.isInteger(maxAgeMs) || maxAgeMs <= 0)
    throw new RangeError("maxQuoteAgeMs must be a positive integer");
  if (input.instrument.enabled === false) return admissionFailure("INSTRUMENT_UNAVAILABLE");
  if (!input.quote)
    return admissionFailure("NO_SERVER_QUOTE", {
      quoteFresh: false,
      failClosed: true,
    });
  try {
    validateQuote(input.quote, input.symbol);
  } catch (error) {
    return admissionFailure("INVALID_QUOTE", {
      quoteFresh: false,
      failClosed: true,
      error: String(error),
    });
  }
  const fresh = quoteIsFresh(input.quote, input.now, maxAgeMs);
  const quoteAgeMs = nowMs - timestampMs(input.quote.receivedAt, "quote.receivedAt");
  if (!fresh)
    return admissionFailure("STALE_SERVER_QUOTE", {
      quoteFresh: false,
      quoteAgeMs,
      maxQuoteAgeMs: maxAgeMs,
      failClosed: true,
    });

  const executionPrice = input.side === "buy" ? input.quote.ask : input.quote.bid;
  const referencePrice =
    input.orderType === "MARKET" ? executionPrice : (input.triggerPrice as number);
  const trigger = input.triggerPrice;
  if (
    input.orderType === "LIMIT" &&
    ((input.side === "buy" && (trigger as number) >= input.quote.ask) ||
      (input.side === "sell" && (trigger as number) <= input.quote.bid))
  )
    return admissionFailure("INVALID_TRIGGER_SIDE", {
      quoteFresh: true,
      referencePrice,
    });
  if (
    input.orderType === "STOP" &&
    ((input.side === "buy" && (trigger as number) <= input.quote.ask) ||
      (input.side === "sell" && (trigger as number) >= input.quote.bid))
  )
    return admissionFailure("INVALID_TRIGGER_SIDE", {
      quoteFresh: true,
      referencePrice,
    });
  if (
    input.stopLoss !== undefined &&
    ((input.side === "buy" && input.stopLoss >= referencePrice) ||
      (input.side === "sell" && input.stopLoss <= referencePrice))
  )
    return admissionFailure("INVALID_PROTECTION", {
      quoteFresh: true,
      referencePrice,
    });
  if (
    input.takeProfit !== undefined &&
    ((input.side === "buy" && input.takeProfit <= referencePrice) ||
      (input.side === "sell" && input.takeProfit >= referencePrice))
  )
    return admissionFailure("INVALID_PROTECTION", {
      quoteFresh: true,
      referencePrice,
    });

  if (input.newsProtectionEnabled === true && input.news === undefined) {
    return admissionFailure("NEWS_BLOCKED", {
      quoteFresh: true,
      referencePrice,
      failClosed: true,
      news: { reason: "NEWS_SOURCE_UNHEALTHY", blocked: true },
    });
  }
  if (input.news && input.news.symbol !== input.symbol)
    throw new RangeError("news symbol does not match trade symbol");
  const news = input.news ? evaluateNewsBlock(input.news) : undefined;
  if (news?.blocked)
    return admissionFailure("NEWS_BLOCKED", {
      quoteFresh: true,
      referencePrice,
      news,
      failClosed: true,
    });
  return {
    accepted: true,
    code: "ACCEPTED",
    details: {
      quoteFresh: true,
      quoteAgeMs,
      maxQuoteAgeMs: maxAgeMs,
      executionPrice,
      referencePrice,
      news: news ?? null,
    },
  };
}

export function calculateRiskSnapshot(input: RiskAccountInput): RiskSnapshot {
  validateProfile(input.profile);
  positive(input.initialBalance, "initialBalance");
  nonNegative(input.balance, "balance");
  positive(input.dailyStartEquity, "dailyStartEquity");
  positive(input.leverage, "leverage");
  const nowMs = timestampMs(input.now, "now");
  const calculatedRiskDay = riskDayKey(input.now, input.profile.resetTimeUtc);
  if (input.riskDay !== calculatedRiskDay)
    throw new RangeError("riskDay must match the current UTC risk day");
  if (input.priorPeakEquity !== undefined) positive(input.priorPeakEquity, "priorPeakEquity");
  if (input.profile.dailyDrawdownMode === "TRAILING_PEAK") {
    if (input.priorDailyPeakEquity === undefined)
      throw new RangeError("priorDailyPeakEquity is required for daily TRAILING_PEAK");
    positive(input.priorDailyPeakEquity, "priorDailyPeakEquity");
  }
  if (!Array.isArray(input.positions) || !Array.isArray(input.closedTrades))
    throw new TypeError("positions and closedTrades must be arrays");
  const maxAgeMs = input.profile.quoteMaxAgeMs ?? 15_000;
  const positionMarks: PositionMark[] = [];
  let floatingPnl = 0;
  let usedMargin = 0;
  let allQuotesFresh = true;
  for (const position of input.positions) {
    validatePosition(position);
    const instrument = input.instruments[position.symbol];
    if (!instrument) throw new RangeError(`missing instrument for ${position.symbol}`);
    const quote = input.quotes[position.symbol];
    if (!quote) throw new RangeError(`missing quote for ${position.symbol}`);
    validateInstrument(instrument);
    validateQuote(quote, position.symbol);
    const pnl = calculatePositionPnl(position, instrument, quote);
    const margin = calculatePositionMargin(position, instrument, quote, input.leverage);
    const fresh = quoteIsFresh(quote, input.now, maxAgeMs);
    allQuotesFresh = allQuotesFresh && fresh;
    positionMarks.push({
      positionId: position.id,
      symbol: position.symbol,
      side: position.side,
      lots: position.lots,
      markPrice: markPrice(position.side, quote),
      floatingPnl: pnl,
      usedMargin: margin,
      quoteFresh: fresh,
    });
    floatingPnl = money(floatingPnl + pnl);
    usedMargin = money(usedMargin + margin);
  }
  let totalRealizedPnl = 0;
  const dayPnl = new Map<string, number>();
  const tradingDays = new Set<string>();
  for (const trade of input.closedTrades) {
    if (typeof trade.id !== "string" || trade.id.length === 0)
      throw new TypeError("closed trade id is required");
    timestampMs(trade.openedAt, "closed trade openedAt");
    timestampMs(trade.closedAt, "closed trade closedAt");
    if (
      timestampMs(trade.closedAt, "closed trade closedAt") <
      timestampMs(trade.openedAt, "closed trade openedAt")
    )
      throw new RangeError("closed trade closedAt must not precede openedAt");
    if (!isFiniteNumber(trade.realizedPnl))
      throw new TypeError("closed trade realizedPnl must be finite");
    // Trading-day and consistency attribution follows execution/close time, not entry time.
    const day = riskDayKey(trade.closedAt, input.profile.resetTimeUtc);
    tradingDays.add(day);
    totalRealizedPnl = money(totalRealizedPnl + trade.realizedPnl);
    dayPnl.set(day, money((dayPnl.get(day) ?? 0) + trade.realizedPnl));
  }
  const riskDay = calculatedRiskDay;
  // dailyStartEquity is a server-owned metric input. Never reconstruct it from a
  // truncated trade list or incomplete realized-P&L aggregation.
  const dayStartEquity = money(input.dailyStartEquity);
  const equity = money(input.balance + floatingPnl);
  const peakEquity = money(
    Math.max(input.initialBalance, input.priorPeakEquity ?? input.initialBalance, equity),
  );
  const previousDailyPeak = input.priorDailyPeakEquity ?? dayStartEquity;
  if (previousDailyPeak < dayStartEquity)
    throw new RangeError("priorDailyPeakEquity cannot be below dailyStartEquity");
  const dailyPeakEquity = money(Math.max(previousDailyPeak, equity));
  const dailyReferenceEquity =
    input.profile.dailyDrawdownMode === "STATIC_INITIAL"
      ? input.initialBalance
      : input.profile.dailyDrawdownMode === "TRAILING_PEAK"
        ? dailyPeakEquity
        : dayStartEquity;
  const dailyDrawdown = money(Math.max(0, dailyReferenceEquity - equity));
  const dailyDrawdownLimit = money((dailyReferenceEquity * input.profile.dailyDrawdownPct) / 100);
  const totalReferenceEquity =
    input.profile.totalDrawdownMode === "STATIC_INITIAL" ? input.initialBalance : peakEquity;
  const totalDrawdown = money(Math.max(0, totalReferenceEquity - equity));
  const totalDrawdownLimit = money((input.initialBalance * input.profile.totalDrawdownPct) / 100);
  const target =
    input.profile.profitTargetPct === undefined
      ? null
      : money((input.initialBalance * input.profile.profitTargetPct) / 100);
  const profitBasis = input.profile.profitTargetBasis ?? "EQUITY";
  const profitProgress = money(
    profitBasis === "REALIZED" ? totalRealizedPnl : equity - input.initialBalance,
  );
  const largestWinningDayPnl = Math.max(
    0,
    ...Array.from(dayPnl.values()).filter((value) => value > 0),
  );
  const consistencyRatioPct =
    totalRealizedPnl > 0 ? money((largestWinningDayPnl / totalRealizedPnl) * 100) : null;
  const consistencyMet =
    input.profile.consistencyMaxWinningDayPct === undefined ||
    consistencyRatioPct === null ||
    consistencyRatioPct <= input.profile.consistencyMaxWinningDayPct;
  const profitTargetReached = target === null ? true : profitProgress >= target;
  const dailyDrawdownBreached = dailyDrawdown >= dailyDrawdownLimit;
  const totalDrawdownBreached = totalDrawdown >= totalDrawdownLimit;
  return {
    asOf: input.now,
    balance: input.balance,
    floatingPnl,
    equity,
    usedMargin,
    freeMargin: money(equity - usedMargin),
    marginLevelPct: usedMargin > 0 ? money((equity / usedMargin) * 100) : null,
    peakEquity,
    dailyStartEquity: dayStartEquity,
    dailyPeakEquity,
    dailyReferenceEquity,
    dailyDrawdown,
    dailyDrawdownLimit,
    totalReferenceEquity,
    totalDrawdown,
    totalDrawdownLimit,
    dailyDrawdownBreached,
    totalDrawdownBreached,
    profitTarget: target,
    profitProgress,
    profitTargetReached,
    tradingDays: tradingDays.size,
    minTradingDaysMet: tradingDays.size >= input.profile.minTradingDays,
    totalRealizedPnl,
    largestWinningDayPnl: money(largestWinningDayPnl),
    consistencyRatioPct,
    consistencyMet,
    allQuotesFresh,
    positions: positionMarks,
    riskDay,
    details: {
      timezone: input.profile.timezone,
      resetTimeUtc: input.profile.resetTimeUtc,
      profitTargetBasis: profitBasis,
      accountCurrencyConversion: "Not performed; tickValue must already be in account currency",
      quoteFreshnessRequiredForAdmission: true,
      dailyMetricsSource:
        "server-owned metric row; RPC/worker integration is required before metrics are trusted",
      tradingDayAttribution: "closedAt execution/close day using the UTC reset time",
      calculatedAtEpochMs: nowMs,
    },
  };
}

export function evaluatePayoutEligibility(input: RiskAccountInput): PayoutEligibilityResult {
  const snapshot = calculateRiskSnapshot(input);
  const payoutSharePct = input.profile.payoutSharePct ?? 100;
  const payoutCap = input.profile.payoutCap ?? null;
  const payoutMinProfitPct = input.profile.payoutMinProfitPct ?? 0;
  const payoutMinTradingDays = input.profile.payoutMinTradingDays ?? input.profile.minTradingDays;
  const uncappedPayout = money((Math.max(0, snapshot.totalRealizedPnl) * payoutSharePct) / 100);
  const illustrativePayoutAmount = money(
    payoutCap === null ? uncappedPayout : Math.min(uncappedPayout, payoutCap),
  );
  const minimumPayoutProfit = money((input.initialBalance * payoutMinProfitPct) / 100);
  const requirements = {
    profitTarget: snapshot.profitTargetReached,
    minTradingDays: snapshot.minTradingDaysMet,
    consistency: snapshot.consistencyMet,
    dailyDrawdown: !snapshot.dailyDrawdownBreached,
    totalDrawdown: !snapshot.totalDrawdownBreached,
    payoutMinProfit: snapshot.totalRealizedPnl >= minimumPayoutProfit,
    payoutMinTradingDays: snapshot.tradingDays >= payoutMinTradingDays,
    positivePayoutAmount: illustrativePayoutAmount > 0,
    // A simulated withdrawal has no quote dependency when flat. Open positions
    // require fresh server quotes and therefore fail closed if they are stale.
    quoteFresh: snapshot.positions.length === 0 || snapshot.allQuotesFresh,
  };
  const reasons: string[] = [];
  for (const [name, passed] of Object.entries(requirements))
    if (!passed) reasons.push(`${name} requirement not met`);
  return {
    eligible: reasons.length === 0,
    paperOnly: true,
    paymentProcessed: false,
    reasons,
    requirements,
    payoutRules: {
      profitTarget: snapshot.profitTarget,
      minTradingDays: input.profile.minTradingDays,
      consistencyMaxWinningDayPct: input.profile.consistencyMaxWinningDayPct ?? null,
      payoutSharePct,
      payoutCap,
      payoutMinProfitPct,
      payoutMinTradingDays,
    },
    illustrativePayoutAmount,
    amountIsIllustrative: true,
    payoutEstimateBasis: "CUMULATIVE_REALIZED_PNL_NOT_NET_OF_PRIOR_PAYOUTS",
    approvalAndPayment: "SEPARATE_WORKFLOW_REQUIRED",
    snapshot,
  };
}

/** Non-throwing validation helpers for API/RPC adapters. */
export function tryCalculateRiskSnapshot(
  input: RiskAccountInput,
):
  | { readonly ok: true; readonly value: RiskSnapshot }
  | { readonly ok: false; readonly error: string } {
  try {
    return { ok: true, value: calculateRiskSnapshot(input) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function tryEvaluateTradeAdmission(
  input: TradeAdmissionInput,
):
  | { readonly ok: true; readonly value: TradeAdmissionResult }
  | { readonly ok: false; readonly error: string } {
  try {
    return { ok: true, value: evaluateTradeAdmission(input) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
