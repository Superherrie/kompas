// pf-scan-slip — reads a till-slip photo with Claude and files it.
//   POST { path }   path = object in the private 'pf-slips' bucket (uploaded by the app)
//   → { slip, txn_id, created }  the slip row, the bank line it was matched to, and whether a pending line was created
// Secrets: ANTHROPIC_API_KEY (required), PF_SLIP_MODEL (optional, default claude-opus-5)
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";
import { z } from "npm:zod";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk/helpers/zod";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SlipSchema = z.object({
  is_slip: z.boolean().describe("false when the photo is not a receipt / till slip / invoice"),
  merchant: z.string().describe("Trading name as a person would say it, e.g. 'Checkers Hyper Fourways'"),
  date: z.string().nullable().describe("Purchase date, YYYY-MM-DD"),
  time: z.string().nullable().describe("Purchase time, HH:MM 24h"),
  total: z.number().nullable().describe("Amount actually paid, in rand, including VAT and any tip"),
  vat: z.number().nullable(),
  tip: z.number().nullable(),
  payment_method: z.enum(["card", "cash", "eft", "other", "unknown"]),
  card_last4: z.string().nullable().describe("Last four digits of the card if printed"),
  items: z.array(z.object({ name: z.string(), qty: z.number().nullable(), amount: z.number().nullable() })).describe("Line items; amount is the line total INCLUDING VAT"),
  category: z.string().nullable().describe("Best fit from the supplied category list, copied exactly, or null"),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const auth = req.headers.get("Authorization") ?? "";
    // act as the caller first: only household members may scan
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: member } = await asUser.rpc("pf_is_member");
    if (!member) return json({ error: "not a household member" }, 403);
    const { data: who } = await asUser.auth.getUser();

    const { path } = await req.json();
    if (typeof path !== "string" || !path) return json({ error: "path required" }, 400);
    if (!Deno.env.get("ANTHROPIC_API_KEY")) return json({ error: "ANTHROPIC_API_KEY is not set on the Supabase project (Edge Functions → Secrets)" }, 500);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: file, error: dlErr } = await admin.storage.from("pf-slips").download(path);
    if (dlErr || !file) return json({ error: `could not read ${path}: ${dlErr?.message}` }, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const media = (file.type === "image/png" || file.type === "image/webp" ? file.type : "image/jpeg") as "image/jpeg" | "image/png" | "image/webp";

    const { data: cats } = await admin.from("pf_categories").select("id,name,parent_id,kind");
    const subs = (cats ?? []).filter((c) => c.parent_id !== null && c.kind === "expense");
    const label = (c: { name: string; parent_id: number }) => `${cats!.find((p) => p.id === c.parent_id)?.name} > ${c.name}`;

    const client = new Anthropic();
    const res = await client.messages.parse({
      model: Deno.env.get("PF_SLIP_MODEL") || "claude-opus-5",
      max_tokens: 8000,
      output_config: { effort: "low", format: zodOutputFormat(SlipSchema) },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: media, data: btoa(bin) } },
          { type: "text", text: `This is a photo of a South African till slip (amounts in rand; dates are usually DD/MM/YYYY; today is ${new Date().toISOString().slice(0, 10)}). Extract it. Slips are often crumpled or faded — when a value can't be read, return null rather than guessing. The total is what was actually paid (after discounts, including any tip written or printed on a card slip). This is a personal budget, so every line item amount must be VAT-inclusive: most tills print inclusive prices — copy those as they are — but if the slip lists VAT-exclusive lines (the lines plus the VAT line add up to the total), add 15% VAT to each taxable line so the items sum to the total paid.\n\nCategory list:\n${subs.map(label).join("\n")}` },
        ],
      }],
    });
    if (res.stop_reason === "refusal") return json({ error: "the slip could not be processed" }, 422);
    const s = res.parsed_output;
    if (!s || !s.is_slip || s.total === null) {
      const { data: slip } = await admin.from("pf_slips").insert({ image_path: path, status: "failed", raw: s ?? null, created_by: who.user?.id, note: "Could not read a total from this photo" }).select().single();
      return json({ slip, txn_id: null, created: false });
    }

    const { data: slip, error: insErr } = await admin.from("pf_slips").insert({
      image_path: path, merchant: s.merchant, slip_date: s.date, slip_time: s.time, total: s.total, vat: s.vat,
      payment_method: s.payment_method, card_last4: s.card_last4, items: s.items, raw: s, created_by: who.user?.id,
    }).select().single();
    if (insErr) return json({ error: insErr.message }, 500);

    // 1) the bank line may already be there (Discovery's e-mail usually beats the photo)
    let { data: txnId } = await admin.rpc("pf_match_slip", { p_slip: slip.id });
    let created = false;
    // 2) otherwise hold a pending line so today's spend is right now; the bank e-mail / statement adopts it later.
    //    Cash slips don't create a line — the ATM withdrawal was already counted.
    if (!txnId && s.payment_method !== "cash") {
      const { data: accounts } = await admin.from("pf_accounts").select("id,name,card_last4");
      const acc = accounts?.find((a) => s.card_last4 && a.card_last4?.includes(s.card_last4)) ?? accounts?.find((a) => a.name === "Discovery") ?? accounts?.[0];
      const { data: ruled } = await admin.rpc("pf_categorise", { p_desc: s.merchant, p_account: acc?.id });
      const suggested = subs.find((c) => label(c) === s.category)?.id;
      const { data: unc } = await admin.rpc("pf_uncategorised_id");
      const { data: txn } = await admin.from("pf_transactions").insert({
        account_id: acc!.id, txn_date: s.date ?? new Date().toISOString().slice(0, 10), txn_time: s.time, description: s.merchant, amount: -s.total,
        category_id: ruled ?? suggested ?? unc, source: "slip", status: "pending", slip_id: slip.id, created_by: who.user?.id,
      }).select("id").single();
      txnId = txn?.id ?? null; created = !!txn;
      await admin.from("pf_slips").update({ status: txn ? "matched" : "unmatched" }).eq("id", slip.id);
    }
    const { data: fresh } = await admin.from("pf_slips").select("*").eq("id", slip.id).single();
    return json({ slip: fresh, txn_id: txnId, created });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: "Claude is rate-limited — try again in a minute" }, 429);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "ANTHROPIC_API_KEY was rejected" }, 500);
    if (e instanceof Anthropic.APIError) return json({ error: `Claude API: ${e.message}` }, 502);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
