#!/bin/bash
# The Piano Log parser has ONE canonical copy:
#   salesapp2/netlify/functions/lib/pianolog-parse.cjs   (the sync uses it)
# The Store Map and the Piano Log app keep byte-identical copies for their
# fallback paths (CSV export / Apps Script bridge when Supabase is empty).
# Run after editing the canonical file; `--check` only reports drift.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/netlify/functions/lib/pianolog-parse.cjs"
DESTS=(
  "$HOME/BLPStoreMap/netlify/functions/lib/pianolog-parse.cjs"
  "$HOME/PianoLogApp/netlify/functions/lib/pianolog-parse.cjs"
)
rc=0
for d in "${DESTS[@]}"; do
  if [ "${1:-}" = "--check" ]; then
    if cmp -s "$SRC" "$d"; then echo "✓ in sync: $d"; else echo "✗ DRIFT: $d"; rc=1; fi
  else
    mkdir -p "$(dirname "$d")"; cp "$SRC" "$d"; echo "• copied → $d"
  fi
done
exit $rc
