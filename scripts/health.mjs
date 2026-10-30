// Read-only health check for Sheryl's morning "are the automations OK?" line.
//   node scripts/health.mjs            → one JSON line, no secrets, no account numbers
// Looks at pf_sync_log (every post by the cloud routine / PC task) and at the e-mail-sourced transactions per bank.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(readFileSync(new URL('./.env', import.meta.url), 'utf8').split(/\r?\n/).map(l => l.match(/^([A-Z_]+)\s*=\s*(.+)$/)).filter(Boolean).map(m => [m[1], m[2].trim()]));
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const DAYS = 7;                                   // window for missing_days
const FNB_SILENCE_DAYS = 3;                       // FNB sends a mail for every outgoing payment — 3 quiet days is suspicious
const SYNC_STALE_HOURS = 8;                       // the routine runs 4× a day; a gap longer than this means it is not posting
const today = () => new Date().toLocaleDateString('sv');       // local calendar date
const daysAgo = (d) => Math.round((Date.parse(today()) - Date.parse(d)) / 864e5);

const out = { app: 'kompas', last_ok: null, missing_days: [], last_fnb_mail: null, last_discovery_mail: null, note: '' };
const notes = [];
try {
  const since = new Date(Date.now() - (DAYS + 1) * 864e5).toISOString();
  const { data: log, error } = await sb.from('pf_sync_log').select('created_at,source').eq('source', 'email:Discovery').gte('created_at', since).order('created_at');
  if (error) throw error;
  // a day counts as covered when at least one e-mail sync posted on it (local date)
  const covered = new Set(log.map(r => new Date(r.created_at).toLocaleDateString('sv')));
  for (let i = DAYS - 1; i >= 1; i--) { const d = new Date(Date.now() - i * 864e5).toLocaleDateString('sv'); if (!covered.has(d)) out.missing_days.push(d); }
  const last = log.at(-1)?.created_at;
  if (last) {
    out.last_ok = new Date(last).toLocaleDateString('sv');
    const hours = (Date.now() - Date.parse(last)) / 36e5;
    if (hours > SYNC_STALE_HOURS) notes.push(`no mail sync for ${Math.round(hours)} h (routine runs 07/12/17/21)`);
  } else notes.push(`no mail sync in the last ${DAYS} days`);

  // newest e-mail-sourced line per bank = the last mail the sync saw from that bank
  for (const [acc, key] of [['FNB', 'last_fnb_mail'], ['Discovery', 'last_discovery_mail']]) {
    const { data: a } = await sb.from('pf_accounts').select('id').ilike('name', acc).single();
    const { data: t } = await sb.from('pf_transactions').select('txn_date').eq('account_id', a.id).eq('source', 'email').order('txn_date', { ascending: false }).limit(1);
    out[key] = t?.[0]?.txn_date ?? null;
  }
  if (out.last_fnb_mail && daysAgo(out.last_fnb_mail) >= FNB_SILENCE_DAYS) notes.push(`no FNB inContact mail for ${daysAgo(out.last_fnb_mail)} days — check FNB inContact settings`);
  if (!out.last_fnb_mail) notes.push('no FNB mail ever loaded');
  if (out.last_discovery_mail && daysAgo(out.last_discovery_mail) >= 2) notes.push(`no Discovery mail for ${daysAgo(out.last_discovery_mail)} days`);
  if (out.missing_days.length) notes.push(`no sync on ${out.missing_days.join(', ')}`);

  // lines still waiting for a statement to confirm them, older than the usual statement lag
  const { count } = await sb.from('pf_transactions').select('id', { count: 'exact', head: true }).eq('status', 'pending').lt('txn_date', new Date(Date.now() - 45 * 864e5).toLocaleDateString('sv'));
  if (count) notes.push(`${count} pending line(s) older than 45 days — a statement import is overdue`);
} catch (e) {
  notes.push(`health check failed: ${String(e.message ?? e).slice(0, 120)}`);
}
out.note = notes.join('; ');
console.log(JSON.stringify(out));
