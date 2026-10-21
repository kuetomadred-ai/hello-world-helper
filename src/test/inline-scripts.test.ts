import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(path.join(process.cwd(), "public/plotos/index.html"), "utf8");
const inlineScripts = Array.from(page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))
  .filter((match) => !/\bsrc\s*=/i.test(match[1]))
  .map((match) => match[2].trim())
  .filter(Boolean);

describe("embedded application scripts", () => {
  it("contains at least one inline script", () => {
    expect(inlineScripts.length).toBeGreaterThan(0);
  });

  it("parses every inline script without executing application code", () => {
    inlineScripts.forEach((source, index) => {
      expect(() => new Function(source), `inline script ${index + 1}`).not.toThrow();
    });
  });

  it("keeps auth preflight callable without offering a local simulated account", () => {
    expect(page).toContain("var landingHtml=PORTAL_ADMIN?");
    expect(page).toContain("function pre(){return CLOUD.ok?cloudPull():Promise.resolve()}");
    expect(page).not.toMatch(/\bvar pre=/);
    expect(page).toContain('id="demoBtn">Server Demo Account · Sign In');
    expect(page).toContain("Sign in to use a server-provisioned paper account.");
    expect(page).not.toContain("demo-trader-local");
  });

  it("uses server state only for balances and trades", () => {
    expect(page).toContain("engineRequest('/v1/trading/state')");
    expect(page).toContain("function useLocal(){return false}");
    expect(page).not.toContain("saveLocalTrades");
    expect(page).not.toContain("loadLocalTrades");
    expect(page).not.toContain("plutus_trades_v1_");
    expect(page).toContain("server-provisioned paper account");
  });
});
