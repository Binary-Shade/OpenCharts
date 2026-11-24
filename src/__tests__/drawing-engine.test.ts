import { describe, expect, it } from "vitest";
import {
  DRAWING_SCHEMA_VERSION,
  DrawingCommandStore,
  createDrawingDocument,
  getDrawingTypeDefinition,
  getDrawingToolDefinition,
  parseDrawingDocument,
  updateDrawingDocument,
  type DrawingLine,
} from "../packages/drawing-engine/index.ts";

const line = (id: string, price = 100): DrawingLine => ({
  id,
  type: "horizontal",
  price,
  color: "#fff",
});

describe("drawing document schema", () => {
  it("migrates legacy arrays without losing valid drawings", () => {
    const document = parseDrawingDocument([line("a"), { broken: true }], "BTCUSD");
    expect(document).toMatchObject({
      schemaVersion: DRAWING_SCHEMA_VERSION,
      symbolId: "BTCUSD",
      revision: 0,
      groups: [],
    });
    expect(document.drawings).toEqual([line("a")]);
  });

  it("sanitizes versioned documents and advances revisions", () => {
    const parsed = parseDrawingDocument(
      {
        schemaVersion: 99,
        symbolId: "ETHUSD",
        revision: 4.8,
        updatedAt: 1,
        drawings: [{ ...line("a"), fillOpacity: 3, fibLevels: [0, Number.NaN, 1] }],
        groups: [{ id: "g", drawingIds: ["a", "missing", "a"] }],
      },
      "fallback",
    );
    expect(parsed.revision).toBe(4);
    expect(parsed.drawings[0]?.fillOpacity).toBe(1);
    expect(parsed.drawings[0]?.fibLevels).toEqual([0, 1]);
    expect(parsed.groups[0]?.drawingIds).toEqual(["a"]);

    const updated = updateDrawingDocument(parsed, [line("b")]);
    expect(updated.revision).toBe(5);
    expect(updated.drawings).toEqual([line("b")]);
  });

  it("deduplicates ids and treats the requested symbol as authoritative", () => {
    const parsed = parseDrawingDocument(
      {
        schemaVersion: 1,
        symbolId: "WRONG",
        drawings: [
          { ...line("same"), time: Number.NaN, fillOpacity: "bad" },
          line("same", 200),
        ],
      },
      "BTC",
    );
    expect(parsed.symbolId).toBe("BTC");
    expect(parsed.drawings).toHaveLength(1);
    expect(parsed.drawings[0]).not.toHaveProperty("time");
    expect(parsed.drawings[0]).not.toHaveProperty("fillOpacity");
  });

  it("creates an empty versioned document", () => {
    expect(createDrawingDocument("AAPL")).toMatchObject({
      schemaVersion: DRAWING_SCHEMA_VERSION,
      symbolId: "AAPL",
      drawings: [],
      groups: [],
    });
  });
});

describe("drawing command store", () => {
  it("executes, undoes, and redoes commands", () => {
    const store = new DrawingCommandStore([line("a")]);
    store.execute({ kind: "add", drawing: line("b", 200) });
    store.execute({ kind: "update", before: line("a"), after: line("a", 110) });
    expect(store.snapshot().map((drawing) => drawing.price)).toEqual([110, 200]);

    expect(store.undo()?.map((drawing) => drawing.price)).toEqual([100, 200]);
    expect(store.undo()?.map((drawing) => drawing.id)).toEqual(["a"]);
    expect(store.redo()?.map((drawing) => drawing.id)).toEqual(["a", "b"]);
  });

  it("clears redo history after a new command", () => {
    const store = new DrawingCommandStore([line("a")]);
    store.execute({ kind: "add", drawing: line("b") });
    store.undo();
    store.execute({ kind: "add", drawing: line("c") });
    expect(store.canRedo).toBe(false);
  });

  it("treats a batch as one atomic history entry", () => {
    const store = new DrawingCommandStore([line("a"), line("b")]);
    store.executeBatch([
      { kind: "update", before: line("a"), after: line("a", 110) },
      { kind: "update", before: line("b"), after: line("b", 120) },
    ]);
    expect(store.snapshot().map((drawing) => drawing.price)).toEqual([110, 120]);
    expect(store.undo()?.map((drawing) => drawing.price)).toEqual([100, 100]);
    expect(store.redo()?.map((drawing) => drawing.price)).toEqual([110, 120]);
  });

  it("isolates history and snapshots from caller mutation", () => {
    const drawing: DrawingLine = { ...line("fib"), type: "fibonacci", fibLevels: [0, 1] };
    const store = new DrawingCommandStore();
    store.execute({ kind: "add", drawing });
    drawing.price = 999;
    drawing.fibLevels?.push(2);
    const snapshot = store.snapshot();
    snapshot[0]!.price = 500;
    snapshot[0]!.fibLevels?.push(3);
    expect(store.snapshot()[0]).toMatchObject({ price: 100, fibLevels: [0, 1] });
    expect(store.undo()).toEqual([]);
    expect(store.redo()?.[0]).toMatchObject({ price: 100, fibLevels: [0, 1] });
  });
});

describe("drawing tool registry", () => {
  it("maps placement aliases to stored types", () => {
    expect(getDrawingToolDefinition("ray")?.storedType).toBe("trendline");
    expect(getDrawingToolDefinition("measure")?.storedType).toBeNull();
    expect(getDrawingToolDefinition("long-position")?.capabilities.has("risk")).toBe(true);
  });

  it("owns interaction metadata for every stored drawing type", () => {
    expect(getDrawingTypeDefinition("arrow")).toMatchObject({
      hitStrategy: "trendline",
      renderStrategy: "arrow",
      anchorCount: 2,
    });
    expect(getDrawingTypeDefinition("channel")).toMatchObject({
      hitStrategy: "channel",
      renderStrategy: "channel",
      anchorCount: 3,
    });
    expect(getDrawingTypeDefinition("text")).toMatchObject({
      hitStrategy: "text",
      renderStrategy: "text",
      anchorCount: 1,
    });
  });
});
