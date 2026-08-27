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
        {/* Shared 💡 suggestion box (same widget every BLP app embeds). */}
        <script src="/suggest.js" defer data-app="Sales App" data-who-key="blp_rep_name" />
      </body>
    </html>
  );
}
