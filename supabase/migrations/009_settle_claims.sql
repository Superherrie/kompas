-- Ticking claims off against what the company paid back.
--   pf_transactions.repaid_by = the company payment that settled a claimable item
--   the payment itself moves to Work expenses > Reimbursed by work (kind 'transfer'), so it stops counting as income
alter table pf_transactions add column if not exists repaid_by bigint references pf_transactions(id) on delete set null;
create index if not exists pf_txn_repaid_by_ix on pf_transactions (repaid_by) where repaid_by is not null;
insert into pf_settings (key, value) values ('claim_payers', 'interconnect systems,asi connect') on conflict (key) do nothing;

create or replace function pf_reimbursed_category_id() returns int
language sql stable security definer set search_path = public as
$$ select c.id from pf_categories c join pf_categories p on p.id = c.parent_id where p.name = 'Work expenses' and c.name = 'Reimbursed by work' limit 1 $$;

create or replace function pf_settle_claims(p_payment bigint, p_items bigint[]) returns int
language plpgsql security definer set search_path = public as $$
declare pay pf_transactions; n int;
begin
  if not (pf_is_member() or coalesce(auth.role(), '') = 'service_role') then raise exception 'not a household member'; end if;
  select * into pay from pf_transactions where id = p_payment;
  if pay.id is null or pay.amount <= 0 then raise exception 'payment % is not money in', p_payment; end if;

  update pf_transactions set repaid_by = pay.id, repaid_on = pay.txn_date, claimed_on = coalesce(claimed_on, pay.txn_date)
   where id = any(p_items) and category_id = pf_claim_category_id() and repaid_by is null;
  get diagnostics n = row_count;
  update pf_slips s set repaid_on = pay.txn_date, claimed_on = coalesce(s.claimed_on, pay.txn_date)
    from pf_transactions t where t.id = any(p_items) and s.id = t.slip_id;

  if n > 0 then
    update pf_transactions set prev_category_id = case when category_id = pf_reimbursed_category_id() then prev_category_id else category_id end,
           category_id = pf_reimbursed_category_id(), category_locked = true
     where id = pay.id;
  end if;
  return n;
end $$;

-- undo a settlement: items go back to "to claim" (claimed date kept), the payment back to where it was
create or replace function pf_unsettle_claims(p_payment bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (pf_is_member() or coalesce(auth.role(), '') = 'service_role') then raise exception 'not a household member'; end if;
  update pf_slips s set repaid_on = null from pf_transactions t where t.repaid_by = p_payment and s.id = t.slip_id;
  update pf_transactions set repaid_by = null, repaid_on = null where repaid_by = p_payment;
  update pf_transactions set category_id = coalesce(prev_category_id, pf_uncategorised_id(amount)), prev_category_id = null, category_locked = false
   where id = p_payment and category_id = pf_reimbursed_category_id();
end $$;

notify pgrst, 'reload schema';
