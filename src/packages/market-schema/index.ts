/** Vendor-neutral reference-data and market-event contracts. */

export type AssetClass =
  | "crypto"
  | "equity"
  | "forex"
  | "future"
  | "index"
  | "commodity"
  | "option"
  | "bond";

export type InstrumentStatus = "active" | "halted" | "delisted" | "expired";
export type BarAdjustment = "raw" | "splits" | "dividends" | "all";

export interface TradingSession {
  timezone: string;
  regular: string;
  preMarket?: string;
  postMarket?: string;
  holidaysCalendar?: string;
}

export interface PriceIncrement {
  fromPrice?: number;
  tickSize: number;
}

export interface InstrumentRef {
  /** Stable OpenCharts identifier; never a vendor ticker. */
  id: string;
  symbol: string;
  displayName: string;
  assetClass: AssetClass;
  exchangeId: string;
  mic?: string;
  baseCurrency?: string;
  quoteCurrency: string;
  settlementCurrency?: string;
  status: InstrumentStatus;
  priceIncrements: PriceIncrement[];
  quantityIncrement: number;
  contractMultiplier: number;
  session: TradingSession;
  vendorSymbols: Record<string, string>;
  listedAt?: number;
  expiresAt?: number;
}

export interface MarketBar {
  instrumentId: string;
  interval: string;
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades?: number;
  adjustment: BarAdjustment;
  source: string;
  revision: number;
  complete: boolean;
}

export interface MarketTick {
  instrumentId: string;
  eventTime: number;
  receivedTime: number;
  bid?: number;
  ask?: number;
  last?: number;
  lastSize?: number;
  source: string;
  sequence?: number;
}

export interface LegacySymbolLike {
  id: string;
  name: string;
  displayName?: string | null;
  category?: string;
  tickSize: number;
  contractSize?: number;
  isActive?: boolean;
}

export interface LegacyInstrumentDefaults {
  exchangeId?: string;
  quoteCurrency?: string;
  timezone?: string;
  regularSession?: string;
}

function assetClassFromCategory(category: string | undefined): AssetClass {
  const value = category?.toLowerCase() ?? "";
  if (value.includes("forex") || value.includes("fx")) return "forex";
  if (value.includes("stock") || value.includes("equit")) return "equity";
  if (value.includes("future")) return "future";
  if (value.includes("index")) return "index";
  if (value.includes("commodity")) return "commodity";
  if (value.includes("option")) return "option";
  if (value.includes("bond")) return "bond";
  return "crypto";
}

/** Compatibility bridge while adapters adopt canonical InstrumentRef directly. */
export function legacySymbolToInstrument(
  symbol: LegacySymbolLike,
  defaults: LegacyInstrumentDefaults = {},
): InstrumentRef {
  const exchangeId = defaults.exchangeId ?? "OPENCHARTS";
  return {
    id: canonicalInstrumentId(exchangeId, symbol.name),
    symbol: symbol.name,
    displayName: symbol.displayName ?? symbol.name,
    assetClass: assetClassFromCategory(symbol.category),
    exchangeId,
    quoteCurrency: defaults.quoteCurrency ?? "USD",
    status: symbol.isActive === false ? "halted" : "active",
    priceIncrements: [{ tickSize: symbol.tickSize }],
    quantityIncrement: 1,
    contractMultiplier: symbol.contractSize ?? 1,
    session: {
      timezone: defaults.timezone ?? "Etc/UTC",
      regular: defaults.regularSession ?? "0000-2400",
    },
    vendorSymbols: { legacy: symbol.name },
  };
}

export function canonicalInstrumentId(exchangeId: string, symbol: string): string {
  const exchange = exchangeId.trim().toUpperCase();
  const ticker = symbol.trim().toUpperCase();
  if (!exchange || !ticker) throw new Error("exchangeId and symbol are required");
  return `${exchange}:${ticker}`;
}

export function tickSizeAt(instrument: InstrumentRef, price: number): number {
  let selected = instrument.priceIncrements[0]?.tickSize;
  for (const increment of instrument.priceIncrements) {
    if (increment.fromPrice === undefined || price >= increment.fromPrice) {
      selected = increment.tickSize;
    }
  }
  if (selected === undefined || !Number.isFinite(selected) || selected <= 0) {
    throw new Error(`Instrument ${instrument.id} has no valid tick size`);
  }
  return selected;
}
