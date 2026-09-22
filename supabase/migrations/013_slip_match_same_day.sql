-- Slip matching, refined for repeat purchases. The R51 Astron coffee is bought most mornings: a slip dated today used to
-- attach itself to YESTERDAY's identical, still-unmatched R51 (the window allowed 2 days before the slip date), and when
-- today's card mail arrived 20 minutes later it had nothing to attach to.
--   * a dated slip first looks on its own day — the nearest TIME wins — then on the days after (card lines post late),
--     and only then up to a day before (time-zone / midnight quirks)
--   * a payment arriving by mail adopts a slip of the same amount dated that day, even if the slip is already tied to an
--     older line (the older line gets its slip back = none)
create or replace function pf_find_payment(p_amount numeric, p_date date default null, p_merchant text default null, p_infer_tip boolean default true, p_time time default null)
returns table (id bigint, txn_date date, description text, amount numeric, account text, status text, inferred_tip numeric)
language plpgsql stable security definer set search_path = public as $$
declare a numeric := round(p_amount, 2);
begin
  if not (pf_is_member() or coalesce(auth.role(), '') = 'service_role') then raise exception 'not a household member'; end if;
  if a is null or a <= 0 then return; end if;

  if p_date is not null then
    return query select x.id, x.txn_date, x.description, x.amount, ac.name, x.status, null::numeric
      from pf_transactions x join pf_accounts ac on ac.id = x.account_id
     where x.amount = -a and x.slip_id is null and x.txn_date between p_date - 1 and p_date + 7
     order by (x.txn_date = p_date) desc,                                   -- same day first
              (x.txn_date > p_date) desc,                                   -- then later (posting delay), before earlier
              abs(x.txn_date - p_date),
              case when p_time is not null and x.txn_time is not null then abs(extract(epoch from (x.txn_time - p_time))) else 1e9 end
     limit 1;
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
drop function if exists pf_find_payment(numeric, date, text, boolean);

create or replace function pf_match_slip(p_slip bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare s pf_slips; hit record;
begin
  if not (pf_is_member() or coalesce(auth.role(), '') = 'service_role') then raise exception 'not a household member'; end if;
  select * into s from pf_slips where id = p_slip;
  if s.total is null then return null; end if;
  select * into hit from pf_find_payment(s.total, s.slip_date, s.merchant, coalesce(s.tip, 0) = 0, s.slip_time);
  if hit.id is null then
    update pf_slips set status = 'unmatched' where id = p_slip;
    return null;
  end if;
  update pf_transactions set slip_id = p_slip,
         category_id = case when s.claimable then pf_claim_category_id() else category_id end,
         category_locked = category_locked or s.claimable
   where id = hit.id;
  update pf_slips set status = 'matched',
         tip = case when hit.inferred_tip is not null then hit.inferred_tip else tip end,
         total = case when hit.inferred_tip is not null then total + hit.inferred_tip else total end,
         slip_date = coalesce(slip_date, hit.txn_date)
   where id = p_slip;
  return hit.id;
end $$;

-- a newly arrived bank line takes over a slip of its own day and amount that had settled for an older line
create or replace function pf_reclaim_slips(p_txn bigint) returns void
language plpgsql security definer set search_path = public as $$
declare t pf_transactions; s pf_slips;
begin
  select * into t from pf_transactions where id = p_txn;
  if t.id is null or t.slip_id is not null then return; end if;
  select sl.* into s from pf_slips sl join pf_transactions o on o.slip_id = sl.id
   where sl.slip_date = t.txn_date and sl.total = -t.amount and o.txn_date < t.txn_date and o.id <> t.id
   order by o.txn_date desc limit 1;
  if s.id is null then return; end if;
  update pf_transactions set slip_id = null where slip_id = s.id;
  update pf_transactions set slip_id = s.id where id = t.id;
end $$;
