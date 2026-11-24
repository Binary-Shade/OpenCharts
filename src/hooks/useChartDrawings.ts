import { useCallback, useEffect, useRef, useState } from "react";
import {
  DrawingCommandStore,
  type DrawingCommand,
  type DrawingLine,
} from "../packages/drawing-engine/index.ts";
import { api } from "../services/api";

// Render order: lower zIndex first (drawn underneath). Stable for ties, so
// drawings without an explicit zIndex keep creation order.
function sortByZ(list: DrawingLine[]): DrawingLine[] {
  return [...list].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
}

const NO_DRAWINGS: DrawingLine[] = [];

export function useChartDrawings(symbol: string, timeframe: string) {
  // State is tagged with the symbol it belongs to. Switching symbols therefore
  // needs no reset: drawings loaded for the previous symbol simply stop
  // matching and render as empty until the new set arrives. (The old code
  // cleared state from an effect, which cost an extra render and briefly
  // showed the wrong symbol's drawings.)
  const [loaded, setLoaded] = useState<{ symbol: string; list: DrawingLine[] }>({
    symbol,
    list: NO_DRAWINGS,
  });
  const drawings = loaded.symbol === symbol ? loaded.list : NO_DRAWINGS;
  const setDrawings = useCallback(
    (list: DrawingLine[]) => setLoaded({ symbol, list }),
    [symbol],
  );
  // Mirror of `drawings` so mutators can read current state synchronously
  // (needed to capture `before` snapshots for undo without stale closures).
  // Only ever touched from event handlers and async callbacks, never render.
  const drawingsRef = useRef<DrawingLine[]>([]);
  const commandStoreRef = useRef(new DrawingCommandStore());

  // Drawings load per symbol and are shared across timeframes (TradingView
  // behavior) — switching TF keeps them in place with no refetch.
  useEffect(() => {
    let cancelled = false;
    // Everything is swapped when the new symbol's drawings land, so the effect
    // body itself stays free of state and ref mutation. Until then the tagged
    // state below renders as empty rather than showing the old symbol's work.
    api.chartDrawings
      .list(symbol)
      .then((data) => {
        if (cancelled) return;
        const sorted = sortByZ(data ?? []);
        drawingsRef.current = sorted;
        commandStoreRef.current.reset(sorted);
        setLoaded({ symbol, list: sorted });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  // ── Primitive applies (state + ref mirror + server, no history) ──

  const applyAdd = useCallback((d: DrawingLine) => {
    drawingsRef.current = sortByZ([...drawingsRef.current, d]);
    setDrawings(drawingsRef.current);
    api.chartDrawings.save(symbol, timeframe, d).catch(() => {});
  }, [setDrawings, symbol, timeframe]);

  // The drawings POST endpoint upserts by drawingId, so edits reuse save().
  const applyUpdate = useCallback((d: DrawingLine) => {
    drawingsRef.current = sortByZ(drawingsRef.current.map((x) => (x.id === d.id ? d : x)));
    setDrawings(drawingsRef.current);
    api.chartDrawings.save(symbol, timeframe, d).catch(() => {});
  }, [setDrawings, symbol, timeframe]);

  const applyRemove = useCallback((id: string) => {
    drawingsRef.current = drawingsRef.current.filter((x) => x.id !== id);
    setDrawings(drawingsRef.current);
    api.chartDrawings.remove(id).catch(() => {});
  }, [setDrawings]);

  const record = useCallback((command: DrawingCommand) => {
    commandStoreRef.current.execute(command);
  }, []);

  // ── Public mutators (record history) ──

  const addDrawing = useCallback(
    (d: DrawingLine) => {
      record({ kind: "add", drawing: d });
      applyAdd(d);
    },
    [record, applyAdd],
  );

  const updateDrawing = useCallback(
    (d: DrawingLine) => {
      const before = drawingsRef.current.find((x) => x.id === d.id);
      if (before) record({ kind: "update", before, after: d });
      applyUpdate(d);
    },
    [record, applyUpdate],
  );

  const updateDrawings = useCallback(
    (updates: DrawingLine[]) => {
      if (updates.length === 0) return;
      const currentById = new Map(drawingsRef.current.map((drawing) => [drawing.id, drawing]));
      const commands: DrawingCommand[] = updates.flatMap((after) => {
        const before = currentById.get(after.id);
        return before ? [{ kind: "update" as const, before, after }] : [];
      });
      if (commands.length === 0) return;
      commandStoreRef.current.executeBatch(commands);
      const updatesById = new Map(updates.map((drawing) => [drawing.id, drawing]));
      drawingsRef.current = sortByZ(
        drawingsRef.current.map((drawing) => updatesById.get(drawing.id) ?? drawing),
      );
      setDrawings(drawingsRef.current);
      Promise.all(
        updates.map((drawing) => api.chartDrawings.save(symbol, timeframe, drawing)),
      ).catch(() => {});
    },
    [setDrawings, symbol, timeframe],
  );

  const removeDrawing = useCallback(
    (id: string) => {
      const drawing = drawingsRef.current.find((x) => x.id === id);
      if (drawing) record({ kind: "remove", drawing });
      applyRemove(id);
    },
    [record, applyRemove],
  );

  const clearDrawings = useCallback(() => {
    if (drawingsRef.current.length > 0) {
      record({ kind: "clear", drawings: drawingsRef.current });
    }
    drawingsRef.current = [];
    setDrawings([]);
    api.chartDrawings.clear(symbol).catch(() => {});
  }, [record, setDrawings, symbol]);

  // ── Undo / redo ──

  const applyHistorySnapshot = useCallback((next: DrawingLine[]) => {
    drawingsRef.current = sortByZ(next);
    setDrawings(drawingsRef.current);
    api.chartDrawings.replace(symbol, drawingsRef.current).catch(() => {});
  }, [setDrawings, symbol]);

  const undo = useCallback(() => {
    const next = commandStoreRef.current.undo();
    if (next) applyHistorySnapshot(next);
  }, [applyHistorySnapshot]);

  const redo = useCallback(() => {
    const next = commandStoreRef.current.redo();
    if (next) applyHistorySnapshot(next);
  }, [applyHistorySnapshot]);

  return {
    drawings,
    addDrawing,
    updateDrawing,
    updateDrawings,
    removeDrawing,
    clearDrawings,
    undo,
    redo,
  };
}
