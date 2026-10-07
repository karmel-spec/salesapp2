/**
 * QuickBooks Online — customer + draft invoice for a WON handoff.
 *
 * Setup (one time, Brigham/Karmel): create an app at developer.intuit.com,
 * add this site's /api/qbo/callback as a redirect URI, then set
 * QBO_CLIENT_ID, QBO_CLIENT_SECRET (and QBO_ENV=sandbox while testing).
 * A signed-in admin then opens /api/qbo/connect once; the refresh token is
 * kept in Netlify Blobs (store "qbo") and rotates itself. Nothing here ever
 * sends an invoice — admin opens the draft in QBO and sends it after review.
 */
import { getStore } from "@netlify/blobs";

const CLIENT_ID = process.env.QBO_CLIENT_ID || "";
const CLIENT_SECRET = process.env.QBO_CLIENT_SECRET || "";
const ENV = (process.env.QBO_ENV || "production").toLowerCase();
const ITEM_NAME = process.env.QBO_ITEM_NAME || "Services";
const API = ENV === "sandbox" ? "https://sandbox-quickbooks.api.intuit.com" : "https://quickbooks.api.intuit.com";
const APP = ENV === "sandbox" ? "https://app.sandbox.qbo.intuit.com" : "https://app.qbo.intuit.com";
const MINOR = "minorversion=73";

export const qboConfigured = () => Boolean(CLIENT_ID && CLIENT_SECRET);

interface Tokens { access_token: string; refresh_token: string; expires_at: number; refresh_expires_at: number; realmId: string }
let mem: Tokens | null = null;

function store() { try { return getStore({ name: "qbo", consistency: "strong" }); } catch { return null; } }
async function loadTokens(): Promise<Tokens | null> {
  if (mem) return mem;
  const s = store();
  if (s) { try { const t = (await s.get("tokens", { type: "json" })) as Tokens | null; if (t?.refresh_token) return (mem = t); } catch { /* fall through */ } }
  // Env fallback (local dev / before Blobs): a refresh token pasted from the Intuit playground.
  if (process.env.QBO_REFRESH_TOKEN && process.env.QBO_REALM_ID) return (mem = { access_token: "", refresh_token: process.env.QBO_REFRESH_TOKEN, expires_at: 0, refresh_expires_at: Date.now() + 90 * 864e5, realmId: process.env.QBO_REALM_ID });
  return null;
}
async function saveTokens(t: Tokens) { mem = t; const s = store(); if (s) { try { await s.setJSON("tokens", t); } catch (e) { console.warn("[qbo] token save failed", String(e).slice(0, 80)); } } }

export async function qboConnected(): Promise<{ connected: boolean; realmId?: string; env: string }> {
  const t = await loadTokens();
  return { connected: Boolean(t?.refresh_token && t.refresh_expires_at > Date.now()), realmId: t?.realmId, env: ENV };
}

export function connectUrl(redirectUri: string, state: string): string {
  const u = new URL("https://appcenter.intuit.com/connect/oauth2");
  u.searchParams.set("client_id", CLIENT_ID);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "com.intuit.quickbooks.accounting");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  return u.toString();
}

async function tokenCall(params: Record<string, string>): Promise<Omit<Tokens, "realmId" | "expires_at" | "refresh_expires_at"> & { expires_in: number; x_refresh_token_expires_in: number }> {
  const r = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`QBO token ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

export async function handleCallback(code: string, realmId: string, redirectUri: string): Promise<void> {
  const j = await tokenCall({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
  await saveTokens({ access_token: j.access_token, refresh_token: j.refresh_token, realmId, expires_at: Date.now() + (j.expires_in - 60) * 1000, refresh_expires_at: Date.now() + j.x_refresh_token_expires_in * 1000 });
}

async function accessToken(): Promise<Tokens> {
  const t = await loadTokens();
  if (!t) throw new Error("QuickBooks not connected — open /api/qbo/connect once");
  if (t.access_token && t.expires_at > Date.now()) return t;
  const j = await tokenCall({ grant_type: "refresh_token", refresh_token: t.refresh_token });
  const n: Tokens = { ...t, access_token: j.access_token, refresh_token: j.refresh_token || t.refresh_token, expires_at: Date.now() + (j.expires_in - 60) * 1000, refresh_expires_at: Date.now() + (j.x_refresh_token_expires_in || 100 * 86400) * 1000 };
  await saveTokens(n);
  return n;
}

async function q<T>(path: string, init: RequestInit = {}): Promise<T> {
  const t = await accessToken();
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${API}/v3/company/${t.realmId}/${path}${sep}${MINOR}`, {
    ...init,
    headers: { authorization: `Bearer ${t.access_token}`, accept: "application/json", "content-type": "application/json", ...(init.headers || {}) },
    signal: AbortSignal.timeout(20000),
  });
  const j = (await r.json().catch(() => ({}))) as T & { Fault?: { Error?: { Message?: string; Detail?: string; code?: string }[] } };
  if (!r.ok) { const e = j.Fault?.Error?.[0]; throw new Error(`QBO ${r.status}: ${e?.Message || ""} ${e?.Detail || ""}`.trim()); }
  return j;
}
const esc = (s: string) => s.replace(/'/g, "\\'");

export interface QboCustomer { Id: string; DisplayName: string }

export async function findOrCreateCustomer(c: { name: string; email?: string; phone?: string; address?: string }): Promise<QboCustomer> {
  const name = c.name.replace(/[:]/g, " ").trim().slice(0, 100);
  if (c.email) {
    const r = await q<{ QueryResponse: { Customer?: QboCustomer[] } }>(`query?query=${encodeURIComponent(`select Id, DisplayName from Customer where PrimaryEmailAddr = '${esc(c.email)}' maxresults 1`)}`);
    if (r.QueryResponse.Customer?.[0]) return r.QueryResponse.Customer[0];
  }
  const byName = await q<{ QueryResponse: { Customer?: QboCustomer[] } }>(`query?query=${encodeURIComponent(`select Id, DisplayName from Customer where DisplayName = '${esc(name)}' maxresults 1`)}`);
  if (byName.QueryResponse.Customer?.[0]) return byName.QueryResponse.Customer[0];
  const [first, ...rest] = name.split(/\s+/);
  const body: Record<string, unknown> = { DisplayName: name, GivenName: first, FamilyName: rest.join(" ") || undefined };
  if (c.email) body.PrimaryEmailAddr = { Address: c.email };
  if (c.phone) body.PrimaryPhone = { FreeFormNumber: c.phone };
  if (c.address) body.BillAddr = { Line1: c.address.slice(0, 500) };
  const r = await q<{ Customer: QboCustomer }>("customer", { method: "POST", body: JSON.stringify(body) });
  return r.Customer;
}

let itemCache: { id: string; at: number } | null = null;
async function serviceItemId(): Promise<string> {
  if (itemCache && Date.now() - itemCache.at < 3600_000) return itemCache.id;
  const r = await q<{ QueryResponse: { Item?: { Id: string; Name: string; Type: string }[] } }>(`query?query=${encodeURIComponent(`select Id, Name, Type from Item where Name = '${esc(ITEM_NAME)}' maxresults 1`)}`);
  let id = r.QueryResponse.Item?.[0]?.Id;
  if (!id) {
    const any = await q<{ QueryResponse: { Item?: { Id: string; Name: string; Type: string }[] } }>(`query?query=${encodeURIComponent("select Id, Name, Type from Item where Active = true maxresults 20")}`);
    id = (any.QueryResponse.Item || []).find((i) => i.Type === "Service")?.Id || any.QueryResponse.Item?.[0]?.Id;
  }
  if (!id) throw new Error(`QBO: no product/service item found (set QBO_ITEM_NAME)`);
  itemCache = { id, at: Date.now() };
  return id;
}

export interface QboInvoice { Id: string; DocNumber?: string; url: string }

/** A draft invoice: created in QBO, never emailed from here. */
export async function createInvoice(a: { customerId: string; email?: string; lines: { description: string; amount: number }[]; memo?: string; privateNote?: string }): Promise<QboInvoice> {
  const item = await serviceItemId();
  const body: Record<string, unknown> = {
    CustomerRef: { value: a.customerId },
    Line: a.lines.map((l) => ({ DetailType: "SalesItemLineDetail", Amount: Math.round(l.amount * 100) / 100, Description: l.description.slice(0, 4000), SalesItemLineDetail: { ItemRef: { value: item }, Qty: 1, UnitPrice: Math.round(l.amount * 100) / 100 } })),
    ...(a.memo ? { CustomerMemo: { value: a.memo.slice(0, 1000) } } : {}),
    ...(a.privateNote ? { PrivateNote: a.privateNote.slice(0, 4000) } : {}),
    ...(a.email ? { BillEmail: { Address: a.email } } : {}),
  };
  const r = await q<{ Invoice: { Id: string; DocNumber?: string } }>("invoice", { method: "POST", body: JSON.stringify(body) });
  return { Id: r.Invoice.Id, DocNumber: r.Invoice.DocNumber, url: `${APP}/app/invoice?txnId=${r.Invoice.Id}` };
}
