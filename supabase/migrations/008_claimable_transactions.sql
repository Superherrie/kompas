-- Claimable straight from the transaction list (no slip needed). A transaction is claimable when it sits in
-- Work expenses > To claim back; prev_category_id remembers where it came from so un-ticking puts it back.
alter table pf_transactions add column if not exists prev_category_id int references pf_categories(id) on delete set null;
alter table pf_transactions add column if not exists claimed_on date;
alter table pf_transactions add column if not exists repaid_on date;

create or replace function pf_set_txn_claimable(p_txn bigint, p_claimable boolean) returns void
language plpgsql security definer set search_path = public as $$
declare claim int := pf_claim_category_id();
begin
  if not (pf_is_member() or coalesce(auth.role(), '') = 'service_role') then raise exception 'not a household member'; end if;
  if p_claimable then
    update pf_transactions set prev_category_id = case when category_id = claim then prev_category_id else category_id end,
           category_id = claim, category_locked = true where id = p_txn;
  else
    update pf_transactions t set
           category_id = coalesce(t.prev_category_id, pf_categorise(t.description, t.account_id), pf_uncategorised_id(t.amount)),
           category_locked = t.prev_category_id is not null, prev_category_id = null, claimed_on = null, repaid_on = null
     where t.id = p_txn and t.category_id = claim;
  end if;
  update pf_slips s set claimable = p_claimable,
         claimed_on = case when p_claimable then s.claimed_on end, repaid_on = case when p_claimable then s.repaid_on end
    from pf_transactions t where t.id = p_txn and s.id = t.slip_id;
end $$;

-- ticking the slip goes through the same door, so both routes behave identically
create or replace function pf_set_slip_claimable(p_slip bigint, p_claimable boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not (pf_is_member() or coalesce(auth.role(), '') = 'service_role') then raise exception 'not a household member'; end if;
  update pf_slips set claimable = p_claimable,
         claimed_on = case when p_claimable then claimed_on end, repaid_on = case when p_claimable then repaid_on end
   where id = p_slip;
  for r in select id from pf_transactions where slip_id = p_slip loop perform pf_set_txn_claimable(r.id, p_claimable); end loop;
end $$;

-- handed in / paid back. Works on a transaction, a slip, or both (they are kept in step). p_date null = undo.
create or replace function pf_stamp_claim(p_txn bigint, p_slip bigint, p_what text, p_date date) returns void
language plpgsql security definer set search_path = public as $$
declare sid bigint := p_slip;
begin
  if not (pf_is_member() or coalesce(auth.role(), '') = 'service_role') then raise exception 'not a household member'; end if;
  if p_what not in ('claimed', 'repaid') then raise exception 'claimed or repaid'; end if;
  if sid is null then select slip_id into sid from pf_transactions where id = p_txn; end if;
  update pf_transactions set
         claimed_on = case when p_what = 'claimed' then p_date else coalesce(claimed_on, p_date) end,   -- repaid implies claimed
         repaid_on  = case when p_what = 'repaid' then p_date else repaid_on end
   where id = p_txn or (sid is not null and slip_id = sid);
  update pf_slips set
         claimed_on = case when p_what = 'claimed' then p_date else coalesce(claimed_on, p_date) end,
         repaid_on  = case when p_what = 'repaid' then p_date else repaid_on end
   where id = sid;
end $$;

-- everything work owes or owed: claimable transactions (with their slip, if any) + claimable slips that have no payment line (cash)
create or replace view pf_v_claims with (security_invoker = true) as
select t.id as txn_id, t.slip_id, t.txn_date as claim_date, coalesce(s.merchant, t.description) as description,
       -t.amount as amount, coalesce(t.claimed_on, s.claimed_on) as claimed_on, coalesce(t.repaid_on, s.repaid_on) as repaid_on
  from pf_transactions t left join pf_slips s on s.id = t.slip_id
 where t.category_id = pf_claim_category_id()
union all
select null, s.id, coalesce(s.slip_date, s.created_at::date), s.merchant, s.total, s.claimed_on, s.repaid_on
  from pf_slips s
 where s.claimable and not exists (select 1 from pf_transactions t where t.slip_id = s.id);

-- the list needs to know which rows are ticked
create or replace view pf_v_txns with (security_invoker = true) as
select t.id, t.txn_date, t.txn_time, coalesce(t.period, to_char(t.txn_date, 'YYYY-MM')) as month, t.description, t.amount,
       t.source, t.status, t.slip_id, t.note, t.balance_after, t.category_locked,
       a.id as account_id, a.name as account,
       s.id as sub_id, s.name as sub_name, c.id as cat_id, c.name as cat_name,
       coalesce(s.kind, 'expense') as kind, coalesce(s.discretionary, false) as discretionary,
       coalesce(s.color, c.color) as color,
       to_char(t.txn_date, 'YYYY-MM') as cal_month, t.period_locked,
       coalesce(c.name = 'Work expenses' and s.name = 'To claim back', false) as claimable, t.claimed_on, t.repaid_on
  from pf_transactions t
  join pf_accounts a on a.id = t.account_id
  left join pf_categories s on s.id = t.category_id
  left join pf_categories c on c.id = s.parent_id;

-- carry over stamps already made on slips
update pf_transactions t set claimed_on = s.claimed_on, repaid_on = s.repaid_on
  from pf_slips s where s.id = t.slip_id and s.claimable and (s.claimed_on is not null or s.repaid_on is not null);

notify pgrst, 'reload schema';
