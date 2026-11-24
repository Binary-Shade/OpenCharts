/** Framework-independent drawing domain model. */

export const DRAWING_SCHEMA_VERSION = 1 as const;

export const DRAWING_TYPES = [
  "trendline",
  "horizontal",
  "fibonacci",
  "rectangle",
  "vertical",
  "channel",
  "text",
  "fibextension",
  "ellipse",
  "arrow",
  "triangle",
  "position",
] as const;

export type DrawingType = (typeof DRAWING_TYPES)[number];

export const DRAWING_TOOLS = [
  "none",
  ...DRAWING_TYPES,
  "ray",
  "extended",
  "long-position",
  "short-position",
  "measure",
] as const;

export type DrawingTool = (typeof DRAWING_TOOLS)[number];
export type DrawingLineStyle = "solid" | "dashed" | "dotted";
export type MagnetMode = "none" | "weak" | "strong";
export type DrawingVisibility = "all" | "tf";

export interface DrawingLine {
  id: string;
  type: DrawingType;
  price: number;
  price2?: number;
  time?: number;
  time2?: number;
  price3?: number;
  time3?: number;
  color: string;
  width?: number;
  lineStyle?: DrawingLineStyle;
  locked?: boolean;
  extendLeft?: boolean;
  extendRight?: boolean;
  hidden?: boolean;
  zIndex?: number;
  createdTf?: string;
  visibility?: DrawingVisibility;
  fillColor?: string;
  fillOpacity?: number;
  arrowStart?: boolean;
  arrowEnd?: boolean;
  text?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  textBg?: boolean;
  textBgColor?: string;
  textBorder?: boolean;
  textBorderColor?: string;
  fibLevels?: number[];
  side?: "long" | "short";
  stopPrice?: number;
  targetPrice?: number;
  riskPct?: number;
  alertEnabled?: boolean;
  alertMessage?: string;
}

export interface DrawingGroup {
  id: string;
  name?: string;
  drawingIds: string[];
  locked?: boolean;
  hidden?: boolean;
}

export interface DrawingDocument {
  schemaVersion: typeof DRAWING_SCHEMA_VERSION;
  symbolId: string;
  chartId?: string;
  revision: number;
  drawings: DrawingLine[];
  groups: DrawingGroup[];
  updatedAt: number;
}

export const DRAWING_COLORS = [
  "#2196F3",
  "#f0b90b",
  "#0ecb81",
  "#f6465d",
  "#9c27b0",
  "#ff9800",
  "#787b86",
  "#ffffff",
] as const;

export const DRAWING_WIDTHS = [1, 2, 3, 4] as const;
