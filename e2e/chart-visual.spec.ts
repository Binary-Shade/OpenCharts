import { expect, test } from "./support/fixtures.ts";
import { waitForTerminal } from "./support/app.ts";

const MARKET_NOW_MS = Date.UTC(2026, 10, 24, 12, 0, 0);
const INTERVAL_MS = 15 * 60 * 1_000;

function drawingDocument() {
  const at = (barsAgo: number) => (MARKET_NOW_MS - barsAgo * INTERVAL_MS) / 1_000;
  return {
    schemaVersion: 1,
    symbolId: "BTC",
    revision: 1,
    updatedAt: MARKET_NOW_MS,
    groups: [],
    drawings: [
      { id: "trend", type: "trendline", time: at(65), price: 59_850, time2: at(25), price2: 60_130, color: "#2196F3", width: 2 },
      { id: "fib", type: "fibonacci", time: at(55), price: 60_150, time2: at(18), price2: 59_820, color: "#f0b90b", width: 1 },
      { id: "rect", type: "rectangle", time: at(42), price: 60_100, time2: at(12), price2: 59_900, color: "#9c27b0", fillColor: "#9c27b0", fillOpacity: 0.12 },
      { id: "arrow", type: "arrow", time: at(35), price: 59_860, time2: at(8), price2: 60_070, color: "#0ecb81", width: 2 },
      { id: "label", type: "text", time: at(30), price: 60_140, color: "#2196F3", text: "Phase A engine", fontSize: 14, textBg: true },
    ],
  };
}

async function seedChart(page: import("@playwright/test").Page, light: boolean) {
  await page.addInitScript(
    ({ drawingState, useLight }) => {
      localStorage.setItem("hl:anon:oc_drawings:v1:BTC", JSON.stringify(drawingState));
      const applyTheme = () => document.documentElement?.classList.toggle("light", useLight);
      applyTheme();
      if (!document.documentElement) {
        const observer = new MutationObserver(() => {
          if (!document.documentElement) return;
          applyTheme();
          observer.disconnect();
        });
        observer.observe(document, { childList: true });
      }
    },
    { drawingState: drawingDocument(), useLight: light },
  );
}

async function captureChart(page: import("@playwright/test").Page): Promise<Buffer> {
  const chart = page.getByTestId("chart-canvas");
  await expect(chart).toBeVisible();
  await expect.poll(() => chart.locator("canvas").count()).toBeGreaterThan(0);
  await expect
    .poll(() =>
      chart.locator("canvas").evaluateAll((canvases) =>
        canvases.some((canvas) => {
          const context = canvas.getContext("2d");
          if (!context || canvas.width === 0 || canvas.height === 0) return false;
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          for (let index = 0; index < pixels.length; index += 16) {
            const red = pixels[index] ?? 0;
            const green = pixels[index + 1] ?? 0;
            const blue = pixels[index + 2] ?? 0;
            if (blue > 180 && red < 80 && green > 80) return true;
          }
          return false;
        }),
      ),
    )
    .toBe(true);
  const box = await chart.boundingBox();
  if (!box) throw new Error("Chart canvas has no bounding box");
  // Exclude the live price axis and time axis, whose labels intentionally move.
  return page.screenshot({
    clip: {
      x: box.x + 24,
      y: box.y + 16,
      width: Math.max(1, box.width - 132),
      height: Math.max(1, box.height - 64),
    },
    animations: "disabled",
  });
}

test.describe("chart drawing visual baselines", () => {
  test("dark theme drawing families", async ({ page, hl }) => {
    await seedChart(page, false);
    await hl.open();
    await waitForTerminal(page);
    await expect(await captureChart(page)).toMatchSnapshot("chart-drawings-dark.png", {
      maxDiffPixelRatio: 0.01,
    });
  });

  test("light theme drawing families", async ({ page, hl }) => {
    await seedChart(page, true);
    await hl.open();
    await waitForTerminal(page);
    await expect(await captureChart(page)).toMatchSnapshot("chart-drawings-light.png", {
      maxDiffPixelRatio: 0.01,
    });
  });
});
