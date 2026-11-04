#!/bin/zsh
# Nightly Leads Log maintenance: backup + section tidy + vault copy.
# LaunchAgent com.blp.sheet-maintenance (2:15 AM; runs at next wake if the
# Mac was asleep — skipped entirely if it was shut down).
#  1. POST /api/backup  → full-sheet CSV into the private Supabase bucket
#  2. download that CSV into the BLP Knowledge Vault (Brigham 11/4) —
#     Ops/Leads Log Backups/, which the vault's .gitignore keeps OUT of the
#     shared GitHub repo (customer contact lists never go to the repo —
#     99 Meta/vault-backup-brief.md rule 4). Newest 30 kept.
#  3. POST /api/sync tidy
KEY=$(grep '^BLP_ARNOLD_ACCESS_KEY=' ~/salesapp2/.env.local | cut -d= -f2)
APP=${APP:-https://blpsalesapp.netlify.app}
VAULT_DIR="$HOME/Documents/BLP Knowledge Vault/Ops/Leads Log Backups"
TELEGRAM_TOKEN=$(grep '^TELEGRAM_BOT_TOKEN=' ~/salesapp2/.env.local | cut -d= -f2)
TELEGRAM_CHAT=$(grep '^TELEGRAM_CHAT_ID=' ~/salesapp2/.env.local | cut -d= -f2)

echo "=== $(date -u +%FT%TZ)"
RESP=$(curl -s --max-time 120 -X POST $APP/api/backup -H "x-blp-key: $KEY" -H 'Content-Type: application/json')
echo "backup: $(echo "$RESP" | head -c 200)"

NAME=$(echo "$RESP" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("file",{}).get("name",""))' 2>/dev/null)
LINK=$(echo "$RESP" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("file",{}).get("webViewLink",""))' 2>/dev/null)
if [[ -n "$NAME" && -n "$LINK" ]]; then
  mkdir -p "$VAULT_DIR"
  if curl -s --max-time 300 -fL "$LINK" -o "$VAULT_DIR/$NAME.tmp" && [[ -s "$VAULT_DIR/$NAME.tmp" ]]; then
    mv "$VAULT_DIR/$NAME.tmp" "$VAULT_DIR/$NAME"
    echo "vault:  saved $NAME ($(du -h "$VAULT_DIR/$NAME" | cut -f1))"
    # Keep the newest 30 in the vault, same as Supabase.
    ls -1t "$VAULT_DIR"/leads-log-backup-*.csv 2>/dev/null | tail -n +31 | while read -r old; do rm -f "$old"; echo "vault:  pruned $(basename "$old")"; done
  else
    rm -f "$VAULT_DIR/$NAME.tmp"
    echo "vault:  download FAILED for $NAME"
  fi
else
  echo "vault:  skipped — backup did not return a file"
  # The backup failed silently for two months (Aug 30 → Nov 2, 2026): ping the team.
  if [[ -n "$TELEGRAM_TOKEN" && -n "$TELEGRAM_CHAT" ]]; then
    curl -s --max-time 20 -X POST "https://api.telegram.org/bot$TELEGRAM_TOKEN/sendMessage" \
      --data-urlencode "chat_id=$TELEGRAM_CHAT" \
      --data-urlencode "text=⚠️ Nightly Leads Log backup FAILED: $(echo "$RESP" | head -c 300)" >/dev/null
  fi
fi

echo "tidy:   $(curl -s --max-time 120 -X POST $APP/api/sync -H "x-blp-key: $KEY" -H 'Content-Type: application/json' -d '{"action":"tidy"}' | head -c 200)"
