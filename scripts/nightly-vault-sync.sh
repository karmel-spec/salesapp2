#!/bin/zsh
# Nightly: re-harvest agent info from the Obsidian Knowledge Vault and,
# only if it changed, commit + push the generated JSON (Netlify auto-deploys).
# Installed as LaunchAgent com.blp.vault-sync (2:00 AM daily).
set -e
cd "$HOME/salesapp2"

node scripts/harvest-vault.mjs

if git diff --quiet -- src/lib/agent-vault.json; then
  echo "$(date -u +%FT%TZ) vault unchanged — nothing to deploy"
  exit 0
fi

git add src/lib/agent-vault.json
git commit -m "Nightly vault sync: refresh agent info from Knowledge Vault

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push origin main
echo "$(date -u +%FT%TZ) vault changes pushed — Netlify deploying"
