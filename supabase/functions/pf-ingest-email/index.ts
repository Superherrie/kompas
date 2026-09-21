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

const MON3 = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** FNB inContact. One mail can carry several "•" bullets (the overnight "Payments for 17 Sep" digest):
 *   FNB:-) R5000.00 paid from Fusion Private a/c..341485 @ Smartapp. Avail R87244. Ref.Disc Bank. 19Sep 12:35
 *   FNB:-) R250.00 t/fer from Fusion Private a/c..341485 to Notice a/c..218933 @ Scheduled Pymt. Avail R94044. 17Sep 04:07
 *   FNB:-) R196.62 paid from Fusion Private a/c..341485 @ Eft. Avail R94294. Ref.Afriforum _311425212. 17Sep 00:00
 *  Notices that move no money ("You have WON…", OTPs, logins) are ignored.
 *  Descriptions are worded the way the FNB statement words them, so the learned category rules apply. */
export function parseFnb(id: string, sent: string, raw: string): (Parsed | { skip: string })[] {
  const bullets = raw.replace(/\s+/g, " ").split(/•|FNB\s*:-\)/).map((b) => b.trim()).filter((b) => /^R\s?\d/.test(b));
  if (!bullets.length) return [{ skip: "no money moved" }];
  const sentSast = new Date(new Date(sent).getTime() + 2 * 3600_000);
  return bullets.map((b, k) => {
    const m = b.match(/^R\s?(\d[\d ,]*\.\d{2})\s+(.+?)\s+(from|to|into|on|at)\s+(.*)$/i);
    if (!m) return { skip: "unrecognised FNB notice" };
    const verb = m[2].toLowerCase(), rest = m[4];
    if (/reversed|declined|unsuccessful|failed/.test(b.toLowerCase())) return { skip: "no money moved" };
    const credit = /\b(paid to|deposit|received|credited|t\/fer to|refund)\b/i.test(`${verb} ${m[3]}`) && !/\bfrom\b/i.test(m[3]);
    const ref = b.match(/Ref\.\s*(.+?)\.\s+\d{1,2}[A-Za-z]{3}\s+\d{1,2}:\d{2}/)?.[1]?.trim();
    const channel = b.match(/@\s*([^.]+)\./)?.[1]?.trim() ?? "";
    const toAcc = b.match(/\bto\s+(.+?a\/c\.\.\d+)/i)?.[1];
    let description: string;
    if (/t\/fer/.test(verb)) description = `${/sched/i.test(channel) ? "Scheduled Trf To" : "FNB App Transfer To"} ${toAcc ?? ref ?? "own account"}`;
    else if (ref && /^send\s/i.test(ref)) description = `Send Money App Dr ${ref}`;
    else if (/eft|debit order|debicheck/i.test(channel)) description = `Magtape Debit ${ref ?? channel}`;
    else if (/purchase|card|pos/i.test(`${verb} ${channel}`)) description = ref ?? channel;
    else description = `FNB App Payment To ${ref ?? rest.split("@")[0].trim()}`;

    let date = sentSast.toISOString().slice(0, 10), time: string | null = sentSast.toISOString().slice(11, 16);
    const when = b.match(/(\d{1,2})([A-Za-z]{3})\s+(\d{1,2}):(\d{2})\s*$/) ?? b.match(/(\d{1,2})([A-Za-z]{3})\s+(\d{1,2}):(\d{2})/);
    if (when && MON3.includes(when[2].toLowerCase())) {
      const mon = MON3.indexOf(when[2].toLowerCase()); let year = sentSast.getUTCFullYear();
      if (mon === 11 && sentSast.getUTCMonth() === 0) year--;
      date = `${year}-${String(mon + 1).padStart(2, "0")}-${when[1].padStart(2, "0")}`;
      time = `${when[3].padStart(2, "0")}:${when[4]}`;
    }
    const avail = b.match(/Avail\s+R\s?(-?\d[\d ,]*(?:\.\d{2})?)/i);
    return { ref: bullets.length > 1 ? `${id}#${k + 1}` : id, date, time, description, amount: (credit ? 1 : -1) * money(m[1]), balance: avail ? money(avail[1]) : null, kind: `fnb ${verb}` };
  });
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

    const { messages, dry_run = false } = await req.json();
    if (!Array.isArray(messages)) return json({ error: "messages[] required" }, 400);
    // the bank is read off the mail itself: FNB inContact starts "FNB:-)", everything else is Discovery's wording
    const rows: Record<string, Parsed[]> = { Discovery: [], FNB: [] }, skipped: { id: string; why: string }[] = [];
    for (const m of messages) {
      if (!m?.id || !m?.text) { skipped.push({ id: String(m?.id), why: "id and text required" }); continue; }
      const sent = m.sent ?? new Date().toISOString(), text = String(m.text);
      const fnb = /FNB\s*:-\)|inContact/i.test(text) || /fnb\.co\.za/i.test(String(m.from ?? ""));
      for (const p of fnb ? parseFnb(String(m.id), sent, text) : [parseMail(String(m.id), sent, text)]) {
        if ("skip" in p) skipped.push({ id: m.id, why: p.skip }); else rows[fnb ? "FNB" : "Discovery"].push(p);
      }
    }
    if (dry_run) return json({ rows, skipped });
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const total = { inserted: 0, cleared: 0, skipped: 0 };
    for (const [account, list] of Object.entries(rows)) {
      if (!list.length) continue;
      const { data, error } = await admin.rpc("pf_import_txns", { p_account: account, p_source: "email", p_rows: list });
      if (error) return json({ error: `${account}: ${error.message}` }, 500);
      total.inserted += data.inserted; total.cleared += data.cleared; total.skipped += data.skipped;
    }
    return json({ ...total, parsed: rows.Discovery.length + rows.FNB.length, fnb: rows.FNB.length, discovery: rows.Discovery.length, ignored: skipped });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
