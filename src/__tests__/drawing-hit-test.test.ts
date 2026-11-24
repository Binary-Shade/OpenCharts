import { describe, expect, it } from "vitest";
import { hitTest } from "../lib/chart-plugins/drawing-tools/hit-test.ts";
import type { ResolvedEntry } from "../lib/chart-plugins/drawing-tools/types.ts";
import type { DrawingLine, DrawingType } from "../packages/drawing-engine/index.ts";

function entry(id: string, type: DrawingType, offset = 0): ResolvedEntry {
  const drawing: DrawingLine = {
    id,
    type,
    color: "#fff",
    time: 1,
    price: 100,
    time2: 2,
    price2: 110,
  };
  return {
    d: drawing,
    x1: 10 + offset,
    y1: 10,
    x2: 110 + offset,
    y2: 110,
    state: "normal",
  };
}

describe("drawing hit testing", () => {
  it("uses registry aliases for arrow line interaction", () => {
    expect(hitTest([entry("arrow", "arrow")], { x: 60, y: 60 })).toEqual({
      id: "arrow",
      region: { kind: "body" },
    });
  });

  it("uses box interaction for ellipse interiors", () => {
    expect(hitTest([entry("ellipse", "ellipse")], { x: 60, y: 40 })).toEqual({
      id: "ellipse",
      region: { kind: "body" },
    });
  });

  it("prefers the last rendered drawing when drawings overlap", () => {
    expect(hitTest([entry("bottom", "rectangle"), entry("top", "ellipse")], { x: 60, y: 60 }))
      .toMatchObject({ id: "top" });
  });
});
