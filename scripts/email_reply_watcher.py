#!/usr/bin/env python3
"""info@ reply watcher — closes the inbound-email gap.

Polls the info@brighamlarsonpianos.com inbox over IMAP (Gmail app password,
same credential the console sends with) and POSTs each new message to the
Sales Console's /api/email/inbound. The server decides whether the sender is
a lead; if so the reply lands on the lead's timeline, pings the team on
Telegram, and wakes Arnold to rewrite his drafts. Non-lead mail is ignored.

Installed as LaunchAgent com.blp.email-watcher (every 5 minutes).
State (last-seen IMAP UID, All Mail namespace) lives in
~/.blp-email-watcher-state.json.
"""
import email
import email.utils
import imaplib
import json
import pathlib
import re
import urllib.request
from email.header import decode_header, make_header

HOME = pathlib.Path.home()
STATE_FILE = HOME / ".blp-email-watcher-state.json"
ENV_FILE = HOME / "salesapp2" / ".env.local"
APP_URL = "https://blpsalesapp.netlify.app"
IMAP_HOST = "imap.gmail.com"
USER = "info@brighamlarsonpianos.com"
# On the very first run (no state), only look back this many days.
FIRST_RUN_LOOKBACK_DAYS = 3


def env(key: str) -> str:
    m = re.search(rf"^{key}=(.+)$", ENV_FILE.read_text(), re.M)
    if not m:
        raise SystemExit(f"{key} not found in {ENV_FILE}")
    return m.group(1).strip()


def plain_body(msg: email.message.Message) -> str:
    """Best-effort plain-text body (first text/plain part, else stripped html)."""
    parts = msg.walk() if msg.is_multipart() else [msg]
    html = ""
    for part in parts:
        ctype = part.get_content_type()
        if ctype not in ("text/plain", "text/html"):
            continue
        try:
            payload = part.get_payload(decode=True)
            text = payload.decode(part.get_content_charset() or "utf-8", "replace")
        except Exception:
            continue
        if ctype == "text/plain":
            return text.strip()
        html = html or text
    return re.sub(r"<[^>]+>", " ", html).strip()


def strip_quoted(text: str) -> str:
    """Drop quoted history so the timeline shows just the fresh reply."""
    lines = []
    for line in text.splitlines():
        if line.startswith(">") or re.match(r"^On .+ wrote:\s*$", line.strip()):
            break
        lines.append(line)
    out = "\n".join(lines).strip()
    return out or text.strip()


def main() -> None:
    password = env("SMTP_PASS")
    key = env("BLP_ARNOLD_ACCESS_KEY")
    state = json.loads(STATE_FILE.read_text()) if STATE_FILE.exists() else {}
    last_uid = int(state.get("last_uid", 0))

    imap = imaplib.IMAP4_SSL(IMAP_HOST)
    imap.login(USER, password)
    # All Mail, not INBOX: replies stay visible even after inbox triage
    # archives them (that's how Jarl's reply was missed).
    imap.select('"[Gmail]/All Mail"', readonly=True)

    if last_uid:
        typ, data = imap.uid("search", None, f"UID {last_uid + 1}:*")
    else:
        import datetime
        since = (datetime.date.today() - datetime.timedelta(days=FIRST_RUN_LOOKBACK_DAYS)).strftime("%d-%b-%Y")
        typ, data = imap.uid("search", None, f'(SINCE "{since}")')
    uids = [int(u) for u in (data[0].split() if typ == "OK" and data and data[0] else [])]
    # Gmail returns the last message again for "N:*" when nothing is new.
    uids = [u for u in uids if u > last_uid]
    if not uids:
        print("no new mail")
        imap.logout()
        return

    matched = 0
    for uid in sorted(uids):
        typ, msg_data = imap.uid("fetch", str(uid), "(RFC822)")
        if typ != "OK" or not msg_data or msg_data[0] is None:
            continue
        msg = email.message_from_bytes(msg_data[0][1])
        from_name, from_email = email.utils.parseaddr(msg.get("From", ""))
        if not from_email or from_email.lower() == USER:
            last_uid = uid
            continue
        subject = str(make_header(decode_header(msg.get("Subject", "")))) if msg.get("Subject") else ""
        body = strip_quoted(plain_body(msg))[:2000]
        received = email.utils.parsedate_to_datetime(msg.get("Date")) if msg.get("Date") else None

        # SalesCaptain text/webchat notification (no-reply@salescaptain.com):
        # "<Name> sent a message to Brigham Larson Pianos at <date>, <time> and
        # is currently waiting for a reply." Parse the sender + any message text
        # and route to the SalesCaptain handler instead of the email handler.
        if "salescaptain.com" in from_email.lower():
            full = f"{subject}\n{body}"
            sender, text = "", ""
            # Format A (teaser): "<Name> sent a message to Brigham Larson
            #   Pianos at <date>, <time> and is currently waiting for a reply."
            # Format B (with content): "New message from <Name> <message text>"
            # Name and message are separated by a newline or 2+ spaces in the
            # real emails; only split on that (never guess a word boundary).
            mb = re.search(r"New message from\s+(.+?)(?:\n|\s{2,})(.+)", full, re.S)
            if mb:
                sender = mb.group(1).strip()
                text = mb.group(2).strip()
            else:
                ma = re.search(r"^\s*(.+?)\s+sent a message to\b", full, re.M)
                sender = (ma.group(1).strip() if ma else "").strip()
                tm = re.search(r"waiting for a reply[.:]?\s*(.+)", body, re.S)
                text = (tm.group(1).strip() if tm else "")
            # Strip boilerplate/punctuation-only remnants; keep real messages.
            text = re.sub(r"^[\s.:>-]+", "", text)[:1000]
            if len(re.sub(r"\W", "", text)) < 3:
                text = ""
            phone = ""
            pm = re.search(r"\+?1?\D?(\d{3})\D?(\d{3})\D?(\d{4})", sender)
            if pm:
                phone = pm.group(1) + pm.group(2) + pm.group(3)
                sender = ""  # the "name" was actually a raw number
            payload = json.dumps({
                "senderName": sender,
                "senderPhone": phone,
                "messageText": text,
                "at": received.isoformat() if received else None,
            }).encode()
            req = urllib.request.Request(
                f"{APP_URL}/api/salescaptain/inbound",
                data=payload,
                headers={"Content-Type": "application/json", "x-blp-key": key},
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=30) as res:
                    result = json.load(res)
                tag = "MATCHED " + result.get("leadName", "") if result.get("matched") else "no lead match"
                print(f"uid {uid}: [SalesCaptain] {tag} ({sender or phone})")
                last_uid = uid
            except Exception as e:
                print(f"uid {uid}: SalesCaptain POST failed ({e}) — will retry")
                break
            continue

        payload = json.dumps({
            "fromEmail": from_email,
            "fromName": from_name,
            "subject": subject,
            "body": body,
            "receivedAt": received.isoformat() if received else None,
        }).encode()
        req = urllib.request.Request(
            f"{APP_URL}/api/email/inbound",
            data=payload,
            headers={"Content-Type": "application/json", "x-blp-key": key},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                result = json.load(res)
            if result.get("matched"):
                matched += 1
                print(f"uid {uid}: MATCHED lead {result.get('leadName')} ({from_email})")
            else:
                print(f"uid {uid}: no lead match ({from_email})")
            last_uid = uid  # advance only after the console accepted the message
        except Exception as e:
            print(f"uid {uid}: console POST failed ({e}) — will retry next run")
            break

    STATE_FILE.write_text(json.dumps({"last_uid": last_uid}))
    imap.logout()
    print(f"done — {matched} lead repl{'y' if matched == 1 else 'ies'} captured, last_uid={last_uid}")


if __name__ == "__main__":
    main()
