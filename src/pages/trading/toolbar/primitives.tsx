import { type LucideIcon, ChevronDown } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "../../../lib/utils.ts";

/** Thin vertical rule separating toolbar control groups (TradingView-style). */
export function ToolbarDivider({ className }: { className?: string }) {
  return <div className={cn("h-4 w-px shrink-0 bg-border mx-1", className)} aria-hidden />;
}

interface ToolbarMenuProps {
  /** Accessible label + tooltip for the trigger. */
  label: string;
  /** Leading icon; omit for a text-only trigger. */
  icon?: LucideIcon;
  /** Trigger text shown after the icon (e.g. the active interval). */
  value?: string;
  active?: boolean;
  disabled?: boolean;
  /** Hint shown in the tooltip after the label, e.g. "Ctrl+K". */
  shortcut?: string;
  /** Menu width class; menus size to content when omitted. */
  panelClassName?: string;
  /** Align the panel's right edge to the trigger (right-side toolbar groups). */
  align?: "left" | "right";
  children: (close: () => void) => ReactNode;
}

/**
 * Toolbar dropdown: trigger + managed popover. Handles outside-click, Escape
 * and focus return so each menu composes identically to TradingView's.
 */
export function ToolbarMenu({
  label,
  icon: Icon,
  value,
  active = false,
  disabled = false,
  shortcut,
  panelClassName,
  align = "left",
  children,
}: ToolbarMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={shortcut ? `${label} (${shortcut})` : label}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-1 px-1.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors",
          active
            ? "bg-primary/15 text-primary"
            : "text-muted-foreground hover:bg-secondary hover:text-foreground",
          disabled && "opacity-40 cursor-default hover:bg-transparent",
          open && !active && "bg-secondary text-foreground",
        )}
      >
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
        {value && <span className="font-semibold text-foreground">{value}</span>}
        {(value || Icon) && <ChevronDown className="h-3 w-3 opacity-50 -mr-0.5" />}
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            "absolute top-full z-50 mt-1 min-w-[200px] bg-popover border border-border rounded-lg shadow-xl py-1 max-h-[70vh] overflow-y-auto",
            align === "left" ? "left-0" : "right-0",
            panelClassName,
          )}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

/** Small uppercase-free group heading inside a menu. */
export function MenuSection({ label }: { label: string }) {
  return (
    <div className="px-3 pt-2 pb-1 text-[10px] font-medium text-muted-foreground/80 select-none">
      {label}
    </div>
  );
}

export function MenuDivider() {
  return <div className="my-1 border-t border-border" aria-hidden />;
}

interface MenuRowProps {
  icon?: LucideIcon;
  label: string;
  shortcut?: string;
  selected?: boolean;
  /** Starred state for favorite toggles; omit to hide the column. */
  starred?: boolean;
  onPick?: () => void;
  onToggleStar?: () => void;
  trailing?: ReactNode;
}

/** One selectable menu item with optional shortcut hint, check and favorite. */
export function MenuRow({
  icon: Icon,
  label,
  shortcut,
  selected = false,
  starred,
  onPick,
  onToggleStar,
  trailing,
}: MenuRowProps) {
  return (
    <div
      role="menuitemradio"
      aria-checked={selected}
      className={cn(
        "flex items-center gap-2 mx-1 px-2 py-1.5 rounded-md text-xs cursor-pointer",
        selected ? "bg-secondary text-foreground" : "hover:bg-secondary/70",
      )}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick?.();
        }
      }}
      tabIndex={0}
    >
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      <span className="flex-1 truncate">{label}</span>
      {shortcut && (
        <span className="text-[10px] text-muted-foreground/60 tabular-nums">{shortcut}</span>
      )}
      {trailing}
      {onToggleStar ? (
        <button
          type="button"
          aria-label={starred ? `Remove ${label} from favorites` : `Add ${label} to favorites`}
          className="p-0.5 rounded hover:bg-background/60"
          onClick={(e) => {
            e.stopPropagation();
            onToggleStar();
          }}
        >
          <Star starred={starred ?? false} />
        </button>
      ) : (
        <MenuCheck show={selected} />
      )}
    </div>
  );
}

function Star({ starred }: { starred: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("h-3 w-3", starred ? "fill-amber-400 text-amber-400" : "fill-none text-muted-foreground/40")}
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

function MenuCheck({ show }: { show: boolean }) {
  return (
    <span
      className={cn("w-3 shrink-0 text-primary", show ? "opacity-100" : "opacity-0")}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3">
        <path d="M20 6L9 17l-5-5" />
      </svg>
    </span>
  );
}
