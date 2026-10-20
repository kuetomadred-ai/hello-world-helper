import { describe, expect, it } from "vitest";
import {
  calculatePositionMargin,
  calculatePositionPnl,
  calculateRiskSnapshot,
  evaluatePayoutEligibility,
  evaluateTradeAdmission,
  riskDayKey,
  type EngineQuote,
  type RiskAccountInput,
  type RiskInstrument,
  type RiskProfile,
} from "./risk.js";

const now = "2026-10-19T12:00:00.000Z";
const instrument: RiskInstrument = {
  symbol: "EURUSD",
  tickSize: 0.0001,
  tickValue: 10,
  contractSize: 100_000,
};
const quote: EngineQuote = {
  symbol: "EURUSD",
  bid: 1.099,
  ask: 1.1,
  quoteAt: now,
  receivedAt: now,
};
const baseProfile: RiskProfile = {
  timezone: "UTC",
  resetTimeUtc: "00:00",
  dailyDrawdownMode: "DAY_START",
  dailyDrawdownPct: 5,
  totalDrawdownMode: "STATIC_INITIAL",
  totalDrawdownPct: 10,
  minTradingDays: 0,
};

function account(overrides: Partial<RiskAccountInput> = {}): RiskAccountInput {
  return {
    initialBalance: 10_000,
    balance: 10_000,
    leverage: 100,
    now,
    dailyStartEquity: 10_000,
    riskDay: riskDayKey(now, "00:00"),
    positions: [],
    closedTrades: [],
    instruments: {},
    quotes: {},
    profile: baseProfile,
    ...overrides,
  };
}

describe("PLUTUS risk primitives", () => {
  it("marks a buy at bid and a sell at ask", () => {
    const buy = {
      id: "buy-1",
      symbol: "EURUSD",
      side: "buy" as const,
      lots: 1,
      entryPrice: 1.1,
      openedAt: now,
    };
    const sell = {
      ...buy,
      id: "sell-1",
      side: "sell" as const,
      entryPrice: quote.bid,
    };
    expect(calculatePositionPnl(buy, instrument, quote)).toBe(-100);
    expect(calculatePositionPnl(sell, instrument, quote)).toBe(-100);
  });

  it("calculates conservative opening margin on ask for buys and bid for sells", () => {
    const position = {
      id: "p1",
      symbol: "EURUSD",
      side: "buy" as const,
      lots: 1,
      entryPrice: 1.1,
      openedAt: now,
    };
    expect(calculatePositionMargin(position, instrument, quote, 100)).toBe(1100);
    expect(calculatePositionMargin({ ...position, side: "sell" }, instrument, quote, 100)).toBe(
      1099,
    );
  });

  it("uses server-owned day-start and close-time trading-day attribution", () => {
    const snapshot = calculateRiskSnapshot(
      account({
        balance: 10_100,
        dailyStartEquity: 10_000,
        closedTrades: [
          {
            id: "closed-1",
            openedAt: "2026-10-18T23:50:00.000Z",
            closedAt: "2026-10-19T00:20:00.000Z",
            realizedPnl: 100,
          },
        ],
      }),
    );
    expect(snapshot.dailyStartEquity).toBe(10_000);
    expect(snapshot.tradingDays).toBe(1);
    expect(snapshot.totalRealizedPnl).toBe(100);
  });

  it("tracks daily trailing peak separately from account lifetime peak", () => {
    const snapshot = calculateRiskSnapshot(
      account({
        balance: 10_400,
        priorPeakEquity: 12_000,
        priorDailyPeakEquity: 10_500,
        profile: { ...baseProfile, dailyDrawdownMode: "TRAILING_PEAK" },
      }),
    );
    expect(snapshot.peakEquity).toBe(12_000);
    expect(snapshot.dailyPeakEquity).toBe(10_500);
    expect(snapshot.dailyDrawdown).toBe(100);
  });

  it("fails closed when enabled news protection has no healthy source or supplied data", () => {
    const common = {
      now,
      symbol: "EURUSD",
      side: "buy" as const,
      orderType: "MARKET" as const,
      lots: 0.1,
      instrument,
      quote,
      newsProtectionEnabled: true,
    };
    expect(evaluateTradeAdmission(common).code).toBe("NEWS_BLOCKED");
    expect(
      evaluateTradeAdmission({
        ...common,
        news: {
          enabled: true,
          now,
          symbol: "EURUSD",
          sourceHealthy: false,
          events: [],
        },
      }).code,
    ).toBe("NEWS_BLOCKED");
  });

  it("rejects stale quotes for new trade admission", () => {
    const stale: EngineQuote = {
      ...quote,
      quoteAt: "2026-10-19T11:00:00.000Z",
      receivedAt: "2026-10-19T11:00:00.000Z",
    };
    const result = evaluateTradeAdmission({
      now,
      symbol: "EURUSD",
      side: "buy",
      orderType: "MARKET",
      lots: 0.1,
      instrument,
      quote: stale,
      maxQuoteAgeMs: 1_000,
    });
    expect(result.code).toBe("STALE_SERVER_QUOTE");
    expect(result.accepted).toBe(false);
  });

  it("returns payout eligibility as simulation only and applies the amount cap", () => {
    const result = evaluatePayoutEligibility(
      account({
        balance: 10_100,
        closedTrades: [
          {
            id: "closed-1",
            openedAt: "2026-10-19T10:00:00.000Z",
            closedAt: "2026-10-19T11:00:00.000Z",
            realizedPnl: 100,
          },
        ],
        profile: {
          ...baseProfile,
          minTradingDays: 1,
          payoutSharePct: 80,
          payoutCap: 50,
          payoutMinProfitPct: 1,
          payoutMinTradingDays: 1,
        },
      }),
    );
    expect(result.eligible).toBe(true);
    expect(result.illustrativePayoutAmount).toBe(50);
    expect(result.paperOnly).toBe(true);
    expect(result.paymentProcessed).toBe(false);
  });
});
