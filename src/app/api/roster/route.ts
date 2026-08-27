import { NextRequest, NextResponse } from "next/server";
import { listRoster, addPerson, removePerson } from "@/lib/roster";
import { requireSession, jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";

/** The "Who are you?" team list. GET → { people }. POST { name } adds,
 *  POST { remove } deletes (existing leads keep the departed rep's name). */
export async function GET(req: NextRequest) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    return NextResponse.json({ people: await listRoster() });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: NextRequest) {
  const guard = requireSession(req);
  if (guard) return guard;
  try {
    const input = (await req.json()) as { name?: string; remove?: string; who?: string };
    if (input.remove) {
      return NextResponse.json({ people: await removePerson(input.remove) });
    }
    if (input.name) {
      return NextResponse.json({ people: await addPerson(input.name, input.who || "app") });
    }
    return NextResponse.json({ error: "Pass { name } to add or { remove } to delete" }, { status: 400 });
  } catch (err) {
    return jsonError(err, 400);
  }
}
