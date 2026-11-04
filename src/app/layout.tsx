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
        {/* AI assistants (Clarence/Arnold/Chris — slug clara stays) — docked first, then the 💡 */}
        <script
          src="https://blpagents.netlify.app/assistant.js"
          defer
          data-app="Sales App"
          data-user-key="blp_rep_name"
          data-agents="clara,arnold,chris"
          data-agents-by-user="brigham:clara,arnold,chris|brighamlarson:clara,arnold,chris|karmel:lindsay,melody,carla|melissa:melody,chris,carla|susie:lindsay,chris,melody|alisa:marcus"
          data-dock="#blp-dock"
        />
        {/* BLP 💡 lightbulb (Brigham 10/30): the Sales App's OWN lightbulb — requests
            file to /api/requests and are managed on Dashboard → 💡 App Requests,
            not the Store Map's shared Requests list. */}
        <script
          src="/lightbulb.js"
          defer
          data-app="Sales App"
          data-api="/api/requests"
          data-manage="/?tab=requests"
          data-session="/api/lightbulb"
          data-who-key="blp_rep_name"
          data-dock="#blp-dock"
        />
      </body>
    </html>
  );
}
