-- 16 Nov 2026: reconciling the Oct/Nov statements showed two gaps in pf_import_txns:
--   * Discovery re-words a line between exports ("MUGG AND BEAN WOODMEAD Gauteng ZA" → "… Gauteng"), so a line cleared
--     from an earlier export no longer matched on its description and would have been loaded twice. A line on the same
--     account, date and amount at the SAME MINUTE is the same transaction, whatever it is called.
--   * with several equal amounts in a few days (R51 coffees), a statement line should confirm the pending mail line
--     from the same minute, not merely the nearest date.
--   * a line that came in by bank mail keeps the mail's date (the day it happened); the statement posts it a day or
--     three later. Importing the same statement a second time therefore no longer found it and loaded it again.
--     stmt_date remembers the statement's date for the line, and the "already loaded" test accepts either date.
-- APPLY ORDER: after 017 (replaces pf_import_txns from 017).

alter table pf_transactions add column if not exists stmt_date date;

create or replace function pf_import_txns(p_account text, p_source text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  acc int; r jsonb; d date; t time; a numeric; ds text; n40 text; hit bigint; cat int;
  ins int := 0; skipped int := 0; cleared int := 0;
  -- lines already tied to a row of THIS file: two identical lines on one day (two R5,000 transfers on 12 Oct 2026)
  -- are two transactions, so the second may not match the line the first one just matched
  used bigint[] := '{}';
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
     where x.account_id = acc and x.id <> all(used) and (x.txn_date = d or x.stmt_date = d) and x.amount = a and x.status = 'cleared'
       and (left(x.norm, 40) = n40
            or (p_source <> 'statement' and (x.norm like n40 || '%' or n40 like left(x.norm, 12) || '%'))
            or (t is not null and x.txn_time is not null and date_trunc('minute', x.txn_time) = date_trunc('minute', t)))
       and (x.txn_time is null or t is null or date_trunc('minute', x.txn_time) = date_trunc('minute', t))
     order by (x.stmt_date = d) desc nulls last limit 1;
    -- lines cleared before stmt_date existed: a mail line confirmed by a statement, same wording and amount, a few days
    -- either side, not yet tied to a statement date
    if hit is null and p_source = 'statement' then
      select id into hit from pf_transactions x
       where x.account_id = acc and x.id <> all(used) and x.status = 'cleared' and x.source = 'email' and x.stmt_date is null
         and x.amount = a and left(x.norm, 40) = n40 and x.txn_date between d - 5 and d + 1
         and (x.txn_time is null or t is null or date_trunc('minute', x.txn_time) = date_trunc('minute', t))
       order by abs(x.txn_date - d) limit 1;
    end if;
    if hit is not null then
      used := used || hit;
      -- a statement's wording is the final one: keep it, so the next export matches on description too
      update pf_transactions set txn_time = coalesce(txn_time, t),
             description = case when p_source = 'statement' then ds else description end,
             stmt_date = case when p_source = 'statement' then d else stmt_date end
       where id = hit;
      skipped := skipped + 1; continue;
    end if;

    if p_source = 'statement' then
      -- a pending row (bank e-mail, slip, manual) for the same money: card lines post up to a few days later.
      -- A foreign-currency estimate ("… ~ USD 57.00 @ 16.70") may be a few rand out — within 5% it is the same payment.
      select id into hit from pf_transactions x
       where x.account_id = acc and x.id <> all(used) and x.status = 'pending'
         and x.txn_date between d - 5 and d + 1
         -- a bank mail and the statement give the same clock time: a mail line from another minute is another purchase
         -- (found 16 Nov 2026: this morning's coffee, not yet mailed in, swallowed Saturday's R51 coffee)
         and (t is null or x.txn_time is null or x.source <> 'email' or date_trunc('minute', x.txn_time) = date_trunc('minute', t))
         and (x.amount = a
              or (x.description ~ '~ [A-Z]{3} [0-9.,]+ @ [0-9.]+$' and sign(x.amount) = sign(a)
                  and abs(x.amount - a) <= greatest(abs(a) * 0.05, 5)))
       order by (x.amount = a) desc,
                (t is not null and x.txn_time is not null and x.txn_date = d and date_trunc('minute', x.txn_time) = date_trunc('minute', t)) desc,
                abs(x.txn_date - d), (left(x.norm, 8) = left(n40, 8)) desc limit 1;
      if hit is not null then
      used := used || hit;
        update pf_transactions x set status = 'cleared', description = ds, amount = a, stmt_date = d,
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
       where x.account_id = acc and x.id <> all(used) and x.amount = a and x.status = 'pending' and x.source in ('slip','manual')
         and x.source_ref is null and x.txn_date between d - 1 and d + 1
       order by abs(x.txn_date - d) limit 1;
      if hit is not null then
      used := used || hit;
        update pf_transactions set source_ref = r->>'ref', txn_time = coalesce(t, txn_time),
               balance_after = nullif(r->>'balance','')::numeric where id = hit;
        skipped := skipped + 1; continue;
      end if;
    end if;

    cat := coalesce(pf_categorise(ds, acc, a), nullif(r->>'category_id','')::int, pf_uncategorised_id(a));
    insert into pf_transactions (account_id, txn_date, txn_time, description, amount, category_id, source, source_ref, status, balance_after, stmt_date)
    values (acc, d, t, ds, a, cat, p_source, r->>'ref',
            case when p_source = 'statement' then 'cleared' else 'pending' end,
            nullif(r->>'balance','')::numeric,
            case when p_source = 'statement' then d end);
    ins := ins + 1;
    used := used || currval('pf_transactions_id_seq');
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

-- FNB prints its own service fees on the statement without a description; the importers now load them as "FNB Service Fee"
insert into pf_rules (pattern, match, category_id)
select 'fnbservicefee', 'prefix', c.id
  from pf_categories p join pf_categories c on c.parent_id = p.id and c.name = 'Bank Fees'
 where p.parent_id is null and p.name = 'Fees and Interest'
   and not exists (select 1 from pf_rules r where r.pattern = 'fnbservicefee' and r.match = 'prefix');

notify pgrst, 'reload schema';
