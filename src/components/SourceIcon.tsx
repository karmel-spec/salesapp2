import { SOURCE_META } from "@/lib/source";

/**
 * Inbox source indicator. Facebook/Instagram get their real brand logos
 * (inline SVG); every other channel uses its color emoji from SOURCE_META.
 */
export function SourceIcon({ source, size = 17 }: { source: string; size?: number }) {
  if (source === "facebook") {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} aria-label="Facebook Messenger" style={{ verticalAlign: "-3px" }}>
        <circle cx="12" cy="12" r="12" fill="#1877F2" />
        <path
          d="M16.67 15.47l.53-3.47h-3.33V9.75c0-.95.47-1.88 1.96-1.88h1.52V4.92s-1.38-.24-2.7-.24c-2.75 0-4.55 1.67-4.55 4.7v2.62H7.05v3.47h3.05v8.39c.61.1 1.24.14 1.9.14.65 0 1.28-.05 1.9-.14v-8.39h2.77z"
          fill="#fff"
        />
      </svg>
    );
  }
  if (source === "instagram") {
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} aria-label="Instagram" style={{ verticalAlign: "-3px" }}>
        <defs>
          <linearGradient id="ig-grad" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#FFDD55" />
            <stop offset="0.5" stopColor="#FF543E" />
            <stop offset="1" stopColor="#C837AB" />
          </linearGradient>
        </defs>
        <rect width="24" height="24" rx="6" fill="url(#ig-grad)" />
        <circle cx="12" cy="12" r="4.6" fill="none" stroke="#fff" strokeWidth="1.9" />
        <circle cx="17.3" cy="6.7" r="1.35" fill="#fff" />
      </svg>
    );
  }
  if (source === "tiktok") {
    const note =
      "M12.53.02C13.84 0 15.14.01 16.44 0c.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z";
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} aria-label="TikTok" style={{ verticalAlign: "-3px" }}>
        <rect width="24" height="24" rx="6" fill="#000" />
        <g transform="translate(4.4 4.4) scale(0.62)">
          <path d={note} fill="#25F4EE" transform="translate(-1.1 -1.1)" />
          <path d={note} fill="#FE2C55" transform="translate(1.1 1.1)" />
          <path d={note} fill="#fff" />
        </g>
      </svg>
    );
  }
  const meta = SOURCE_META[source];
  return <>{meta ? meta.icon : "💬"}</>;
}
