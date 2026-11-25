import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
  meta?: string;
  tone?: "success" | "danger" | "neutral";
}

interface SelectPopoverProps {
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  compact?: boolean;
  mono?: boolean;
}

interface MenuGeometry {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  openUpward: boolean;
}

export function SelectPopover({
  value,
  options,
  onChange,
  placeholder = "请选择...",
  disabled = false,
  ariaLabel,
  className = "",
  compact = false,
  mono = false,
}: SelectPopoverProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [geometry, setGeometry] = useState<MenuGeometry | null>(null);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();

  const selectedOption = useMemo(
    () => options.find((opt) => opt.value === value) ?? null,
    [options, value],
  );

  const computeGeometry = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const estimatedHeight = Math.min(260, options.length * 32 + 12);
    const openUpward = spaceBelow < Math.min(180, estimatedHeight) && spaceAbove > spaceBelow;
    const available = openUpward ? spaceAbove : spaceBelow;
    const maxHeight = Math.max(120, Math.min(260, available));

    const minWidth = Math.max(rect.width, 180);
    const maxLeft = Math.max(8, window.innerWidth - minWidth - 8);
    const left = Math.min(rect.left, maxLeft);

    setGeometry({
      top: openUpward ? rect.top - 4 : rect.bottom + 4,
      left,
      width: minWidth,
      maxHeight,
      openUpward,
    });
  }, [options.length]);

  useEffect(() => {
    if (!open) return;
    computeGeometry();

    const idx = options.findIndex((o) => o.value === value);
    setActiveIndex(idx >= 0 ? idx : 0);

    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };

    const onScroll = (e: Event) => {
      const target = e.target as Node | null;
      if (menuRef.current && target && menuRef.current.contains(target)) {
        return;
      }
      computeGeometry();
    };

    const onResize = () => computeGeometry();

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, options, value, computeGeometry]);

  const selectAt = (index: number) => {
    const opt = options[index];
    if (!opt) return;
    onChange(opt.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }

    switch (e.key) {
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        break;
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((prev) => (options.length === 0 ? -1 : (prev + 1) % options.length));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((prev) =>
          options.length === 0 ? -1 : (prev - 1 + options.length) % options.length,
        );
        break;
      case "Home":
        e.preventDefault();
        setActiveIndex(options.length > 0 ? 0 : -1);
        break;
      case "End":
        e.preventDefault();
        setActiveIndex(options.length > 0 ? options.length - 1 : -1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (activeIndex >= 0) {
          selectAt(activeIndex);
        }
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={() => !disabled && setOpen((prev) => !prev)}
        onKeyDown={handleKeyDown}
        className={`df-input inline-flex items-center justify-between gap-2 text-left ${
          compact
            ? "min-h-[30px] px-2.5 py-1 text-[13px]"
            : "min-h-[34px] px-3 py-1.5 text-[13.5px]"
        } ${mono ? "font-mono" : ""} ${className}`}
      >
        <span className="min-w-0 flex-1 truncate">
          {selectedOption ? (
            <span className="inline-flex items-center gap-1.5">
              {selectedOption.tone && (
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    selectedOption.tone === "success"
                      ? "bg-[var(--df-success)]"
                      : selectedOption.tone === "danger"
                        ? "bg-[var(--df-danger)]"
                        : "bg-[var(--df-neutral)]"
                  }`}
                />
              )}
              <span className="truncate">{selectedOption.label}</span>
            </span>
          ) : (
            <span className="text-ink-subtle">{placeholder}</span>
          )}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-ink-subtle transition-transform duration-150 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open &&
        geometry &&
        createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            style={{
              position: "fixed",
              top: geometry.top,
              left: geometry.left,
              minWidth: geometry.width,
              maxHeight: geometry.maxHeight,
              transform: geometry.openUpward ? "translateY(-100%)" : undefined,
            }}
            className="df-float z-[80] overflow-y-auto rounded-[8px] border border-hairline-strong bg-surface-2 p-1"
          >
            {options.length === 0 ? (
              <div className="px-2.5 py-2 text-[13px] text-ink-subtle">暂无可选项</div>
            ) : (
              options.map((opt, idx) => {
                const isSelected = opt.value === value;
                const isActive = idx === activeIndex;
                return (
                  <button
                    key={opt.value}
                    id={`${listboxId}-opt-${idx}`}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => selectAt(idx)}
                    className={`flex w-full items-center justify-between gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-[13.5px] transition ${
                      isActive || isSelected
                        ? "bg-surface-3 text-ink"
                        : "text-ink-muted hover:bg-surface-3 hover:text-ink"
                    } ${mono ? "font-mono" : ""}`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {opt.tone && (
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            opt.tone === "success"
                              ? "bg-[var(--df-success)]"
                              : opt.tone === "danger"
                                ? "bg-[var(--df-danger)]"
                                : "bg-[var(--df-neutral)]"
                          }`}
                        />
                      )}
                      <span className="truncate font-medium">{opt.label}</span>
                      {opt.meta && (
                        <span className="shrink-0 font-mono text-[12px] text-ink-subtle">
                          {opt.meta}
                        </span>
                      )}
                    </span>
                    {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-primary-text" />}
                  </button>
                );
              })
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
