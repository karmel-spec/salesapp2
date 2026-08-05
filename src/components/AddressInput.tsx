"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";

/**
 * Address field with Google autocomplete: type a few characters and pick a
 * real address from the dropdown. Falls back to a plain input when Places
 * isn't configured. Picking a suggestion calls onPick (commit immediately).
 */
export function AddressInput({
  value,
  onChange,
  onPick,
  onBlur,
  onKeyDown,
  placeholder,
  autoFocus,
  disabled,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  onPick?: (v: string) => void;
  onBlur?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
}) {
  const [sugs, setSugs] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const picked = useRef(false);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function queueLookup(q: string) {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 4) {
      setSugs([]);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(() => {
      api<{ suggestions: string[] }>("/api/places", { method: "POST", body: JSON.stringify({ input: q }) })
        .then((r) => {
          setSugs(r.suggestions || []);
          setOpen((r.suggestions || []).length > 0);
        })
        .catch(() => setSugs([]));
    }, 250);
  }

  return (
    <span className="addr-wrap" style={{ position: "relative", display: "block" }}>
      <input
        style={{ width: "100%", ...style }}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
          queueLookup(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            setOpen(false);
            return;
          }
          onKeyDown?.(e);
        }}
        onBlur={() => {
          // A suggestion mousedown sets `picked` before blur fires — in that
          // case the pick handler owns the commit, not the blur.
          setTimeout(() => setOpen(false), 150);
          if (!picked.current) onBlur?.();
          picked.current = false;
        }}
        autoComplete="off"
      />
      {open && sugs.length > 0 && (
        <span className="addr-menu">
          {sugs.map((s) => (
            <button
              key={s}
              type="button"
              className="addr-item"
              onMouseDown={() => {
                picked.current = true;
                onChange(s);
                setOpen(false);
                onPick?.(s);
              }}
            >
              📍 {s}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
