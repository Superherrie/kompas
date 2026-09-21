-- Filing a slip that was read on the device (free OCR) — the same steps pf-scan-slip does after Claude reads one:
-- save it, tie it to the bank line of the same amount, or hold a pending line until the bank mail arrives.
create or replace function pf_file_slip(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sid bigint; tid bigint; acc int; made boolean := false; pm text := coalesce(p->>'payment_method', 'unknown');
begin
  if not pf_is_member() then raise exception 'not a household member'; end if;
  if nullif(p->>'total','') is null then raise exception 'a slip needs a total'; end if;

  insert into pf_slips (image_path, merchant, slip_date, slip_time, total, vat, payment_method, card_last4, items, raw, note)
  values (p->>'image_path', nullif(trim(p->>'merchant'), ''), nullif(p->>'date','')::date, nullif(p->>'time','')::time,
          round((p->>'total')::numeric, 2), nullif(p->>'vat','')::numeric, pm, nullif(p->>'card_last4',''),
          coalesce(p->'items', '[]'::jsonb), jsonb_build_object('reader', coalesce(p->>'reader','device'), 'text', p->>'text'), nullif(p->>'note',''))
  returning id into sid;

  tid := pf_match_slip(sid);
  if tid is null and pm <> 'cash' then          -- cash: the ATM withdrawal was already counted as the spend
    select id into acc from pf_accounts where (p->>'card_last4') = any(card_last4) limit 1;
    if acc is null then select id into acc from pf_accounts where name = 'Discovery'; end if;
    insert into pf_transactions (account_id, txn_date, txn_time, description, amount, category_id, source, status, slip_id)
    values (acc, coalesce(nullif(p->>'date','')::date, current_date), nullif(p->>'time','')::time, coalesce(nullif(trim(p->>'merchant'), ''), 'Slip'),
            -round((p->>'total')::numeric, 2),
            coalesce(nullif(p->>'category_id','')::int, pf_categorise(p->>'merchant', acc), pf_uncategorised_id()), 'slip', 'pending', sid)
    returning id into tid;
    update pf_slips set status = 'matched' where id = sid;
    made := true;
  end if;
  return jsonb_build_object('slip_id', sid, 'txn_id', tid, 'created', made);
end $$;

insert into pf_settings (key, value) values ('slip_reader', 'device') on conflict (key) do nothing;   -- 'device' (free) | 'claude'
