#!/bin/zsh
# Nightly Leads Log maintenance: Drive backup + section tidy.
# LaunchAgent com.blp.sheet-maintenance (2:15 AM).
KEY=$(grep '^BLP_ARNOLD_ACCESS_KEY=' ~/salesapp2/.env.local | cut -d= -f2)
APP=https://blpsalesapp.netlify.app
echo "=== $(date -u +%FT%TZ)"
echo "backup: $(curl -s -X POST $APP/api/backup -H "x-blp-key: $KEY" -H 'Content-Type: application/json' | head -c 200)"
echo "tidy:   $(curl -s -X POST $APP/api/sync -H "x-blp-key: $KEY" -H 'Content-Type: application/json' -d '{"action":"tidy"}' | head -c 200)"
