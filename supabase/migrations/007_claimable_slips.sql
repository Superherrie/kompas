-- Slips that work pays back. A claimable slip's payment is not household spending, so its bank line moves to
-- Work expenses > To claim back (kind 'transfer' → outside every spend / budget figure); the refund from work goes to
-- Work expenses > Reimbursed by work the same way. The slip keeps the detail and tracks whether it has been claimed.
-- NB this file supersedes pf_match_slip and pf_file_slip from 005 — apply it after 005.
alter table pf_slips add column if not exists claimable boolean not null default false;
alter table pf_slips add column if not exists claimed_on date;          -- handed in to work
alter table pf_slips add column if not exists repaid_on date;           -- money received back

insert into pf_categories (name, kind, color, sort) select 'Work expenses', 'transfer', '#6b7fa8', 90
 where not exists (select 1 from pf_categories where parent_id is null and name = 'Work expenses');
insert into pf_categories (parent_id, name, kind)
select p.id, v.name, 'transfer' from pf_categories p, (values ('To claim back'), ('Reimbursed by work')) v(name)
 where p.parent_id is null and p.name = 'Work expenses'
on conflict do nothing;

create or replace function pf_claim_category_id() returns int
language sql stable security definer set search_path = public as
$$ select c.id from pf_categories c join pf_categories p on p.id = c.parent_id where p.name = 'Work expenses' and c.name = 'To claim back' limit 1 $$;

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

-- tick / untick later (from the slip itself). Unticking hands the payment back to the normal category rules.
create or replace function pf_set_slip_claimable(p_slip bigint, p_claimable boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not pf_is_member() then raise exception 'not a household member'; end if;
  update pf_slips set claimable = p_claimable,
         claimed_on = case when p_claimable then claimed_on end, repaid_on = case when p_claimable then repaid_on end
   where id = p_slip;
  update pf_transactions t set
         category_id = case when p_claimable then pf_claim_category_id()
                            else coalesce(pf_categorise(t.description, t.account_id), pf_uncategorised_id(t.amount)) end,
         category_locked = p_claimable
   where t.slip_id = p_slip and (p_claimable or t.category_id = pf_claim_category_id());
end $$;

create or replace function pf_file_slip(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sid bigint; tid bigint; acc int; made boolean := false; pm text := coalesce(p->>'payment_method', 'unknown');
        d date := nullif(p->>'date','')::date; tip numeric := coalesce(nullif(p->>'tip','')::numeric, 0);
        claim boolean := coalesce((p->>'claimable')::boolean, false);
begin
  if not pf_is_member() then raise exception 'not a household member'; end if;
  if nullif(p->>'total','') is null then raise exception 'a slip needs a total'; end if;

  -- p.total = the slip's own total; what left the account = total + tip
  insert into pf_slips (image_path, merchant, slip_date, slip_time, total, tip, vat, payment_method, card_last4, items, raw, note, claimable)
  values (p->>'image_path', nullif(trim(p->>'merchant'), ''), d, nullif(p->>'time','')::time,
          round((p->>'total')::numeric + tip, 2), nullif(tip, 0), nullif(p->>'vat','')::numeric, pm, nullif(p->>'card_last4',''),
          coalesce(p->'items', '[]'::jsonb), jsonb_build_object('reader', coalesce(p->>'reader','device'), 'text', p->>'text'), nullif(p->>'note',''), claim)
  returning id into sid;

  tid := pf_match_slip(sid);                       -- (moves the payment to 'To claim back' when claimable)
  -- nothing found: hold a pending line so today's spend is right — but only for a recent slip. An old slip with no
  -- payment on record stays 'unmatched' (its statement is probably loaded already; a new line would double count).
  -- A cash slip creates no line (the ATM withdrawal was the spend); a claimable one is still tracked on the claim list.
  if tid is null and pm <> 'cash' and coalesce(d, current_date) >= current_date - 7 then
    select id into acc from pf_accounts where (p->>'card_last4') = any(card_last4) limit 1;
    if acc is null then select id into acc from pf_accounts where name = 'Discovery'; end if;
    insert into pf_transactions (account_id, txn_date, txn_time, description, amount, category_id, category_locked, source, status, slip_id)
    values (acc, coalesce(d, current_date), nullif(p->>'time','')::time, coalesce(nullif(trim(p->>'merchant'), ''), 'Slip'),
            -round((p->>'total')::numeric + tip, 2),
            case when claim then pf_claim_category_id()
                 else coalesce(nullif(p->>'category_id','')::int, pf_categorise(p->>'merchant', acc), pf_uncategorised_id()) end,
            claim, 'slip', 'pending', sid)
    returning id into tid;
    update pf_slips set status = 'matched' where id = sid;
    made := true;
  elsif tid is not null and not claim and nullif(p->>'category_id','') is not null then
    perform pf_set_category(tid, (p->>'category_id')::int, false);      -- the category picked on the review screen wins
  end if;
  return jsonb_build_object('slip_id', sid, 'txn_id', tid, 'created', made);
end $$;

-- the refund arriving from work is not income either
insert into pf_rules (pattern, match, category_id)
select v.pattern, 'contains', c.id from (values ('expenseclaim'), ('reimbursement'), ('reimburse')) v(pattern),
       pf_categories c join pf_categories p on p.id = c.parent_id
 where p.name = 'Work expenses' and c.name = 'Reimbursed by work'
on conflict do nothing;

notify pgrst, 'reload schema';
