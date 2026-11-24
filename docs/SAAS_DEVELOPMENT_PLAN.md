# TradingView-Style SaaS Platform: Current State and Development Plan

## Executive summary

OpenCharts is already beyond a basic chart prototype. It has a capable single-chart terminal, a serializable drawing model, paper trading, replay, indicators, watchlists, and adapter-based integrations for market data and trading.

The project is best described as a **Phase 0.5 trading-terminal prototype**, not yet a SaaS platform. The largest missing areas are user accounts, server persistence, multi-chart layouts, cloud alerts, screeners, scripting, deterministic backtesting, collaboration, billing, and scalable market-data services.

The recommended product direction is not to copy TradingView's entire feature catalog immediately. The strongest differentiator is a polished chart workspace combined with scripting, deterministic backtesting, paper trading, and broker integration—areas that fit the team's MQL5 experience.

## 1. Current OpenCharts capabilities

| Product area | Status | Current implementation |
| --- | --- | --- |
| Candlestick chart | Strong | Lightweight Charts v4, live updates, volume, bid/ask lines, crosshair, and bar countdown |
| Timeframes | Strong | 1m, 5m, 15m, 30m, 1h, 4h, 1d, and 1w |
| Historical data | Demo-ready | Six crypto pairs with bundled Binance history |
| Live market data | Partial | Simulated demo stream, Binance example adapter, and live Hyperliquid adapter |
| Drawing persistence | Local only | Per-symbol `localStorage`; Hyperliquid state is address-scoped but remains device-side |
| Drawing object model | Good foundation | Price/time anchors, serialization, styles, lock/hide, timeframe visibility, and z-index |
| Drawing tools | Moderate | Approximately 16 persistent or placement tools |
| Indicators | Basic | SMA, EMA, RSI, MACD, Bollinger Bands, ATR, Stochastic, and VWAP |
| Object tree | Implemented | Select, hide, and delete drawings |
| Magnet mode | Implemented | Off, weak, and strong snapping |
| Drawing styling | Implemented | Color, width, line style, fill, opacity, text formatting, and custom Fibonacci levels |
| Drawing alerts | Session-only | Horizontal-line and trend-line crossing; no cloud delivery or persistence |
| Chart templates | Implemented | Local chart preferences and templates |
| Replay | Strong prototype | Play, pause, seek, 0.5x–10x speed, and trade markers |
| Watchlist | Implemented | Demo watchlist and a richer Hyperliquid watchlist |
| DOM and order ticket | Implemented | Paper engine plus real Hyperliquid trading integration |
| Paper trading | Strong prototype | Market, limit, and stop lifecycles; SL/TP; margin; P&L; order modification |
| Broker integration abstraction | Strong | Clean market-data, trading, and storage adapter contract |
| Trade journal | Implemented | Notes, tags, emotion, and rating stored locally |
| Responsive/mobile UI | Partial | Responsive web panel, but no Expo application |
| Compliance controls | Hyperliquid-specific | Terms, geo-check integration, and wallet-screening hooks |
| Automated testing | Strong | 763 passing tests, one intentionally skipped live-network test, and 23 browser tests |
| SaaS backend | Missing | No users, organizations, Postgres, API, billing, or server persistence |
| Multi-chart layouts | Missing | Current composition is a single terminal/chart |
| Screener | Missing | No screening engine or query UI |
| Cloud alerts | Missing | No persistent evaluator or notification delivery |
| Social/community | Missing | No publishing, following, comments, or feed |
| Scripting | Missing | No parser, runtime, editor, or user-defined indicators |
| Backtesting | Missing | Replay is not a deterministic strategy-testing engine |
| Subscriptions/billing | Missing | No plans, entitlements, metering, or checkout |
| Multi-device synchronization | Missing | The storage interface supports this conceptually, but no server implementation exists |

### Existing architectural strengths

- `OpenChartsAdapter` separates market data, trading, and storage from the UI.
- Drawings store `{time, price}` anchors instead of pixel coordinates.
- The drawing rail is already organized into TradingView-style grouped flyouts.
- The terminal can be embedded as a library instead of being coupled to a single application shell.
- The demo, Binance, and Hyperliquid modes demonstrate that the adapter boundary is viable.

## 2. Existing drawing-tool coverage

### Implemented tools

- Trend line
- Ray
- Extended line
- Horizontal line
- Vertical line
- Parallel channel
- Fibonacci retracement
- Fibonacci extension
- Rectangle
- Ellipse
- Triangle
- Arrow
- Text
- Long position
- Short position
- Measure

### Implemented drawing behavior

- Weak and strong magnet snapping
- Shift-based angle snapping
- Multi-selection
- Drag handles
- Lock and hide
- Object tree
- Z-order
- Per-timeframe visibility
- Style editing
- Custom Fibonacci levels
- In-session drawing alerts
- Account-risk readout for position tools
- Local persistence

This represents approximately 20–25% of the proposed drawing catalog, but a larger share of the difficult interaction foundation. Selection, anchors, coordinate conversion, persistence, hit testing, and editing are more foundational than adding another line variation.

## 3. TradingView runtime observations

A public, logged-out TradingView chart was captured using REA in a clean Chromium runtime on November 24, 2026.

### Evidence

- Focused UI/runtime capture: `ev_58c641cfc44d7dd95f42aee5dc7d2dcb6103f2fd0954506bef0e1341b646fade`
- Earlier broad capture: `ev_3ade46dc8c974d52d66168ca0864c214fef6516259f42ada721ec94f48175fd8`

### Observed desktop composition

```text
Top toolbar
├── Symbol and data type
├── Interval and chart type
├── Indicators and templates
├── Alerts and replay
├── Undo and redo
├── Layout and save controls
├── Search, settings, fullscreen, and snapshot
├── Publish idea
└── Trading

Left drawing rail
├── Cursor and crosshair
├── Trend tools
├── Gann and Fibonacci tools
├── Patterns
├── Forecast and measurement tools
├── Brush and geometric shapes
├── Text, annotations, and icons
├── AI range
└── Magnet, lock, hide, and erase controls

Central workspace
├── Chart and indicator panes
├── Symbol and market state
├── Buy/sell quote controls
└── Navigation and time ranges

Right workspace rail
├── Watchlist, details, and news
├── Alerts
├── Object tree and data window
├── AI Copilot
├── Screeners and Pine Screener
├── Pine Editor
├── Calendars and community
├── Notifications and chats
└── Products and help
```

### Observed runtime behavior

- A chart session and separate quote sessions were created over WebSocket.
- Symbol resolution occurred before historical-series creation.
- Active-chart and watchlist quote subscriptions were distinct.
- Live quote updates were multiplexed through a public data connection.
- Study metadata and study lifecycle messages were supplied by the service.
- Different session identifiers were used for chart data and watchlist quotes.

These observations support—but do not prove—a client architecture similar to:

```text
Workspace UI
   │
   ├── Chart and layout state
   ├── Drawing state
   ├── Indicator and study state
   ├── Watchlist state
   └── Panels and editors
          │
          ▼
Client session multiplexer
   ├── Chart sessions
   ├── Quote sessions
   └── Study sessions
          │
          ▼
Realtime data gateway
```

### Evidence limitations

The runtime capture does not establish TradingView's private database design, internal services, deployment platform, or source-level renderer architecture. The first broad network capture also exhausted its selected event budget, so its network coverage is incomplete. Architectural statements beyond the observed browser behavior are therefore inferences, not verified descriptions of TradingView's backend.

## 4. TradingView library considerations

TradingView Advanced Charts and Trading Platform should not be treated as packaged versions of the complete tradingview.com SaaS product.

According to TradingView's current documentation:

- Advanced Charts and Trading Platform are self-hosted client-side libraries.
- The host application must provide its own market data.
- Advanced Charts supports more than 100 built-in indicators and JavaScript custom studies.
- Pine Script is not supported by either embeddable library.
- Cloud alerts, Strategy Tester, Bar Replay, screeners, patterns, and social/chat functionality are not included.
- Trading Platform adds broker-oriented trading functionality and has separate licensing requirements.

References:

- [Advanced Charts FAQ](https://www.tradingview.com/charting-library-docs/latest/getting_started/Frequently-Asked-Questions/)
- [Advanced Charts indicators](https://www.tradingview.com/charting-library-docs/latest/ui_elements/indicators/)
- [TradingView product features](https://www.tradingview.com/features/)
- [TradingView layout model](https://www.tradingview.com/support/solutions/43000692404-layouts-charts-drawings-indicators-and-their-interaction/)
- [Advanced Charts release notes](https://www.tradingview.com/charting-library-docs/latest/releases/release-notes/)

Licensing Advanced Charts could accelerate chart and drawing parity, but it would not provide the complete SaaS platform. It would also overlap substantially with the custom engine already present in OpenCharts.

## 5. Recommended target architecture

### 5.1 Keep the chart engine framework-independent

Do not move drawing and chart-engine logic directly into Next.js components. Preserve the engine as reusable packages and use Next.js as the SaaS shell.

```text
apps/
  web/                 Next.js SaaS application
  mobile/              Expo application
  realtime-gateway/    Client WebSocket fan-out
  alert-worker/        Persistent alert evaluation
  backtest-worker/     Isolated strategy execution

packages/
  chart-core/          Coordinates, viewport, series, panes
  drawing-engine/      Tools, state, rendering, hit testing
  indicators/          Calculations and worker protocol
  terminal-react/      React bindings and terminal panels
  market-schema/       Symbols, bars, ticks, corporate actions
  api-client/          Shared web/mobile API client
  design-system/       Shared visual primitives and tokens
```

The current project can evolve into `terminal-react`, while drawing, indicator, and market-domain logic are incrementally extracted.

### 5.2 Replace drawing-type switches with a registry

The current serializable drawing model is a good start, but branching render and interaction code by type will become difficult to maintain across 60+ tools.

Introduce a tool contract:

```ts
interface DrawingToolDefinition<TDrawing> {
  type: string;
  placement: PlacementController;
  anchors: AnchorDefinition[];
  render(context: DrawingRenderContext, drawing: TDrawing): void;
  hitTest(context: HitTestContext, drawing: TDrawing): HitResult | null;
  handles(drawing: TDrawing): Handle[];
  move(drawing: TDrawing, operation: DragOperation): TDrawing;
  snap?(drawing: TDrawing, context: SnapContext): TDrawing;
  validate(value: unknown): TDrawing;
  migrate?(value: unknown, version: number): TDrawing;
}
```

Add document-level schema versioning immediately:

```ts
interface DrawingDocument {
  schemaVersion: 1;
  chartId: string;
  symbolId: string;
  drawings: DrawingEntity[];
  groups: DrawingGroup[];
  revision: number;
}
```

This creates a foundation for migrations, synchronization, undo/redo, collaboration, and offline operation.

### 5.3 Introduce command-based editing

Represent every drawing mutation as a command:

- `CreateDrawing`
- `MoveAnchor`
- `UpdateStyle`
- `DeleteDrawing`
- `GroupDrawings`
- `SetVisibility`
- `ChangeZOrder`

This enables reliable undo/redo, autosave batching, optimistic synchronization, audit history, collaborative conflict handling, and replayable interaction tests.

### 5.4 Separate layouts, charts, and drawings

A layout should contain chart instances and panel configuration. Each chart should own its symbol, interval, scales, indicators, and presentation state. Drawings need explicit scopes.

```text
Workspace
└── Layout
    ├── Grid definition
    ├── Chart instances
    │   ├── Symbol, interval, and session
    │   ├── Series
    │   ├── Indicator instances
    │   └── Viewport and scales
    └── Panel state

Drawing scope
├── Chart
├── Layout
├── Symbol
└── Account
```

This model should be established before multi-chart layouts are implemented. Retrofitting drawing scope afterward would be expensive.

### 5.5 Define a canonical market-data schema

The existing adapter remains a useful frontend boundary, but the platform schema should include:

- Stable instrument ID independent of vendor symbol
- Exchange and Market Identifier Code
- Asset class
- Base, quote, and settlement currency
- Trading sessions and timezone
- Tick-size and lot-size rules
- Corporate actions and adjustment mode
- User and organization data entitlements
- Vendor symbol mappings
- Instrument lifecycle and delisting status
- Bar provenance, correction, and revision status

Assets should not be identified solely by strings such as `BTCUSD`. Canonical IDs and vendor aliases should be maintained separately.

### 5.6 Move calculations into workers

The current indicator set can run on the main thread, but multi-chart layouts, larger histories, advanced indicators, screeners, and scripting require worker isolation.

Create a shared calculation protocol for:

- Incremental indicator execution
- New bars and live bar mutations
- Computationally expensive drawing geometry
- Screener expressions
- Strategy execution and backtesting

### 5.7 Treat alerts as a backend product

Current drawing alerts only work while the browser tab is open. Persistent alerts require a server-side pipeline:

```text
Alert definition
   │
   ▼
Symbol dependency index
   │
Live tick and bar stream
   │
Evaluation workers
   │
Deduplication and cooldown
   │
Notification outbox
   ├── Push
   ├── Email
   ├── Webhook
   └── In-app
```

Start with price and drawing alerts. Add indicator and script alerts after the shared calculation runtime exists.

### 5.8 Design scripting around an intermediate representation

Do not begin by cloning Pine Script syntax. Define the execution semantics first:

- Series type system
- Bar-by-bar execution model
- Persistent state variables
- Lookback semantics
- Higher/lower-timeframe requests
- Plot primitives
- Strategy and order-simulation API
- Deterministic execution
- CPU, memory, and history limits
- Internal AST and intermediate representation

An MQL/Pine-inspired DSL or a TypeScript-like syntax can later compile to the same intermediate representation. User code must run in an isolated worker or service, never through unrestricted `eval` in the browser or API process.

### 5.9 Unify replay, paper trading, and backtesting

Refactor the current UI-driven replay into a deterministic event engine:

```text
Historical event source
        │
Deterministic simulation clock
        │
Strategy and order engine
        │
Portfolio and accounting engine
        │
Event log, trades, and metrics
```

The same simulation should power manual replay, scripted strategies, automated tests, and paper trading.

## 6. Revised phased roadmap

### Phase A — Stabilize the engine (4–6 weeks)

- [x] Restore a green typecheck, lint, test, application-build, and library-build baseline.
- [x] Extract drawing-engine and indicator packages with supported public entry points.
- [x] Add drawing schema versioning, sanitization, and legacy migration.
- [x] Add command-based undo/redo, including atomic group-drag and multi-select nudge batches.
- [x] Formalize tool placement plus stored-type hit-test and render strategies in the registry.
- [x] Add drawing interaction regressions for aliases, geometry, overlap ordering, and history batches.
- [x] Define canonical instrument, tick, quote, OHLCV, and timeframe schemas with legacy conversion.
- [x] Move indicator evaluation behind a serializable protocol and browser Web Worker fallback.
- [x] Add deterministic browser screenshot baselines for representative drawing families in dark and light themes.
- [x] Complete dependency-vulnerability triage and document accepted risks.

Phase A implementation note: Lightweight Charts remains the viewport and series renderer. The
custom drawing engine owns serializable state, interaction, hit testing, rendering strategy, and
history. This keeps the product-specific layer portable without replacing the stable charting base.

Dependency audit note (November 24, 2026): Vitest was migrated from v2 to v5 and non-breaking
transitive updates were applied. Both production and full development-tree audits now report zero
known vulnerabilities.

### Phase B — SaaS foundation (6–8 weeks)

- Add the Next.js application shell.
- Implement authentication, users, and organizations.
- [x] Add the initial tenant-safe Postgres schema for users, organizations, workspaces, chart documents, watchlists, subscriptions, and audit events.
- [x] Add optimistic revision contracts and a compare-and-swap chart-document write path.
- [x] Add provider-neutral subscription entitlements and plan limits.
- [x] Add a bearer-authenticated chart-document API, a tenant-scoped Postgres repository, and an HTTP client that preserves revision conflicts.
- [x] Verify migrations, row-level security, and conflict recovery in CI against a disposable postgres:16 service.
- [ ] Connect authenticated API routes to the Postgres schema and provision users/organizations.
- [ ] Move drawings, layouts, watchlists, journals, and templates from local storage to revisioned cloud persistence.
- Add basic subscription billing.
- [ ] Emit audit events from every privileged mutation; add application metrics and tracing.

### Phase C — Product MVP (8–12 weeks)

- Add multi-chart grid layouts.
- Build canonical symbol search and reference data.
- Add server-backed watchlists.
- Deliver 20–25 polished drawing tools instead of 60 shallow implementations.
- Add configurable indicator inputs and separate indicator panes.
- Integrate production-quality data for one asset class.
- Add persistent price and drawing alerts.
- Add shareable read-only layouts and chart snapshots.

### Phase D — Trading differentiation (10–16 weeks)

- Build the deterministic simulation engine.
- Define the strategy API and execution semantics.
- Add a scripting editor, parser, diagnostics, and plotting.
- Produce trades, an equity curve, drawdown, and performance statistics.
- Add parameter sweeps and repeatable test fixtures.
- Integrate paper trading with the same strategy/order engine.
- Harden broker adapters and reconciliation.

### Phase E — Breadth and community (ongoing)

- Build a screener on the shared expression and calculation engine.
- Add public chart ideas and embeds.
- Add comments, following, moderation, and reporting.
- Deliver mobile watchlists, alerts, chart viewing, and trading workflows.
- Add mobile drawing editing after touch interactions are proven.
- Expand advanced Gann, Fibonacci, Pitchfork, pattern, wave, and volume tools incrementally.

## 7. Feature prioritization

The recommended implementation order is:

1. Stabilize the drawing architecture and add undo/redo.
2. Add server persistence, accounts, and saved layouts.
3. Add multi-chart layout semantics and drawing scopes.
4. Add persistent cloud alerts.
5. Build the deterministic scripting and backtesting core.
6. Expand advanced drawing tools incrementally.
7. Add screeners using the scripting/expression engine.
8. Add social features after identity and shareable charts are stable.
9. Expand mobile functionality based on validated web workflows.

## 8. Product positioning

Attempting complete TradingView parity at the beginning would spread engineering effort across too many domains: charting, market data, social networking, screeners, news, fundamentals, broker integrations, alerts, scripting, and mobile applications.

A more defensible early product is:

> A professional chart workspace with excellent drawing fundamentals, deterministic scripting and backtesting, reliable paper trading, and extensible broker integrations.

This direction uses OpenCharts' strongest existing components and aligns with the team's Next.js, React Native/Expo, and MQL5 experience.
