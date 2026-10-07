import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { qboConfigured, qboConnected } from "@/lib/qbo";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = requireSession(req);
  if (guard) return guard;
  const c = await qboConnected();
  return NextResponse.json({ configured: qboConfigured(), ...c });
}
