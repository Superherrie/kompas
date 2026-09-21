// pf-invite — the household owner adds a person. Reuses their login when the e-mail already exists in this
// Supabase project (same credentials as the other apps), otherwise creates one with a temporary password.
//   POST { email, name }  →  { status: 'added' | 'created', temp_password? }
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    if (!(await asUser.rpc("pf_is_owner")).data) return json({ error: "only the owner can add household members" }, 403);

    const { email, name } = await req.json();
    const mail = String(email ?? "").trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(mail) || !name) return json({ error: "name and a valid e-mail are required" }, 400);

    const existing = (await asUser.rpc("pf_add_member", { p_email: mail, p_name: name })).data;
    if (existing === "added") return json({ status: "added" });

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const temp = "Kompas-" + crypto.randomUUID().slice(0, 8);
    const { data, error } = await admin.auth.admin.createUser({ email: mail, password: temp, email_confirm: true });
    if (error || !data.user) return json({ error: error?.message ?? "could not create the login" }, 500);
    const { error: mErr } = await admin.from("pf_members").insert({ user_id: data.user.id, display_name: name, email: mail });
    if (mErr) return json({ error: mErr.message }, 500);
    return json({ status: "created", temp_password: temp });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
