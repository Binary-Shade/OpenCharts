import type { DrawingTool, DrawingType } from "./model.ts";

export type DrawingCategory = "lines" | "fibonacci" | "shapes" | "trade" | "annotations";
export type PlacementKind = "one-point" | "two-point" | "three-point" | "transient";
export type DrawingHitStrategy =
  | "trendline"
  | "horizontal"
  | "vertical"
  | "rectangle"
  | "fibonacci"
  | "position"
  | "channel"
  | "box-shape"
  | "text";
export type DrawingRenderStrategy =
  | "trendline"
  | "horizontal"
  | "vertical"
  | "rectangle"
  | "fibonacci"
  | "position"
  | "channel"
  | "ellipse"
  | "arrow"
  | "triangle"
  | "text";

export interface DrawingTypeDefinition {
  type: DrawingType;
  hitStrategy: DrawingHitStrategy;
  renderStrategy: DrawingRenderStrategy;
  anchorCount: 1 | 2 | 3;
}

export interface DrawingToolDefinition {
  tool: DrawingTool;
  storedType: DrawingType | null;
  category: DrawingCategory;
  placement: PlacementKind;
  label: string;
  defaultColor: string;
  capabilities: ReadonlySet<"fill" | "text" | "alert" | "extend" | "risk">;
}

const definitions: DrawingToolDefinition[] = [
  { tool: "trendline", storedType: "trendline", category: "lines", placement: "two-point", label: "Trend Line", defaultColor: "#2196F3", capabilities: new Set(["alert", "extend"]) },
  { tool: "ray", storedType: "trendline", category: "lines", placement: "two-point", label: "Ray", defaultColor: "#2196F3", capabilities: new Set(["alert", "extend"]) },
  { tool: "extended", storedType: "trendline", category: "lines", placement: "two-point", label: "Extended Line", defaultColor: "#2196F3", capabilities: new Set(["alert", "extend"]) },
  { tool: "horizontal", storedType: "horizontal", category: "lines", placement: "one-point", label: "Horizontal Line", defaultColor: "#f0b90b", capabilities: new Set(["alert"]) },
  { tool: "vertical", storedType: "vertical", category: "lines", placement: "one-point", label: "Vertical Line", defaultColor: "#f0b90b", capabilities: new Set() },
  { tool: "channel", storedType: "channel", category: "lines", placement: "three-point", label: "Parallel Channel", defaultColor: "#f0b90b", capabilities: new Set(["fill"]) },
  { tool: "fibonacci", storedType: "fibonacci", category: "fibonacci", placement: "two-point", label: "Fib Retracement", defaultColor: "#f0b90b", capabilities: new Set(["fill"]) },
  { tool: "fibextension", storedType: "fibextension", category: "fibonacci", placement: "two-point", label: "Fib Extension", defaultColor: "#f0b90b", capabilities: new Set(["fill"]) },
  { tool: "rectangle", storedType: "rectangle", category: "shapes", placement: "two-point", label: "Rectangle", defaultColor: "#f0b90b", capabilities: new Set(["fill"]) },
  { tool: "ellipse", storedType: "ellipse", category: "shapes", placement: "two-point", label: "Ellipse", defaultColor: "#f0b90b", capabilities: new Set(["fill"]) },
  { tool: "triangle", storedType: "triangle", category: "shapes", placement: "two-point", label: "Triangle", defaultColor: "#f0b90b", capabilities: new Set(["fill"]) },
  { tool: "arrow", storedType: "arrow", category: "shapes", placement: "two-point", label: "Arrow", defaultColor: "#f0b90b", capabilities: new Set() },
  { tool: "text", storedType: "text", category: "annotations", placement: "one-point", label: "Text", defaultColor: "#f0b90b", capabilities: new Set(["text"]) },
  { tool: "long-position", storedType: "position", category: "trade", placement: "two-point", label: "Long Position", defaultColor: "#089981", capabilities: new Set(["risk"]) },
  { tool: "short-position", storedType: "position", category: "trade", placement: "two-point", label: "Short Position", defaultColor: "#f23645", capabilities: new Set(["risk"]) },
  { tool: "measure", storedType: null, category: "trade", placement: "transient", label: "Measure", defaultColor: "#b2b5be", capabilities: new Set() },
];

const byTool = new Map(definitions.map((definition) => [definition.tool, definition]));

const typeDefinitions: Record<DrawingType, DrawingTypeDefinition> = {
  trendline: { type: "trendline", hitStrategy: "trendline", renderStrategy: "trendline", anchorCount: 2 },
  horizontal: { type: "horizontal", hitStrategy: "horizontal", renderStrategy: "horizontal", anchorCount: 1 },
  vertical: { type: "vertical", hitStrategy: "vertical", renderStrategy: "vertical", anchorCount: 1 },
  rectangle: { type: "rectangle", hitStrategy: "rectangle", renderStrategy: "rectangle", anchorCount: 2 },
  fibonacci: { type: "fibonacci", hitStrategy: "fibonacci", renderStrategy: "fibonacci", anchorCount: 2 },
  fibextension: { type: "fibextension", hitStrategy: "fibonacci", renderStrategy: "fibonacci", anchorCount: 2 },
  position: { type: "position", hitStrategy: "position", renderStrategy: "position", anchorCount: 2 },
  arrow: { type: "arrow", hitStrategy: "trendline", renderStrategy: "arrow", anchorCount: 2 },
  channel: { type: "channel", hitStrategy: "channel", renderStrategy: "channel", anchorCount: 3 },
  ellipse: { type: "ellipse", hitStrategy: "box-shape", renderStrategy: "ellipse", anchorCount: 2 },
  triangle: { type: "triangle", hitStrategy: "box-shape", renderStrategy: "triangle", anchorCount: 2 },
  text: { type: "text", hitStrategy: "text", renderStrategy: "text", anchorCount: 1 },
};

export const DRAWING_TOOL_REGISTRY: readonly DrawingToolDefinition[] = definitions;
export const DRAWING_TYPE_REGISTRY: Readonly<Record<DrawingType, DrawingTypeDefinition>> =
  typeDefinitions;

export function getDrawingToolDefinition(tool: DrawingTool): DrawingToolDefinition | null {
  return byTool.get(tool) ?? null;
}

export function getDrawingTypeDefinition(type: DrawingType): DrawingTypeDefinition {
  return typeDefinitions[type];
}
