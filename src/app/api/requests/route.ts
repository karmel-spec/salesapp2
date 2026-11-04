import { NextRequest, NextResponse } from "next/server";
import { addRequest, listRequests, setRequestStatus } from "@/lib/app-requests";
import { saveLeadPhoto } from "@/lib/media";
import { notifyTelegram } from "@/lib/arnold";
import { parseGoogleSession, SESSION_COOKIE } from "@/lib/auth";
import { requireSession, jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Sales App 💡 requests — the lightbulb's back end AND the Dashboard's
 * 💡 App Requests tab (Brigham 10/30). Session-gated like every other route:
 *   GET                     → { requests } newest first
 *   POST {type, text, who, context?, screenshotBase64?} → { ok, id, request }
 *   PATCH {id, status, who} → { ok, request, texted }
 * Flipping a request to Live texts the requester once (same as the Store Map).
 */

function sessionName(req: NextRequest): { name: string; email: string } {
  const g = parseGoogleSession(req.cookies.get(SESSION_COOKIE)?.value);
  return { name: g?.name || "", email: g?.email || "" };
}

export async function GET(req: NextRequest) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    return NextResponse.json({ requests: await listRequests() }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: NextRequest) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const input = (await req.json()) as {
      type?: string;
      text?: string;
      who?: string;
      context?: string;
      screenshotBase64?: string;
    };
    const sess = sessionName(req);
    const who = (input.who || sess.name || "").trim();
    const text = (input.text || "").trim();
    if (!who) return NextResponse.json({ error: "Add your name so we know who to thank." }, { status: 400 });
    if (!text) return NextResponse.json({ error: "Write a sentence first." }, { status: 400 });

    let screenshot = "";
    if (input.screenshotBase64) {
      const buf = Buffer.from(input.screenshotBase64, "base64");
      if (buf.length <= 3_500_000) {
        try {
          screenshot = (await saveLeadPhoto("request", "image/jpeg", buf)).url;
        } catch {
          /* the request still files without the picture */
        }
      }
    }

    const s = await addRequest({ who, email: sess.email, type: input.type || "edit", text, context: input.context, screenshot });
    notifyTelegram(
      `💡 <b>${who} filed a Sales App ${s.type}</b>:\n"${text.slice(0, 400)}"` +
        `${s.context ? `\n📄 ${s.context}` : ""}${screenshot ? `\n📷 ${screenshot}` : ""}\n<i>${s.id} — Dashboard → 💡 App Requests.</i>`
    ).catch(() => {});
    return NextResponse.json({ ok: true, id: s.id, request: s, screenshot: Boolean(screenshot) });
  } catch (err) {
    return jsonError(err);
  }
}

export async function PATCH(req: NextRequest) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const input = (await req.json()) as { id?: string; status?: string; who?: string };
    if (!input.id || !input.status) return NextResponse.json({ error: "id and status are required" }, { status: 400 });
    const by = (input.who || sessionName(req).name || "team").trim();
    const r = await setRequestStatus(input.id, input.status, by);
    if (!r) return NextResponse.json({ error: "Request not found" }, { status: 404 });

    // Live → text the requester once (phone looked up by name server-side,
    // the browser never sees numbers). Best-effort.
    let texted = false;
    if (r.wentLive && r.request.who && !/^claude test/i.test(r.request.who)) {
      const t = r.request.text;
      const msg =
        `✅ Your Sales App request ${r.request.id} is live — "${t.slice(0, 110)}${t.length > 110 ? "…" : ""}". ` +
        `Try it, then open the 💡 in the Sales App and tap "It works" (or send a new request if it isn't right yet).`;
      try {
        const res = await fetch("https://blpsalesapp.netlify.app/.netlify/functions/request-notify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key: process.env.BLP_APP_ACCESS_KEY || "pianoman", name: r.request.who, message: msg }),
          signal: AbortSignal.timeout(8000),
        });
        const j = (await res.json().catch(() => ({}))) as { sent?: boolean; ok?: boolean };
        texted = Boolean(j.sent ?? j.ok);
      } catch {
        /* best-effort */
      }
    }
    return NextResponse.json({ ok: true, request: r.request, texted });
  } catch (err) {
    return jsonError(err, /bad status/.test(String(err)) ? 400 : 500);
  }
}
