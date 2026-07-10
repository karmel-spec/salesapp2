#!/bin/zsh
# Send a document to Telegram as @arnoldlarsonbot.
# Usage: send-telegram-doc.sh <file> [caption] [chat_id]
FILE="$1"
CAPTION="${2:-}"
CHAT="${3:-$(grep '^TELEGRAM_CHAT_ID=' ~/salesapp2/.env.local | cut -d= -f2)}"
TOKEN=$(grep '^TELEGRAM_BOT_TOKEN=' ~/salesapp2/.env.local | cut -d= -f2)
[ -f "$FILE" ] || { echo "no such file: $FILE"; exit 1; }
curl -s -F chat_id="$CHAT" -F document=@"$FILE" -F caption="$CAPTION" \
  "https://api.telegram.org/bot$TOKEN/sendDocument" | python3 -c "import json,sys; d=json.load(sys.stdin); print('sent ok' if d.get('ok') else d)"
