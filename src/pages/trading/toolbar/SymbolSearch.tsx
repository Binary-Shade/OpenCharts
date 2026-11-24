import { ChevronDown, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../../lib/utils.ts";

export interface SymbolOption {
  id?: string;
  name: string;
  displayName?: string | null;
  assetClass?: string;
  category?: string;
}

interface SymbolSearchProps {
  symbols: SymbolOption[];
  selectedSymbol: string;
  onSymbolChange: (s: string) => void;
  /** Render the compact legend variant (no bold sizing). */
  compact?: boolean;
  align?: "left" | "right";
}

/**
 * Symbol button + search popover, shared by the top toolbar and the chart
 * legend so both surfaces open the identical picker.
 */
export function SymbolSearch({
  symbols,
  selectedSymbol,
  onSymbolChange,
  compact = false,
  align = "left",
}: SymbolSearchProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const filtered = symbols.filter(
    (s) =>
      s.name.toLowerCase().includes(filter.toLowerCase()) ||
      (s.category || "").toLowerCase().includes(filter.toLowerCase()),
  );

  const pick = (name: string) => {
    onSymbolChange(name);
    setOpen(false);
    setFilter("");
  };

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Change symbol (current ${selectedSymbol})`}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-1.5 rounded-md hover:bg-secondary transition-colors",
          compact
            ? "px-1.5 py-0.5 font-bold text-[13px] tracking-tight"
            : "px-2.5 py-1.5 font-bold text-sm tracking-tight",
        )}
      >
        {selectedSymbol}
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Symbol search"
          className={cn(
            "absolute top-full z-50 mt-1 w-64 bg-popover border border-border rounded-lg shadow-xl overflow-hidden",
            align === "left" ? "left-0" : "right-0",
          )}
        >
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search symbols…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
            />
            <button
              type="button"
              aria-label="Close symbol search"
              onClick={() => setOpen(false)}
              className="p-0.5 rounded hover:bg-secondary"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                No symbols match &ldquo;{filter}&rdquo;
              </div>
            ) : (
              filtered.map((s) => (
                <button
                  key={s.id || s.name}
                  type="button"
                  onClick={() => pick(s.name)}
                  className={cn(
                    "w-full flex items-center gap-2 mx-1 px-2 py-1.5 rounded-md text-xs text-left hover:bg-secondary/70",
                    s.name === selectedSymbol && "bg-secondary",
                  )}
                >
                  <span className="font-medium truncate">{s.name}</span>
                  {s.displayName && s.displayName !== s.name && (
                    <span className="text-muted-foreground truncate">{s.displayName}</span>
                  )}
                  <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
                    {s.category || s.assetClass}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
