import { NextRequest, NextResponse } from "next/server";
import { requireSession, jsonError } from "@/lib/api";
import { getPianos } from "@/lib/pianolog";

export const dynamic = "force-dynamic";

/** Compact Piano Log list for the WON wizard's piano picker (sellable + for-sale first, everything unsold after). */
export async function GET(req: NextRequest) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const pianos = await getPianos(req.nextUrl.searchParams.get("fresh") === "1");
    const list = pianos.filter((p) => !p.sold && (p.serial || p.make)).map((p) => ({
      serial: p.serial, row: p.row, year: p.year, make: p.make, model: p.model, size: p.size, category: p.category, price: p.price, location: p.location, section: p.section, sellable: p.sellable, forSale: p.forSale,
      label: [p.year, p.make, p.model, p.size].filter(Boolean).join(" ") || p.summary || `#${p.serial}`,
    }));
    list.sort((a, b) => Number(b.forSale) - Number(a.forSale) || Number(b.sellable) - Number(a.sellable) || a.label.localeCompare(b.label));
    return NextResponse.json({ pianos: list });
  } catch (err) {
    return jsonError(err);
  }
}
