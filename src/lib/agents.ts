/**
 * BLP Agent Registry — the single place each Hermes agent is described.
 * Adding an agent = adding an entry here (plus optional live widgets).
 * Karmel's agent registry spreadsheet can hydrate/replace this later.
 */

export interface AgentSchedule {
  time: string;
  days: string;
  what: string;
  where?: string;
}

export interface AgentLink {
  name: string;
  href: string;
  note?: string;
}

export interface AgentConfig {
  slug: string;
  name: string;
  role: string;
  tagline: string; // one-line "quick read"
  reportsTo: string;
  accent: string; // avatar/badge color
  avatar?: string; // /agents/<slug>.jpg in /public once avatar folder lands
  telegram?: string; // t.me handle URL
  healthUrl?: string; // public tunnel health endpoint
  status: "live" | "coming-soon";
  schedule: AgentSchedule[];
  boundaries: { can: string; never: string; voice?: string };
  links: AgentLink[];
  onMacFiles: [string, string][];
  /** Which live-data widget set the console renders (see AGENT_WIDGETS). */
  widgets?: "arnold";
}

export const AGENTS: AgentConfig[] = [
  {
    slug: "arnold",
    name: "Arnold",
    role: "Chief Sales Agent",
    tagline:
      "Lead follow-up, pipeline oversight, and daily pre-drafting — always as a ghostwriter in Brigham's voice, never sending without a human's approval.",
    reportsTo: "Brigham & Karmel",
    accent: "var(--crimson)",
    telegram: "https://t.me/arnoldlarsonbot",
    healthUrl: "https://arnold.brighamlarsonpianos.com/health",
    status: "live",
    widgets: "arnold",
    schedule: [
      { time: "8:00 AM", days: "Mon–Sat", what: "Morning sales briefing", where: "BLP Sales Team group" },
      {
        time: "10:00 AM · 2:00 PM · 5:00 PM",
        days: "Mon–Sat",
        what: "Pre-drafting pass (top 8 leads: replies first, then hottest)",
        where: "Drafts → Approvals",
      },
      {
        time: "continuous",
        days: "",
        what: "30-day stale sweep hands quiet leads to Arnold; customer text replies ping the group",
      },
    ],
    boundaries: {
      can: "Read the pipeline, draft texts & emails (as Brigham), brief the team, take assigned tasks",
      never:
        "Send anything without human approval · identify himself to customers · edit or delete leads · touch pricing/discounts",
      voice: "Ghostwriter — every customer message speaks and signs as Brigham",
    },
    links: [
      { name: "Chat with Arnold (Telegram)", href: "https://t.me/arnoldlarsonbot", note: "ask him anything, assign work conversationally" },
      { name: "Brain health check", href: "https://arnold.brighamlarsonpianos.com/health", note: "should say status: ok — if not, his Mac is asleep" },
      { name: "His approval queue", href: "/approvals", note: "every draft he writes waits here for a human" },
      { name: "His lead queue", href: "/leads?stale=1", note: "stale leads currently assigned to him" },
    ],
    onMacFiles: [
      ["Identity & soul", "~/Documents/BLP Knowledge Vault/agents/arnold/ (IDENTITY.md, SOUL.md, MEMORY.md)"],
      ["Knowledge base", "~/Documents/BLP Knowledge Vault/agents/arnold/kb/ (Brigham voice corpus, sales strategy rules)"],
      ["Sales Console contract", "~/Documents/BLP Knowledge Vault/agents/arnold/sales-console-api.md"],
      ["Drafting skill", "~/.hermes/profiles/arnold/skills/business-operations/blp-arnold-sales/"],
    ],
  },
  {
    slug: "ivory",
    name: "Ivory",
    role: "Tuning & Care Agent",
    tagline:
      "Tuning calendar upkeep, reactivation campaigns, and service reminders — bringing past customers back to the bench.",
    reportsTo: "Karmel",
    accent: "#33526e",
    status: "coming-soon",
    schedule: [],
    boundaries: {
      can: "To be defined when Ivory is wired in",
      never: "Send anything without human approval (house rule for every agent)",
    },
    links: [],
    onMacFiles: [],
  },
];

export function getAgent(slug: string): AgentConfig | undefined {
  return AGENTS.find((a) => a.slug === slug);
}
