-- APPLY ORDER: 013 → 007 → 015 (013 and 015 both define pf_find_payment; 007 and 013 both define pf_match_slip).
-- 28 Sep 2026: slips scanned before their bank mail arrived were tied to OLD lines of other shops that happened to
-- cost the same (R109.99 LiquorShop → an 8 Sep LiquorShop line; R221.38 Pick n Pay → a 16 Aug liquor store).
-- The wide "late scan" search may now only take a line whose description resembles the shop on the slip, and it
-- never reaches back more than 21 days before the slip. A slip whose payment isn't on record yet simply waits:
-- the bank mail adopts it when it arrives.
create or replace function pf_find_payment(p_amount numeric, p_date date default null, p_merchant text default null, p_infer_tip boolean default true, p_time time default null)
returns table (id bigint, txn_date date, description text, amount numeric, account text, status text, inferred_tip numeric)
language plpgsql stable security definer set search_path = public as $$
declare a numeric := round(p_amount, 2);
begin
  if not (pf_is_member() or coalesce(auth.role(), '') = 'service_role') then raise exception 'not a household member'; end if;
  if a is null or a <= 0 then return; end if;

  -- 1. the slip's own day (nearest time), then the days after (card lines post late), then one day before
  if p_date is not null then
    return query select x.id, x.txn_date, x.description, x.amount, ac.name, x.status, null::numeric
      from pf_transactions x join pf_accounts ac on ac.id = x.account_id
     where x.amount = -a and x.slip_id is null and x.txn_date between p_date - 1 and p_date + 7
     order by (x.txn_date = p_date) desc, (x.txn_date > p_date) desc, abs(x.txn_date - p_date),
              case when p_time is not null and x.txn_time is not null then abs(extract(epoch from (x.txn_time - p_time))) else 1e9 end
     limit 1;
    if found then return; end if;
  end if;

  -- 2. date unreadable only: same amount AND a similar shop name, at most 21 days back. A slip WITH a date whose
  --    payment isn't on record yet waits for the bank mail — a purchase can't have been paid for weeks earlier.
  if p_date is not null then return; end if;
  return query select x.id, x.txn_date, x.description, x.amount, ac.name, x.status, null::numeric
    from pf_transactions x join pf_accounts ac on ac.id = x.account_id
   where x.amount = -a and x.slip_id is null
     and x.txn_date between coalesce(p_date, current_date) - 21 and coalesce(p_date, current_date) + 7
     and pf_similar(p_merchant, x.norm)
   order by abs(x.txn_date - coalesce(p_date, current_date)) limit 1;
  if found then return; end if;

  -- 3. tip not entered: the card was charged a little more, same shop, within days
  if p_infer_tip and p_date is not null then
    return query select x.id, x.txn_date, x.description, x.amount, ac.name, x.status, (-x.amount - a)
      from pf_transactions x join pf_accounts ac on ac.id = x.account_id
     where x.slip_id is null and -x.amount > a and -x.amount <= round(a * 1.30, 2)
       and x.txn_date between p_date - 1 and p_date + 4
       and pf_similar(p_merchant, x.norm)
     order by abs(x.txn_date - p_date), -x.amount limit 1;
  end if;
end $$;

-- a slip read with last year's date (the reader dropped a digit): if the same day-and-month this year is not in the
-- future, that is the date meant
create or replace function pf_sane_slip_date(d date) returns date
language sql immutable as $$
  select case when d is not null and d < current_date - 300 and (d + interval '1 year')::date <= current_date + 3
              then (d + interval '1 year')::date else d end $$;
