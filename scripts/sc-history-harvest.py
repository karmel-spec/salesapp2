#!/usr/bin/env python3
"""Stage 1 of the one-time SalesCaptain backfill.

Harvests every SalesCaptain notification email from info@ (All Mail), parses
each into {name, phone, text, date}, and writes /tmp/sc-history.json for the
Node matcher (stage 2) to reconcile against active leads.
Read-only on the mailbox.
"""
import email, email.utils, imaplib, json, re, pathlib
from email.header import decode_header, make_header

USER = "info@brighamlarsonpianos.com"
pw = re.search(r"^SMTP_PASS=(.+)$", pathlib.Path.home().joinpath("salesapp2/.env.local").read_text(), re.M).group(1).strip()


def plain_body(msg):
    parts = msg.walk() if msg.is_multipart() else [msg]
    html = ""
    for p in parts:
        ct = p.get_content_type()
        if ct not in ("text/plain", "text/html"):
            continue
        try:
            t = p.get_payload(decode=True).decode(p.get_content_charset() or "utf-8", "replace")
        except Exception:
            continue
        if ct == "text/plain":
            return t
        html = html or t
    return re.sub(r"<[^>]+>", " ", html)


def parse(subject, body):
    full = f"{subject}\n{body}"
    sender, text = "", ""
    mb = re.search(r"New message from\s+(.+?)(?:\n|\s{2,})(.+)", full, re.S)
    if mb:
        sender, text = mb.group(1).strip(), mb.group(2).strip()
    else:
        ma = re.search(r"^\s*(.+?)\s+sent a message to\b", full, re.M)
        sender = (ma.group(1).strip() if ma else "").strip()
        tm = re.search(r"waiting for a reply[.:]?\s*(.+)", body, re.S)
        text = (tm.group(1).strip() if tm else "")
    text = re.sub(r"^[\s.:>-]+", "", text)
    text = re.sub(r"\s+", " ", text)[:800]
    if len(re.sub(r"\W", "", text)) < 3:
        text = ""
    phone = ""
    pm = re.search(r"\+?1?\D?(\d{3})\D?(\d{3})\D?(\d{4})", sender)
    if pm:
        phone = pm.group(1) + pm.group(2) + pm.group(3)
        sender = ""
    return sender, phone, text


imap = imaplib.IMAP4_SSL("imap.gmail.com")
imap.login(USER, pw)
imap.select('"[Gmail]/All Mail"', readonly=True)
typ, data = imap.uid("search", None, "FROM", "no-reply@salescaptain.com")
uids = data[0].split() if data and data[0] else []
print(f"parsing {len(uids)} SalesCaptain emails...")

records = []
for i, uid in enumerate(uids):
    typ, md = imap.uid("fetch", uid, "(RFC822)")
    if typ != "OK" or not md or md[0] is None:
        continue
    msg = email.message_from_bytes(md[0][1])
    subject = str(make_header(decode_header(msg.get("Subject", "")))) if msg.get("Subject") else ""
    d = email.utils.parsedate_to_datetime(msg.get("Date")) if msg.get("Date") else None
    name, phone, text = parse(subject, plain_body(msg))
    if not name and not phone:
        continue
    records.append({
        "name": name, "phone": phone, "text": text,
        "date": d.isoformat() if d else None,
    })
    if (i + 1) % 200 == 0:
        print(f"  ...{i + 1}")

imap.logout()
pathlib.Path("/tmp/sc-history.json").write_text(json.dumps(records))
withtext = sum(1 for r in records if r["text"])
print(f"done — {len(records)} parsed ({withtext} with message text) → /tmp/sc-history.json")
