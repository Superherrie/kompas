-- Slips: a manually captured tip, and matching against payments however long ago they were made.
alter table pf_slips add column if not exists tip numeric(12,2);      -- pf_slips.total = what was paid (slip total + tip)

-- does any real word of the slip's shop name appear in the bank description? ("Spur River Falls" ~ "TABBS*River Falls Spur P")
create or replace function pf_similar(p_merchant text, p_norm text) returns boolean
language sql immutable as $fn$
  select exists (select 1 from regexp_split_to_table(lower(coalesce(p_merchant, '')), '[^a-z0-9]+') w
                  where length(w) >= 4 and w not in ('store', 'shop', 'restaurant', 'cafe', 'the', 'pty', 'ltd') and p_norm like '%' || w || '%') $fn$;

-- Find the bank line a slip belongs to. p_amount = amount paid (incl. any tip the person entered).
--  1. same amount around the slip date (card lines post up to a week later)
--  2. same amount anywhere in the history (slip scanned late / date unreadable): similar merchant first, then nearest date
--  3. no tip entered but the card was charged a bit more the same day at a similar merchant → that is the tip
create or replace function pf_find_payment(p_amount numeric, p_date date default null, p_merchant text default null, p_infer_tip boolean default true)
returns table (id bigint, txn_date date, description text, amount numeric, account text, status text, inferred_tip numeric)
language plpgsql stable security definer set search_path = public as $$
declare a numeric := round(p_amount, 2);
begin
  if not (pf_is_member() or coalesce(auth.role(), '') = 'service_role') then raise exception 'not a household member'; end if;
  if a is null or a <= 0 then return; end if;

  if p_date is not null then
    return query select x.id, x.txn_date, x.description, x.amount, ac.name, x.status, null::numeric
      from pf_transactions x join pf_accounts ac on ac.id = x.account_id
     where x.amount = -a and x.slip_id is null and x.txn_date between p_date - 2 and p_date + 7
     order by abs(x.txn_date - p_date) limit 1;
    if found then return; end if;
  end if;

  return query select x.id, x.txn_date, x.description, x.amount, ac.name, x.status, null::numeric
    from pf_transactions x join pf_accounts ac on ac.id = x.account_id
   where x.amount = -a and x.slip_id is null
     and x.txn_date >= coalesce(p_date - 60, current_date - 365) and x.txn_date <= coalesce(p_date + 60, current_date)
   order by pf_similar(p_merchant, x.norm) desc,
            abs(x.txn_date - coalesce(p_date, current_date)) limit 1;
  if found then return; end if;

  if p_infer_tip and p_date is not null then
    return query select x.id, x.txn_date, x.description, x.amount, ac.name, x.status, (-x.amount - a)
      from pf_transactions x join pf_accounts ac on ac.id = x.account_id
     where x.slip_id is null and -x.amount > a and -x.amount <= round(a * 1.30, 2)
       and x.txn_date between p_date - 1 and p_date + 4
       and pf_similar(p_merchant, x.norm)
     order by abs(x.txn_date - p_date), -x.amount limit 1;
  end if;
end $$;

create or replace function pf_match_slip(p_slip bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare s pf_slips; hit record;
begin
  if not (pf_is_member() or coalesce(auth.role(), '') = 'service_role') then raise exception 'not a household member'; end if;
  select * into s from pf_slips where id = p_slip;
  if s.total is null then return null; end if;
  select * into hit from pf_find_payment(s.total, s.slip_date, s.merchant, coalesce(s.tip, 0) = 0);
  if hit.id is null then
    update pf_slips set status = 'unmatched' where id = p_slip;
    return null;
  end if;
  update pf_transactions set slip_id = p_slip where id = hit.id;
  update pf_slips set status = 'matched',
         tip = case when hit.inferred_tip is not null then hit.inferred_tip else tip end,
         total = case when hit.inferred_tip is not null then total + hit.inferred_tip else total end,
         slip_date = coalesce(slip_date, hit.txn_date)
   where id = p_slip;
  return hit.id;
end $$;

create or replace function pf_file_slip(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sid bigint; tid bigint; acc int; made boolean := false; pm text := coalesce(p->>'payment_method', 'unknown');
        d date := nullif(p->>'date','')::date; tip numeric := coalesce(nullif(p->>'tip','')::numeric, 0);
begin
  if not pf_is_member() then raise exception 'not a household member'; end if;
  if nullif(p->>'total','') is null then raise exception 'a slip needs a total'; end if;

  -- p.total = the slip's own total; what left the account = total + tip
  insert into pf_slips (image_path, merchant, slip_date, slip_time, total, tip, vat, payment_method, card_last4, items, raw, note)
  values (p->>'image_path', nullif(trim(p->>'merchant'), ''), d, nullif(p->>'time','')::time,
          round((p->>'total')::numeric + tip, 2), nullif(tip, 0), nullif(p->>'vat','')::numeric, pm, nullif(p->>'card_last4',''),
          coalesce(p->'items', '[]'::jsonb), jsonb_build_object('reader', coalesce(p->>'reader','device'), 'text', p->>'text'), nullif(p->>'note',''))
  returning id into sid;

  tid := pf_match_slip(sid);
  -- nothing found: hold a pending line so today's spend is right — but only for a recent slip. An old slip with no
  -- payment on record stays 'unmatched' (its statement is probably loaded already; a new line would double count).
  if tid is null and pm <> 'cash' and coalesce(d, current_date) >= current_date - 7 then
    select id into acc from pf_accounts where (p->>'card_last4') = any(card_last4) limit 1;
    if acc is null then select id into acc from pf_accounts where name = 'Discovery'; end if;
    insert into pf_transactions (account_id, txn_date, txn_time, description, amount, category_id, source, status, slip_id)
    values (acc, coalesce(d, current_date), nullif(p->>'time','')::time, coalesce(nullif(trim(p->>'merchant'), ''), 'Slip'),
            -round((p->>'total')::numeric + tip, 2),
            coalesce(nullif(p->>'category_id','')::int, pf_categorise(p->>'merchant', acc), pf_uncategorised_id()), 'slip', 'pending', sid)
    returning id into tid;
    update pf_slips set status = 'matched' where id = sid;
    made := true;
  elsif tid is not null and nullif(p->>'category_id','') is not null then
    perform pf_set_category(tid, (p->>'category_id')::int, false);      -- the category picked on the review screen wins
  end if;
  return jsonb_build_object('slip_id', sid, 'txn_id', tid, 'created', made);
end $$;

notify pgrst, 'reload schema';
