import type { Metadata } from "next";
import "./globals.css";
import { Shell } from "@/components/Shell";

export const metadata: Metadata = {
  title: "BLP Sales — Brigham Larson Pianos",
  description: "Sales console for Brigham Larson Pianos — leads log, Arnold AI drafts, and outreach.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Shell>{children}</Shell>
        {/* Helper dock: a body-level element (not React-managed, so widgets
            can inject into it before hydration) that CSS pins to the sidebar
            footer on desktop and the top bar on phones. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "document.body.appendChild(Object.assign(document.createElement('div'),{id:'blp-dock',className:'helper-dock'}));",
          }}
        />
        {/* AI assistants (Clara/Arnold/Chris) — docked first, then the 💡 */}
        <script src="https://blpagents.netlify.app/assistant.js" defer data-app="Sales App" data-user-key="blp_rep_name" data-agents="clara,arnold,chris" data-dock="#blp-dock" />
        {/* Shared 💡 suggestion box (same widget every BLP app embeds). */}
        <script src="/suggest.js" defer data-app="Sales App" data-who-key="blp_rep_name" data-dock="#blp-dock" />
      </body>
    </html>
  );
}
