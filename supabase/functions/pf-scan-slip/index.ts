// pf-scan-slip — reads a till-slip photo with Claude and returns what it says. It stores nothing: the app shows the
// result on its review screen (tip, claim-back tick, category, "payment found") and files it with pf_file_slip.
//   POST { image: <base64 jpeg/png/webp>, media?: 'image/jpeg' }   →   { draft }
// Secrets: ANTHROPIC_API_KEY (required), PF_SLIP_MODEL (optional; default claude-haiku-4-5 — about R0.10 a slip.
//          Set it to claude-opus-5 for the hardest slips at roughly five times the price).
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";
import { z } from "npm:zod";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk/helpers/zod";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ingest-token" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SlipSchema = z.object({
  is_slip: z.boolean().describe("false when the photo is not a receipt / till slip / invoice"),
  merchant: z.string().describe("Trading name as a person would say it, with the branch when printed, e.g. 'Checkers Jukskei Park'. Read the logo if the name is only there."),
  date: z.string().nullable().describe("Purchase date, YYYY-MM-DD"),
  time: z.string().nullable().describe("Purchase time, HH:MM 24h"),
  total: z.number().nullable().describe("The slip's own total including VAT, BEFORE any tip"),
  tip: z.number().nullable().describe("Tip / gratuity when written or printed on the slip, else null"),
  vat: z.number().nullable(),
  payment_method: z.enum(["card", "cash", "unknown"]),
  card_last4: z.string().nullable().describe("Last four digits of the PAYMENT card if printed (not a loyalty card number)"),
  items: z.array(z.object({ name: z.string(), qty: z.number().nullable(), amount: z.number().nullable() })).describe("Line items; amount is the line total INCLUDING VAT"),
  category: z.string().nullable().describe("Best fit from the supplied category list, copied exactly, or null"),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    // only household members may spend the API key (or a script holding the household's ingest token)
    const token = Deno.env.get("PF_INGEST_TOKEN");
    const byToken = !!token && req.headers.get("x-ingest-token") === token;
    const asUser = byToken
      ? createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)
      : createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    if (!byToken && !(await asUser.rpc("pf_is_member")).data) return json({ error: "not a household member" }, 403);
    if (!Deno.env.get("ANTHROPIC_API_KEY")) return json({ error: "No ANTHROPIC_API_KEY yet — add it in Supabase → Edge Functions → Secrets", code: "no_key" }, 503);

    const { image, media } = await req.json();
    if (typeof image !== "string" || image.length < 1000) return json({ error: "image (base64) required" }, 400);
    const mediaType = (["image/png", "image/webp"].includes(media) ? media : "image/jpeg") as "image/jpeg" | "image/png" | "image/webp";

    const { data: cats } = await asUser.from("pf_categories").select("id,name,parent_id,kind");
    const subs = (cats ?? []).filter((c) => c.parent_id !== null && c.kind === "expense");
    const label = (c: { name: string; parent_id: number }) => `${cats!.find((p) => p.id === c.parent_id)?.name} > ${c.name}`;

    const model = Deno.env.get("PF_SLIP_MODEL") || "claude-haiku-4-5";
    const client = new Anthropic();
    const res = await client.messages.parse({
      model,
      max_tokens: 8000,
      // `effort` is rejected by Haiku 4.5; on the larger models a slip needs very little thinking
      output_config: { format: zodOutputFormat(SlipSchema), ...(model.includes("haiku") ? {} : { effort: "low" as const }) },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
          { type: "text", text: `This is a photo of a South African till slip (amounts in rand; dates are usually DD/MM/YYYY; today is ${new Date().toISOString().slice(0, 10)}). Extract it. Read every digit carefully — a wrong digit is worse than a missing one, so when a value can't be read return null rather than guessing. "total" is the slip's own total including VAT (after discounts); report a tip separately. This is a personal budget, so every line item amount must be VAT-inclusive: most tills print inclusive prices — copy those as they are — but if the slip lists VAT-exclusive lines (the lines plus the VAT line add up to the total), add 15% VAT to each taxable line so the items sum to the total. Ignore the VAT summary table and till/cashier codes. A long "Card Number: 9710…" line under a greeting such as "Hi HERMAN" is the Xtra Savings / Smart Shopper LOYALTY card, not the payment card — card_last4 comes only from a masked bank card line (e.g. "**** **** **** 5302") and is null otherwise.\n\nCategory list:\n${subs.map(label).join("\n")}` },
        ],
      }],
    });
    if (res.stop_reason === "refusal") return json({ error: "the slip could not be processed" }, 422);
    const s = res.parsed_output;
    if (!s || !s.is_slip) return json({ error: "That doesn’t look like a slip — try again with the whole slip in the frame." }, 422);
    return json({
      draft: {
        merchant: s.merchant, date: s.date, time: s.time, total: s.total, tip: s.tip, vat: s.vat,
        payment_method: s.payment_method, card_last4: s.card_last4, items: s.items,
        category_id: subs.find((c) => label(c) === s.category)?.id ?? null, text: "",
      },
      model, usage: res.usage,
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: "Claude is rate-limited — try again in a minute" }, 429);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "The ANTHROPIC_API_KEY was rejected — check the secret in Supabase", code: "no_key" }, 503);
    if (e instanceof Anthropic.APIError) return json({ error: `Claude API: ${e.message}` }, 502);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
