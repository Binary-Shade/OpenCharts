import {
  DRAWING_SCHEMA_VERSION,
  DRAWING_TYPES,
  type DrawingDocument,
  type DrawingGroup,
  type DrawingLine,
  type DrawingType,
} from "./model.ts";

const TYPE_SET: ReadonlySet<string> = new Set(DRAWING_TYPES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isDrawingLine(value: unknown): value is DrawingLine {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.type === "string" &&
    TYPE_SET.has(value.type) &&
    finite(value.price) &&
    typeof value.color === "string"
  );
}

function sanitizeDrawing(value: unknown): DrawingLine | null {
  if (!isDrawingLine(value)) return null;
  const drawing = { ...value } as DrawingLine;
  drawing.type = value.type as DrawingType;
  if (drawing.fillOpacity !== undefined) {
    if (finite(drawing.fillOpacity)) {
      drawing.fillOpacity = Math.max(0, Math.min(1, drawing.fillOpacity));
    } else {
      delete drawing.fillOpacity;
    }
  }
  if (drawing.width !== undefined && (!finite(drawing.width) || drawing.width <= 0)) {
    delete drawing.width;
  }
  if (drawing.fibLevels) {
    drawing.fibLevels = Array.isArray(drawing.fibLevels) ? drawing.fibLevels.filter(finite) : [];
  }
  const optionalNumbers: Array<keyof DrawingLine> = [
    "price2", "time", "time2", "price3", "time3", "zIndex", "fontSize",
    "stopPrice", "targetPrice", "riskPct",
  ];
  for (const key of optionalNumbers) {
    if (drawing[key] !== undefined && !finite(drawing[key])) delete drawing[key];
  }
  if (drawing.lineStyle && !["solid", "dashed", "dotted"].includes(drawing.lineStyle)) {
    delete drawing.lineStyle;
  }
  if (drawing.side && drawing.side !== "long" && drawing.side !== "short") delete drawing.side;
  if (drawing.visibility && drawing.visibility !== "all" && drawing.visibility !== "tf") {
    delete drawing.visibility;
  }
  return drawing;
}

function sanitizeGroups(value: unknown, drawingIds: ReadonlySet<string>): DrawingGroup[] {
  if (!Array.isArray(value)) return [];
  const groups: DrawingGroup[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || candidate.id.length === 0) {
      continue;
    }
    const ids = Array.isArray(candidate.drawingIds)
      ? candidate.drawingIds.filter(
          (id): id is string => typeof id === "string" && drawingIds.has(id),
        )
      : [];
    groups.push({
      id: candidate.id,
      drawingIds: [...new Set(ids)],
      ...(typeof candidate.name === "string" ? { name: candidate.name } : {}),
      ...(typeof candidate.locked === "boolean" ? { locked: candidate.locked } : {}),
      ...(typeof candidate.hidden === "boolean" ? { hidden: candidate.hidden } : {}),
    });
  }
  return groups;
}

export function createDrawingDocument(
  symbolId: string,
  drawings: readonly DrawingLine[] = [],
): DrawingDocument {
  return {
    schemaVersion: DRAWING_SCHEMA_VERSION,
    symbolId,
    revision: 0,
    drawings: drawings.map((drawing) => ({ ...drawing })),
    groups: [],
    updatedAt: Date.now(),
  };
}

/**
 * Reads both the original bare DrawingLine[] payload and versioned documents.
 * Invalid entries are discarded individually so one corrupt drawing cannot
 * make every drawing for a symbol disappear.
 */
export function parseDrawingDocument(value: unknown, symbolId: string): DrawingDocument {
  const legacyDrawings = Array.isArray(value) ? value : null;
  const source = legacyDrawings ?? (isRecord(value) && Array.isArray(value.drawings) ? value.drawings : []);
  const seenIds = new Set<string>();
  const drawings = source.flatMap((candidate) => {
    const drawing = sanitizeDrawing(candidate);
    if (!drawing || seenIds.has(drawing.id)) return [];
    seenIds.add(drawing.id);
    return [drawing];
  });
  const ids = new Set(drawings.map((drawing) => drawing.id));

  if (!isRecord(value) || legacyDrawings) return createDrawingDocument(symbolId, drawings);

  return {
    schemaVersion: DRAWING_SCHEMA_VERSION,
    symbolId,
    ...(typeof value.chartId === "string" ? { chartId: value.chartId } : {}),
    revision: finite(value.revision) && value.revision >= 0 ? Math.floor(value.revision) : 0,
    drawings,
    groups: sanitizeGroups(value.groups, ids),
    updatedAt: finite(value.updatedAt) ? value.updatedAt : Date.now(),
  };
}

export function updateDrawingDocument(
  document: DrawingDocument,
  drawings: readonly DrawingLine[],
): DrawingDocument {
  return {
    ...document,
    revision: document.revision + 1,
    drawings: drawings.map((drawing) => ({ ...drawing })),
    updatedAt: Date.now(),
  };
}
