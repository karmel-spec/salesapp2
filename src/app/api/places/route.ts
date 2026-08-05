import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { requireSession, jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Google address autocomplete, proxied server-side so the Maps key never
 * reaches the browser. Body: { input } → { suggestions: string[] }.
 * Needs "Places API (New)" enabled on the Google Cloud project.
 */
export async function POST(req: NextRequest) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    if (!config.googleMapsApiKey) return NextResponse.json({ suggestions: [] });
    const { input } = (await req.json()) as { input?: string };
    const q = (input || "").trim();
    if (q.length < 4) return NextResponse.json({ suggestions: [] });

    const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": config.googleMapsApiKey },
      body: JSON.stringify({ input: q, includedRegionCodes: ["US"] }),
    });
    if (!res.ok) {
      // Most likely "Places API (New)" not enabled yet — fail soft, the
      // address field just behaves like a plain input.
      return NextResponse.json({ suggestions: [], note: `places api ${res.status}` });
    }
    const data = (await res.json()) as {
      suggestions?: { placePrediction?: { text?: { text?: string } } }[];
    };
    const suggestions = (data.suggestions || [])
      .map((s) => s.placePrediction?.text?.text || "")
      .filter(Boolean)
      .slice(0, 6);
    return NextResponse.json({ suggestions });
  } catch (err) {
    return jsonError(err);
  }
}
