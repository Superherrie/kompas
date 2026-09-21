-- Claims recon take-on date. Claimable items and company payments before it are history that can't be reconciled
-- any more (take-on balances), so the recon ignores them: they keep their "claim" flag (still outside household spend)
-- but no longer show as outstanding and are never offered to the matcher.
-- A fixed date rather than a rolling window, so a genuinely unclaimed item can't silently age out of view later.
insert into pf_settings (key, value) values ('claims_start_date', '2026-06-21') on conflict (key) do nothing;

create or replace function pf_claims_start() returns date
language sql stable security definer set search_path = public as
$$ select coalesce((select nullif(value, '')::date from pf_settings where key = 'claims_start_date'), date '1900-01-01') $$;

create or replace view pf_v_claims with (security_invoker = true) as
select t.id as txn_id, t.slip_id, t.txn_date as claim_date, coalesce(s.merchant, t.description) as description,
       -t.amount as amount, coalesce(t.claimed_on, s.claimed_on) as claimed_on, coalesce(t.repaid_on, s.repaid_on) as repaid_on
  from pf_transactions t left join pf_slips s on s.id = t.slip_id
 where t.category_id = pf_claim_category_id() and t.txn_date >= pf_claims_start()
union all
select null, s.id, coalesce(s.slip_date, s.created_at::date), s.merchant, s.total, s.claimed_on, s.repaid_on
  from pf_slips s
 where s.claimable and not exists (select 1 from pf_transactions t where t.slip_id = s.id)
   and coalesce(s.slip_date, s.created_at::date) >= pf_claims_start();

notify pgrst, 'reload schema';
