// pf-ingest-email — turns Discovery Bank "Transaction update" e-mails into pending transactions.
//   POST { messages: [{ id, sent, text }] }
//     id   = the mail's internetMessageId (dedupe key)   sent = ISO timestamp   text = body or preview text
//   Auth: header  x-ingest-token: <PF_INGEST_TOKEN>  (scheduled task, Power Automate, Apps Script …)  or a household member's JWT.
// Whatever feeds it, the parsing lives here, so a new feeder never needs new parsing code.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ingest-token" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const money = (s: string) => parseFloat(s.replace(/[ ,]/g, ""));

export interface Parsed { ref: string; date: string; time: string | null; description: string; amount: number; balance: number | null; kind: string }

/** Examples (one line each, as Outlook's preview gives them):
 *  Card payment Astron Jukskei Park Rand – R 51.00 From Single Facility Card ending ***5302 Monday, 21 September at 08:02 Available balance: R 3,024.40 …
 *  Debit order R 1,850.94 From Single Facility Reference: DISCLIFE 5130634382-346922274 Friday, 4 September at 22:11 Available balance: R 5,394.83 …
 *  Debit order failed From Single Facility Insufficient funds Reference: …            (no money moved → ignored) */
export function parseMail(id: string, sent: string, raw: string): Parsed | { skip: string } {
  const text = raw.replace(/\s+/g, " ").trim();
  if (/\b(failed|declined|unsuccessful|reversed authorisation)\b/i.test(text.slice(0, 80))) return { skip: "no money moved" };
  const amt = text.match(/R\s?(\d[\d ,]*\.\d{2})/);
  if (!amt) return { skip: "no amount" };
  const head = text.slice(0, amt.index).replace(/[–—-]\s*$/, "").trim();          // "Card payment <merchant>" | "Debit order"
  const kind = (head.match(/^(card payment|card purchase|debit order|payment received|payment|transfer|cash withdrawal|atm withdrawal|deposit|refund|reversal|eft|fee)/i)?.[0] ?? head.split(" ").slice(0, 2).join(" ")).toLowerCase();
  const reference = text.match(/Reference:\s*(.+?)\s+(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,/i)?.[1];
  const description = (head.slice(kind.length).trim() || reference || head || "Discovery transaction").trim();

  // the mail says "Monday, 21 September at 08:02" (SAST, no year) — take the year from when it was sent
  const sentSast = new Date(new Date(sent).getTime() + 2 * 3600_000);
  let date = sentSast.toISOString().slice(0, 10), time: string | null = sentSast.toISOString().slice(11, 16);
  const when = text.match(/day,\s*(\d{1,2})\s+([A-Za-z]+)\s+at\s+(\d{1,2}):(\d{2})/);
  if (when) {
    const mon = MONTHS.indexOf(when[2].toLowerCase());
    if (mon >= 0) {
      let year = sentSast.getUTCFullYear();
      if (mon === 11 && sentSast.getUTCMonth() === 0) year--;                     // December purchase, mail sent in January
      date = `${year}-${String(mon + 1).padStart(2, "0")}-${when[1].padStart(2, "0")}`;
      time = `${when[3].padStart(2, "0")}:${when[4]}`;
    }
  }
  const credit = /received|deposit|refund|reversal|paid to you|credited/i.test(kind + " " + head);
  const bal = text.match(/Available balance:\s*R\s?(-?\d[\d ,]*\.\d{2})/i);
  return { ref: id, date, time, description, amount: (credit ? 1 : -1) * money(amt[1]), balance: bal ? money(bal[1]) : null, kind };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const token = Deno.env.get("PF_INGEST_TOKEN");
    let ok = !!token && req.headers.get("x-ingest-token") === token;
    if (!ok && req.headers.get("Authorization")) {
      const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization")! } } });
      ok = !!(await asUser.rpc("pf_is_member")).data;
    }
    if (!ok) return json({ error: "unauthorised" }, 401);

    const { messages, account = "Discovery", dry_run = false } = await req.json();
    if (!Array.isArray(messages)) return json({ error: "messages[] required" }, 400);
    const rows: Parsed[] = [], skipped: { id: string; why: string }[] = [];
    for (const m of messages) {
      if (!m?.id || !m?.text) { skipped.push({ id: String(m?.id), why: "id and text required" }); continue; }
      const p = parseMail(String(m.id), m.sent ?? new Date().toISOString(), String(m.text));
      if ("skip" in p) skipped.push({ id: m.id, why: p.skip }); else rows.push(p);
    }
    if (dry_run) return json({ rows, skipped });
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data, error } = await admin.rpc("pf_import_txns", { p_account: account, p_source: "email", p_rows: rows });
    if (error) return json({ error: error.message }, 500);
    return json({ ...data, parsed: rows.length, ignored: skipped });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
