-- 19 Oct 2026: foreign-currency card payments (Xero, USD 57 a month) arrive by mail without a rand amount. Herman wants
-- them in straight away at an agreed rate (USD 16.70) rather than waiting weeks for the statement:
--   * pf_settings.fx_usd_zar holds the rate; pf-ingest-email converts and words the line "… ~ USD 57.00 @ 16.70"
--   * when the statement/export brings the real rand figure, pf_import_txns treats the estimate as the same payment
--     (within 5%) and corrects the amount instead of adding a second line
-- APPLY ORDER: after 001 (replaces pf_import_txns from 001).

insert into pf_settings (key, value) values ('fx_usd_zar', '16.70')
on conflict (key) do update set value = excluded.value;

create or replace function pf_import_txns(p_account text, p_source text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  acc int; r jsonb; d date; t time; a numeric; ds text; n40 text; hit bigint; cat int;
  ins int := 0; skipped int := 0; cleared int := 0;
begin
  if not (pf_is_member() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'not a household member';
  end if;
  select id into acc from pf_accounts where lower(name) = lower(p_account);
  if acc is null then raise exception 'unknown account %', p_account; end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    d := (r->>'date')::date; t := nullif(r->>'time','')::time;
    a := round((r->>'amount')::numeric, 2); ds := trim(r->>'description');
    n40 := left(pf_norm(ds), 40);

    if r->>'ref' is not null and exists (select 1 from pf_transactions where source_ref = r->>'ref') then
      skipped := skipped + 1; continue;
    end if;

    -- same line already loaded from a statement (or the seed)?
    select id into hit from pf_transactions x
     where x.account_id = acc and x.txn_date = d and x.amount = a and x.status = 'cleared'
       and (left(x.norm, 40) = n40 or (p_source <> 'statement' and (x.norm like n40 || '%' or n40 like left(x.norm, 12) || '%')))
       and (x.txn_time is null or t is null or date_trunc('minute', x.txn_time) = date_trunc('minute', t))
     limit 1;
    if hit is not null then
      update pf_transactions set txn_time = coalesce(txn_time, t) where id = hit;
      skipped := skipped + 1; continue;
    end if;

    if p_source = 'statement' then
      -- a pending row (bank e-mail, slip, manual) for the same money: card lines post up to a few days later.
      -- A foreign-currency estimate ("… ~ USD 57.00 @ 16.70") may be a few rand out — within 5% it is the same payment.
      select id into hit from pf_transactions x
       where x.account_id = acc and x.status = 'pending'
         and x.txn_date between d - 5 and d + 1
         and (x.amount = a
              or (x.description ~ '~ [A-Z]{3} [0-9.,]+ @ [0-9.]+$' and sign(x.amount) = sign(a)
                  and abs(x.amount - a) <= greatest(abs(a) * 0.05, 5)))
       order by (x.amount = a) desc, abs(x.txn_date - d), (left(x.norm, 8) = left(n40, 8)) desc limit 1;
      if hit is not null then
        update pf_transactions x set status = 'cleared', description = ds, amount = a,
               txn_time = coalesce(x.txn_time, t),
               category_id = case when x.category_locked or x.category_id is distinct from pf_uncategorised_id(a)
                                  then x.category_id else coalesce(pf_categorise(ds, acc, a), x.category_id) end
         where id = hit;
        cleared := cleared + 1; continue;
      end if;
    end if;

    if p_source = 'email' then
      -- the slip photo (or a manual entry) got there first: the bank mail adopts that line instead of adding a second one
      select id into hit from pf_transactions x
       where x.account_id = acc and x.amount = a and x.status = 'pending' and x.source in ('slip','manual')
         and x.source_ref is null and x.txn_date between d - 1 and d + 1
       order by abs(x.txn_date - d) limit 1;
      if hit is not null then
        update pf_transactions set source_ref = r->>'ref', txn_time = coalesce(t, txn_time),
               balance_after = nullif(r->>'balance','')::numeric where id = hit;
        skipped := skipped + 1; continue;
      end if;
    end if;

    cat := coalesce(pf_categorise(ds, acc, a), nullif(r->>'category_id','')::int, pf_uncategorised_id(a));
    insert into pf_transactions (account_id, txn_date, txn_time, description, amount, category_id, source, source_ref, status, balance_after)
    values (acc, d, t, ds, a, cat, p_source, r->>'ref',
            case when p_source = 'statement' then 'cleared' else 'pending' end,
            nullif(r->>'balance','')::numeric);
    ins := ins + 1;
    -- a slip scanned earlier today may have settled for yesterday's identical line (013_slip_match_same_day.sql)
    if p_source <> 'statement' then perform pf_reclaim_slips(currval('pf_transactions_id_seq')); end if;
  end loop;

  -- month-end FNB lines belong to next month's accounts (006_accounting_month.sql)
  perform pf_assign_periods((current_date - 200)::date);

  -- new bank lines may be the payment an earlier, still unmatched slip was waiting for
  perform pf_match_slip(sl.id) from pf_slips sl where sl.status = 'unmatched' and sl.created_at > now() - interval '180 days';

  insert into pf_sync_log (source, received, inserted, note)
  values (p_source || ':' || p_account, jsonb_array_length(p_rows), ins, format('%s cleared, %s skipped', cleared, skipped));
  return jsonb_build_object('inserted', ins, 'cleared', cleared, 'skipped', skipped);
end $$;

notify pgrst, 'reload schema';
