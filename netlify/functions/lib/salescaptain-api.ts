/**
 * SalesCaptain REST client (read side). Bearer key from Karmel's Owner login;
 * company UUID from /v1/fetch-companies. Cloudflare wants a browser-like UA.
 */
const BASE = "https://api.salescaptain.com/v1";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36";

export const scConfigured = () => !!(process.env.SALESCAPTAIN_API_KEY && process.env.SALESCAPTAIN_COMPANY_ID);
export const scCompany = () => process.env.SALESCAPTAIN_COMPANY_ID || "";

let lastCall = 0;
const PACE_MS = 350; // stay under SalesCaptain's rate limit
async function scGet<T>(path: string): Promise<T> {
  const key = process.env.SALESCAPTAIN_API_KEY || "";
  if (!key) throw new Error("SALESCAPTAIN_API_KEY not set");
  for (let attempt = 0; attempt < 7; attempt++) {
    const wait = lastCall + PACE_MS - Date.now();
    if (wait > 0) await new Promise((res) => setTimeout(res, wait));
    lastCall = Date.now();
    const r = await fetch(BASE + path, { headers: { Accept: "application/json", Authorization: `Bearer ${key}`, "User-Agent": UA } });
    if (r.status === 429 || r.status >= 500) {
      const ra = Number(r.headers.get("retry-after") || 0) * 1000;
      await new Promise((res) => setTimeout(res, ra || Math.min(30_000, 2000 * 2 ** attempt)));
      continue;
    }
    const j = (await r.json().catch(() => null)) as (T & { status?: string; error?: string; message?: string }) | null;
    if (!r.ok || !j || j.status === "failure") throw new Error(`SalesCaptain ${r.status} ${path.split("?")[0]}: ${j?.error || j?.message || ""}`);
    return j;
  }
  throw new Error(`SalesCaptain gave up after retries: ${path.split("?")[0]}`);
}

export interface ScConversation {
  contact_id: string; contact_name: string | null; contact_number: string | null; contact_email: string | null;
  conversation_id: string; conversation_profile_id: string; conversation_profile_number: string | null;
  last_message: string | null; assigned_to: string | null; updated_at: string | null; created_at: string; awaiting_reply?: boolean;
}
export interface ScMessage {
  conversation_id: string; message_id: string; message: string | null; contact_id: string;
  conversation_profile_number: string | null; call_status: string | null; call_duration: number | string | null;
  type_of_message: "sms_message" | "email_message" | "ig_message" | "fb_message" | "web_chat_message" | "call" | string;
  direction: "inbound" | "outbound"; assigned_account_id: string | null; created_at: string; media?: string[] | null; recording_url?: string | null;
}
export interface ScAccount { account_id: string; first_name: string; last_name: string; email: string; access_level: string }

interface Page<T> { data: T[]; pagination: { page_number: number; items_per_page: number; total_count: number; total_pages: number } }

export async function scAccounts(): Promise<Map<string, ScAccount>> {
  const j = await scGet<{ accounts: ScAccount[] }>(`/fetch-all-accounts/${scCompany()}`);
  return new Map((j.accounts || []).map((a) => [a.account_id, a]));
}

async function convPage(n: number): Promise<Page<ScConversation>> {
  const j = await scGet<{ conversations: Page<ScConversation> }>(`/list-conversations/${scCompany()}?items_per_page=100&sort_by=last_update&sort_dir=asc&page_number=${n}`);
  return j.conversations;
}

/**
 * Conversations updated at/after `sinceMs`, newest last. The API can only
 * sort by last_update, and ascending puts the ~40k never-updated rows LAST
 * (descending puts them first), so: binary-search the page where updated_at
 * turns null, then walk backwards while rows are still inside the window.
 */
export async function scConversationsSince(sinceMs: number, cap = 400, hintPage?: number): Promise<{ list: ScConversation[]; calls: number; boundaryPage: number }> {
  let calls = 0;
  const cache = new Map<number, Page<ScConversation>>();
  const page = async (n: number) => { let p = cache.get(n); if (!p) { p = await convPage(n); calls++; cache.set(n, p); } return p; };
  const startsNonNull = async (n: number) => { const p = await page(n); return p.data.length > 0 && !!p.data[0].updated_at; };
  const nonNull = (p: Page<ScConversation>) => p.data.filter((c) => c.updated_at);
  let lo = 0;
  // The boundary only creeps forward slowly (a never-updated conversation
  // getting its first update), so last run's page is almost always right.
  if (hintPage && hintPage > 0) {
    for (const n of [hintPage, hintPage + 1, hintPage - 1]) {
      if (n < 1) continue;
      if ((await startsNonNull(n)) && !(await startsNonNull(n + 1))) { lo = n; break; }
    }
  }
  if (!lo) {
    const first = await page(1);
    let a = 1, b = Math.max(1, first.pagination.total_pages);
    while (a < b) { const mid = Math.ceil((a + b) / 2); if (await startsNonNull(mid)) a = mid; else b = mid - 1; }
    lo = a;
  }
  const out: ScConversation[] = [];
  for (let n = lo; n >= 1 && out.length < cap; n--) {
    const p = await page(n);
    const rows = nonNull(p);
    const inWindow = rows.filter((c) => Date.parse(c.updated_at!) >= sinceMs);
    out.unshift(...inWindow);
    if (inWindow.length < rows.length || rows.length === 0) break; // crossed the window's start
  }
  return { list: out.slice(-cap), calls, boundaryPage: lo };
}

/** Messages in one conversation created after `afterMs`, oldest first. */
export async function scMessagesSince(conversationId: string, afterMs: number): Promise<ScMessage[]> {
  const all: ScMessage[] = [];
  const after = new Date(afterMs).toISOString();
  for (let n = 1; n <= 20; n++) {
    const j = await scGet<{ messages: Page<ScMessage> }>(`/fetch-messages/${scCompany()}/${conversationId}?items_per_page=100&sort_by=created_at&sort_dir=desc&created_after=${encodeURIComponent(after)}&page_number=${n}`);
    all.push(...(j.messages?.data || []));
    if (n >= (j.messages?.pagination?.total_pages || 1)) break;
  }
  return all.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Contacts whose name/phone/email match the search key. */
export async function scSearchContacts(searchKey: string): Promise<{ contact_id: string; name: string; phone: string | null; email: string | null }[]> {
  const j = await scGet<{ contacts: Page<{ contact_id: string; name: string; phone: string | null; email: string | null }> }>(`/list-contacts/${scCompany()}?items_per_page=20&page_number=1&search_key=${encodeURIComponent(searchKey)}`);
  return j.contacts?.data || [];
}
