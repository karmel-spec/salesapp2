import { cookies } from "next/headers";
import Link from "next/link";
import { config } from "@/lib/config";
import { botToken, botDisplayName, parseGoogleSession } from "@/lib/auth";
import BotLinks from "./links";

export const dynamic = "force-dynamic";

/**
 * Bot access (Brigham 10/29): one sign-in link + API key per Grok Bot on the
 * admin team. Owners only (Brigham / Karmel via Google sign-in) — the tokens
 * are credentials, so a shared-passcode session can't see them.
 */
export default async function BotsPage() {
  const jar = await cookies();
  const who = parseGoogleSession(jar.get("blp_session")?.value);
  const owner = who && !who.bot && ["brigham", "karmel"].includes((who.name || "").toLowerCase());
  if (!owner) {
    return (
      <div className="card" style={{ maxWidth: 640, margin: "40px auto" }}>
        <h2>Bot access</h2>
        <p>This page shows the bots&apos; sign-in links, which are credentials. Sign in with Google as Brigham or Karmel to see them.</p>
        <Link className="btn" href="/api/auth/google">Sign in with Google</Link>
      </div>
    );
  }
  if (!config.botSecret) {
    return (
      <div className="card" style={{ maxWidth: 640, margin: "40px auto" }}>
        <h2>Bot access</h2>
        <p>Bot sign-in isn&apos;t switched on yet: set <code>BLP_BOT_SECRET</code> in Netlify and redeploy.</p>
      </div>
    );
  }
  const bots = config.bots.map((slug) => ({ slug, name: botDisplayName(slug), token: botToken(slug), link: `${config.publicBaseUrl}/api/auth/bot?token=${encodeURIComponent(botToken(slug))}` }));
  return <BotLinks bots={bots} base={config.publicBaseUrl} />;
}
