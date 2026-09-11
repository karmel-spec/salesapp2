"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { looseIncludes } from "@/lib/search";

/**
 * Type-ahead picker: a search box that suggests matching options as you type
 * (forgiving match — any word order, case/punctuation ignored, digits match
 * phone numbers). Arrow keys move, Enter picks, Escape closes, ✕ clears.
 * An empty value means "no filter" (the placeholder says what that means).
 */
export function TypeAhead({
  value,
  options,
  onChange,
  placeholder,
  ariaLabel,
  maxSuggestions = 8,
}: {
  value: string;
  options: string[];
  onChange: (next: string) => void;
  placeholder: string;
  ariaLabel?: string;
  maxSuggestions?: number;
}) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);

  // Keep the box in sync when the filter is changed from elsewhere.
  useEffect(() => setText(value), [value]);

  const matches = useMemo(() => {
    const q = text.trim();
    if (!q) return options.slice(0, maxSuggestions);
    const hits = options.filter((o) => looseIncludes(o, q));
    // Names that start with what was typed float to the top.
    hits.sort((a, b) => Number(!a.toLowerCase().startsWith(q.toLowerCase())) - Number(!b.toLowerCase().startsWith(q.toLowerCase())));
    return hits.slice(0, maxSuggestions);
  }, [text, options, maxSuggestions]);

  useEffect(() => setHi(0), [matches.length, text]);

  // Click outside closes.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const pick = (v: string) => {
    onChange(v);
    setText(v);
    setOpen(false);
  };
  const clear = () => {
    onChange("");
    setText("");
    setOpen(false);
  };

  return (
    <div className={`typeahead${value ? " has-value" : ""}`} ref={wrap}>
      <input
        type="text"
        role="combobox"
        aria-label={ariaLabel || placeholder}
        aria-expanded={open}
        aria-autocomplete="list"
        placeholder={placeholder}
        value={text}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          if (!e.target.value.trim() && value) onChange(""); // emptied the box → back to everyone
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setHi((h) => Math.min(h + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            if (open && matches[hi]) {
              e.preventDefault();
              pick(matches[hi]);
            }
          } else if (e.key === "Escape") {
            setOpen(false);
            setText(value);
          }
        }}
      />
      {value && (
        <button type="button" className="typeahead-clear" aria-label="Clear" onClick={clear}>
          ✕
        </button>
      )}
      {open && matches.length > 0 && (
        <ul className="typeahead-list" role="listbox">
          {matches.map((m, i) => (
            <li
              key={m}
              role="option"
              aria-selected={i === hi}
              className={i === hi ? "hi" : ""}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus; the input's blur would race the click
                pick(m);
              }}
              onMouseEnter={() => setHi(i)}
            >
              {m}
            </li>
          ))}
        </ul>
      )}
      {open && text.trim() && matches.length === 0 && <div className="typeahead-list typeahead-empty">No one matches “{text.trim()}”</div>}
    </div>
  );
}
