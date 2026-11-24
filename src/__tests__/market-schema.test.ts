import { describe, expect, it } from "vitest";
import {
  canonicalInstrumentId,
  legacySymbolToInstrument,
  tickSizeAt,
  type InstrumentRef,
} from "../packages/market-schema/index.ts";

const instrument: InstrumentRef = {
  id: "NASDAQ:AAPL",
  symbol: "AAPL",
  displayName: "Apple Inc.",
  assetClass: "equity",
  exchangeId: "NASDAQ",
  quoteCurrency: "USD",
  status: "active",
  priceIncrements: [
    { tickSize: 0.0001 },
    { fromPrice: 1, tickSize: 0.01 },
  ],
  quantityIncrement: 1,
  contractMultiplier: 1,
  session: { timezone: "America/New_York", regular: "0930-1600" },
  vendorSymbols: { example: "AAPL" },
};

describe("canonical market schema", () => {
  it("creates normalized instrument ids", () => {
    expect(canonicalInstrumentId(" nasdaq ", " aapl ")).toBe("NASDAQ:AAPL");
    expect(() => canonicalInstrumentId("", "AAPL")).toThrow();
  });

  it("selects the tick ladder increment for a price", () => {
    expect(tickSizeAt(instrument, 0.5)).toBe(0.0001);
    expect(tickSizeAt(instrument, 100)).toBe(0.01);
  });

  it("bridges legacy adapter symbols to stable canonical instruments", () => {
    const converted = legacySymbolToInstrument({
      id: "BTCUSD",
      name: "BTCUSD",
      displayName: "Bitcoin",
      category: "Crypto",
      tickSize: 0.1,
      contractSize: 1,
      isActive: true,
    }, { exchangeId: "demo" });
    expect(converted).toMatchObject({
      id: "DEMO:BTCUSD",
      assetClass: "crypto",
      status: "active",
    });
  });
});
