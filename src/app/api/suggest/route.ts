import { NextRequest, NextResponse } from "next/server";
import { addSuggestion, listSuggestions, setSuggestionStatus } from "@/lib/suggestions";
import { saveLeadPhoto } from "@/lib/media";
import { notifyTelegram } from "@/lib/arnold";
import { jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cross-app 💡 suggestion box. Public-but-CORS-gated (every BLP app embeds
 * suggest.js): POST {app, who, type, text, context?, screenshotBase64?}
 * creates; POST {id, status:"Tested"} is the requester's confirmation;
 * GET ?who= lists that person's requests (newest first).
 */

const ORIGIN_OK =
  /^https:\/\/(www\.)?(brighamlarsonpianos\.(com|org|tech)|pianotechnologylibrary\.com|(blpsalesapp|blpshop|blpcrm|blpstoremap|blpmap|pianologapp|blpagents|blppricetags|blppricetag|pricetags-blp)\.netlify\.app)$/;
const ORIGIN_DEV = /^http:\/\/localhost(:\d+)?$/;

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const allowed = ORIGIN_OK.test(origin) || ORIGIN_DEV.test(origin) ? origin : "https://blpsalesapp.netlify.app";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function GET(req: NextRequest) {
  const headers = corsHeaders(req);
  try {
    const who = (req.nextUrl.searchParams.get("who") || "").trim().toLowerCase();
    const all = await listSuggestions();
    const mine = (who ? all.filter((s) => s.who.toLowerCase() === who) : all)
      .slice(-25)
      .reverse()
      .map(({ screenshot: _s, ...rest }) => rest); // urls stay internal
    return NextResponse.json({ requests: mine }, { headers });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: NextRequest) {
  const headers = corsHeaders(req);
  try {
    const input = (await req.json()) as {
      id?: string;
      status?: string;
      app?: string;
      who?: string;
      type?: string;
      text?: string;
      context?: string;
      screenshotBase64?: string;
    };

    // Requester confirming their shipped request works.
    if (input.id && input.status === "Tested") {
      const ok = await setSuggestionStatus(input.id, "Tested");
      return NextResponse.json(ok ? { ok: true } : { error: "Request not found" }, { status: ok ? 200 : 404, headers });
    }

    const app = (input.app || "").trim();
    const who = (input.who || "").trim();
    const text = (input.text || "").trim();
    if (!app || !who || !text) {
      return NextResponse.json({ error: "app, who, and text are required" }, { status: 400, headers });
    }

    let screenshot = "";
    if (input.screenshotBase64) {
      const buf = Buffer.from(input.screenshotBase64, "base64");
      if (buf.length <= 3_500_000) {
        const stored = await saveLeadPhoto("suggestion", "image/jpeg", buf);
        screenshot = stored.url;
      }
    }

    const s = await addSuggestion({ app, who, type: input.type || "idea", text, context: input.context, screenshot });
    notifyTelegram(
      `💡 <b>${who} filed a ${s.type}</b> for the ${app}:\n"${text.slice(0, 400)}"` +
        `${s.context ? `\n📄 ${s.context}` : ""}${screenshot ? `\n📷 ${screenshot}` : ""}\n<i>${s.id} — on the fix list.</i>`
    ).catch(() => {});
    return NextResponse.json({ ok: true, id: s.id }, { headers });
  } catch (err) {
    const res = jsonError(err);
    return new NextResponse(res.body, { status: res.status, headers: { ...headers, "Content-Type": "application/json" } });
  }
}
