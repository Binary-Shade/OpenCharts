import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Circle,
  Equal,
  EyeOff,
  GripVertical,
  Layers,
  Layers3,
  type LucideIcon,
  Magnet,
  Minus,
  MousePointer2,
  MoveUpRight,
  MoveVertical,
  PenTool,
  Repeat,
  Ruler,
  Spline,
  Square,
  Trash2,
  TrendingUp,
  Triangle,
  Type,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useDragOffset } from "../../hooks/useDragOffset.ts";
import { cn } from "../../lib/utils.ts";
import type { DrawingTool, MagnetMode } from "./constants.ts";

interface ToolMeta {
  tool: DrawingTool;
  icon: LucideIcon;
  label: string;
  shortcut?: string;
}

interface ToolSection {
  label: string;
  tools: ToolMeta[];
}

interface RailGroup {
  id: string;
  icon: LucideIcon;
  label: string;
  sections: ToolSection[];
}

/**
 * Drawing-tool catalog grouped the way TradingView's left rail groups them.
 * Only tools the drawing engine renders are listed; new engine tools slot
 * into these sections without touching the rail.
 */
const GROUPS: RailGroup[] = [
  {
    id: "trend",
    icon: TrendingUp,
    label: "Trend tools",
    sections: [
      {
        label: "Lines",
        tools: [
          { tool: "trendline", icon: TrendingUp, label: "Trendline", shortcut: "Alt+T" },
          { tool: "ray", icon: MoveUpRight, label: "Ray" },
          { tool: "extended", icon: Spline, label: "Extended line" },
          { tool: "horizontal", icon: Minus, label: "Horizontal line", shortcut: "Alt+H" },
          { tool: "vertical", icon: MoveVertical, label: "Vertical line", shortcut: "Alt+V" },
        ],
      },
      {
        label: "Channels",
        tools: [{ tool: "channel", icon: Equal, label: "Parallel channel" }],
      },
    ],
  },
  {
    id: "fib",
    icon: Layers,
    label: "Gann and Fibonacci tools",
    sections: [
      {
        label: "Fibonacci",
        tools: [
          { tool: "fibonacci", icon: Layers, label: "Fib retracement", shortcut: "Alt+F" },
          { tool: "fibextension", icon: Layers3, label: "Fib extension" },
        ],
      },
    ],
  },
  {
    id: "shapes",
    icon: Square,
    label: "Geometric shapes",
    sections: [
      {
        label: "Shapes",
        tools: [
          { tool: "rectangle", icon: Square, label: "Rectangle", shortcut: "Alt+R" },
          { tool: "ellipse", icon: Circle, label: "Ellipse" },
          { tool: "triangle", icon: Triangle, label: "Triangle" },
          { tool: "arrow", icon: ArrowRight, label: "Arrow" },
        ],
      },
    ],
  },
  {
    id: "forecast",
    icon: ArrowUpRight,
    label: "Forecasting and measurement tools",
    sections: [
      {
        label: "Positions & measure",
        tools: [
          { tool: "long-position", icon: ArrowUpRight, label: "Long position" },
          { tool: "short-position", icon: ArrowDownRight, label: "Short position" },
          { tool: "measure", icon: Ruler, label: "Measure", shortcut: "Alt+M" },
        ],
      },
    ],
  },
  {
    id: "text",
    icon: Type,
    label: "Text",
    sections: [{ label: "Annotations", tools: [{ tool: "text", icon: Type, label: "Text" }] }],
  },
];

const ALL_TOOLS: ToolMeta[] = GROUPS.flatMap((g) => g.sections.flatMap((s) => s.tools));

function RailButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "p-1.5 rounded-md transition-colors",
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

interface RailGroupButtonProps {
  group: RailGroup;
  activeTool: DrawingTool;
  open: boolean;
  onToggle: () => void;
  onSelect: (t: DrawingTool) => void;
}

/**
 * Rail group: the button shows the last-used tool of the group and opens a
 * right-side flyout with TradingView-style sections, shortcuts and checks.
 */
function RailGroupButton({ group, activeTool, open, onToggle, onSelect }: RailGroupButtonProps) {
  const activeMeta = ALL_TOOLS.find((t) => t.tool === activeTool);
  const groupToolIds = new Set(group.sections.flatMap((s) => s.tools.map((t) => t.tool)));
  const lastUsed = group.sections
    .flatMap((s) => s.tools)
    .find((t) => t.tool === activeTool);
  const Icon = lastUsed?.icon ?? group.icon;
  const isActive = Boolean(activeMeta && groupToolIds.has(activeMeta.tool));

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={lastUsed ? `${group.label} — ${lastUsed.label}` : group.label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-pressed={isActive}
        title={lastUsed ? `${group.label} — ${lastUsed.label}` : group.label}
        onClick={onToggle}
        className={cn(
          "relative flex items-center justify-center p-1.5 rounded-md transition-colors",
          isActive
            ? "bg-primary/15 text-primary"
            : "text-muted-foreground hover:bg-secondary hover:text-foreground",
          open && !isActive && "bg-secondary text-foreground",
        )}
      >
        <Icon className="h-4 w-4" />
        <span className="absolute right-0.5 bottom-0.5 h-1 w-1 rounded-full bg-current opacity-50" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-full top-0 ml-1 z-30 min-w-[210px] bg-popover border border-border rounded-lg shadow-xl py-1 max-h-[80vh] overflow-y-auto"
        >
          {group.sections.map((section, index) => (
            <div key={section.label}>
              {index > 0 && <div className="my-1 border-t border-border" aria-hidden />}
              <div className="px-3 pt-1.5 pb-1 text-[10px] font-medium text-muted-foreground/80 select-none">
                {section.label}
              </div>
              {section.tools.map((tool) => {
                const selected = activeTool === tool.tool;
                return (
                  <div
                    key={tool.tool}
                    role="menuitemradio"
                    aria-checked={selected}
                    tabIndex={0}
                    onClick={() => onSelect(tool.tool)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(tool.tool);
                      }
                    }}
                    className={cn(
                      "flex items-center gap-2 mx-1 px-2 py-1.5 rounded-md text-xs cursor-pointer",
                      selected ? "bg-secondary text-foreground" : "hover:bg-secondary/70",
                    )}
                  >
                    <tool.icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">{tool.label}</span>
                    {tool.shortcut && (
                      <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                        {tool.shortcut}
                      </span>
                    )}
                    <span
                      className={cn(
                        "w-3 shrink-0 text-primary",
                        selected ? "opacity-100" : "opacity-0",
                      )}
                      aria-hidden
                    >
                      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const MAGNET_LABELS: Record<MagnetMode, string> = {
  none: "Magnet: off",
  weak: "Magnet: weak",
  strong: "Magnet: strong",
};

export interface DrawingToolRailProps {
  drawingTool: DrawingTool;
  onDrawingTool: (t: DrawingTool) => void;
  magnetMode: MagnetMode;
  onSetMagnet?: (mode: MagnetMode) => void;
  stayInDrawingMode: boolean;
  onToggleStayInDrawingMode?: () => void;
  onClearDrawings?: () => void;
  drawingCount?: number;
}

/**
 * TradingView-style vertical drawing rail: cursor, grouped tool flyouts
 * (lines/channels, Fibonacci, shapes, forecast & measurement, text) and a
 * utility group — magnet mode with off/weak/strong, keep-drawing, hide rail,
 * remove objects. Draggable; collapsible to a restorable grip.
 */
export function DrawingToolRail({
  drawingTool,
  onDrawingTool,
  magnetMode,
  onSetMagnet,
  stayInDrawingMode,
  onToggleStayInDrawingMode,
  onClearDrawings,
  drawingCount = 0,
}: DrawingToolRailProps) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [utilityOpen, setUtilityOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const drag = useDragOffset();

  useEffect(() => {
    if (!openGroup && !utilityOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpenGroup(null);
        setUtilityOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openGroup, utilityOpen]);

  const select = (t: DrawingTool) => {
    onDrawingTool(drawingTool === t ? "none" : t);
    setOpenGroup(null);
  };

  const hide = () => {
    setOpenGroup(null);
    setUtilityOpen(false);
    setHidden(true);
  };

  const utilityActive = magnetMode !== "none" || stayInDrawingMode;

  // Collapsed: a small restorable grip where the rail was last positioned.
  if (hidden) {
    return (
      <button
        type="button"
        title="Show drawing tools"
        aria-label="Show drawing tools"
        onClick={() => setHidden(false)}
        style={drag.style}
        className="absolute left-1 top-1 z-20 rounded-md border border-border bg-card/90 p-1.5 text-muted-foreground backdrop-blur-sm hover:text-primary"
      >
        <PenTool className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div
      ref={ref}
      style={drag.style}
      role="toolbar"
      aria-label="Drawing tools"
      className="absolute left-1 top-1 z-20 flex flex-col items-center gap-0.5 rounded-md bg-card/90 border border-border p-0.5 backdrop-blur-sm"
    >
      <div
        onPointerDown={drag.onPointerDown}
        title="Drag to move"
        className="flex w-full cursor-move justify-center py-0.5 text-muted-foreground/50 hover:text-muted-foreground"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </div>

      <RailButton
        icon={MousePointer2}
        label="Cursor"
        active={drawingTool === "none"}
        onClick={() => {
          onDrawingTool("none");
          setOpenGroup(null);
        }}
      />
      <RailButton
        icon={TrendingUp}
        label="Trendline (Alt+T)"
        active={drawingTool === "trendline"}
        onClick={() => select("trendline")}
      />

      {GROUPS.map((g) => (
        <RailGroupButton
          key={g.id}
          group={g}
          activeTool={drawingTool}
          open={openGroup === g.id}
          onToggle={() => {
            setOpenGroup((o) => (o === g.id ? null : g.id));
            setUtilityOpen(false);
          }}
          onSelect={select}
        />
      ))}

      <div className="my-0.5 w-full border-t border-border/50" />

      {/* Utility group: magnet / keep-drawing / hide / remove */}
      <div className="relative">
        <RailButton
          icon={Magnet}
          label={`${MAGNET_LABELS[magnetMode]} (Ctrl)`}
          active={utilityActive || utilityOpen}
          onClick={() => {
            setUtilityOpen((v) => !v);
            setOpenGroup(null);
          }}
        />
        {utilityOpen && (
          <div
            role="menu"
            className="absolute left-full top-0 ml-1 z-30 min-w-[210px] bg-popover border border-border rounded-lg shadow-xl py-1"
          >
            <div className="px-3 pt-1.5 pb-1 text-[10px] font-medium text-muted-foreground/80 select-none">
              Magnet mode (Ctrl)
            </div>
            {(["none", "weak", "strong"] as MagnetMode[]).map((mode) => (
              <div
                key={mode}
                role="menuitemradio"
                aria-checked={magnetMode === mode}
                tabIndex={0}
                onClick={() => {
                  onSetMagnet?.(mode);
                  setUtilityOpen(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSetMagnet?.(mode);
                    setUtilityOpen(false);
                  }
                }}
                className={cn(
                  "flex items-center gap-2 mx-1 px-2 py-1.5 rounded-md text-xs cursor-pointer",
                  magnetMode === mode ? "bg-secondary text-foreground" : "hover:bg-secondary/70",
                )}
              >
                <Magnet className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1">{MAGNET_LABELS[mode]}</span>
                <span
                  className={cn(
                    "w-3 shrink-0 text-primary",
                    magnetMode === mode ? "opacity-100" : "opacity-0",
                  )}
                  aria-hidden
                >
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </span>
              </div>
            ))}
            <div className="my-1 border-t border-border" aria-hidden />
            <div
              role="menuitemcheckbox"
              aria-checked={stayInDrawingMode}
              tabIndex={0}
              onClick={() => onToggleStayInDrawingMode?.()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onToggleStayInDrawingMode?.();
                }
              }}
              className={cn(
                "flex items-center gap-2 mx-1 px-2 py-1.5 rounded-md text-xs cursor-pointer",
                stayInDrawingMode ? "bg-secondary text-foreground" : "hover:bg-secondary/70",
              )}
            >
              <Repeat className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1">Keep drawing tool selected</span>
              <span
                className={cn(
                  "text-[10px] font-medium",
                  stayInDrawingMode ? "text-primary" : "text-muted-foreground/50",
                )}
              >
                {stayInDrawingMode ? "ON" : "OFF"}
              </span>
            </div>
            <div className="my-1 border-t border-border" aria-hidden />
            <div
              role="menuitem"
              tabIndex={0}
              onClick={hide}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  hide();
                }
              }}
              className="flex items-center gap-2 mx-1 px-2 py-1.5 rounded-md text-xs cursor-pointer hover:bg-secondary/70"
            >
              <EyeOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1">Hide drawing toolbar</span>
            </div>
            {drawingCount > 0 && onClearDrawings && (
              <div
                role="menuitem"
                tabIndex={0}
                onClick={() => {
                  onClearDrawings();
                  setUtilityOpen(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onClearDrawings();
                    setUtilityOpen(false);
                  }
                }}
                className="flex items-center gap-2 mx-1 px-2 py-1.5 rounded-md text-xs cursor-pointer hover:bg-secondary/70"
              >
                <Trash2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1">Remove all objects</span>
                <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                  {drawingCount}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
