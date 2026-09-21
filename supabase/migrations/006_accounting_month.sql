-- Accounting month. Salary lands on the last working day and the big month-end payments (alimony, bond, telco,
-- charity) go off with it — all of that is NEXT month's money. So on accounts flagged month_end_shift (FNB),
-- transactions from the cut-off day onward are reported in the following month.
--   cut-off day = the earlier of pf_settings.month_end_cutoff_day (default 27) and that month's payday (salary dated >= 15th)
--   pf_transactions.period = 'YYYY-MM' when it differs from the calendar month; period_locked = set by hand, never recomputed
alter table pf_accounts add column if not exists month_end_shift boolean not null default false;
alter table pf_transactions add column if not exists period text check (period ~ '^\d{4}-\d{2}$');
alter table pf_transactions add column if not exists period_locked boolean not null default false;
update pf_accounts set month_end_shift = true where name = 'FNB';
insert into pf_settings (key, value) values ('month_end_cutoff_day', '27') on conflict (key) do nothing;

create or replace function pf_assign_periods(p_from date default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int; cut int := coalesce((select nullif(value, '')::int from pf_settings where key = 'month_end_cutoff_day'), 27);
begin
  -- session_user = 'postgres' is the migration runner (no JWT); PostgREST callers arrive as 'authenticator'
  if not (pf_is_member() or coalesce(auth.role(), '') = 'service_role' or session_user = 'postgres') then raise exception 'not a household member'; end if;
  with payday as (                                   -- first salary of each calendar month that lands in its second half
    select date_trunc('month', t.txn_date)::date as m, min(extract(day from t.txn_date))::int as d
      from pf_transactions t join pf_categories c on c.id = t.category_id
     where c.name = 'Salary' and c.kind = 'income' and extract(day from t.txn_date) >= 15
     group by 1),
  want as (
    select t.id,
           case when a.month_end_shift and cut between 1 and 31
                 and extract(day from t.txn_date) >= least(cut, coalesce(p.d, 99))
                then to_char(t.txn_date + interval '1 month', 'YYYY-MM') end as period
      from pf_transactions t join pf_accounts a on a.id = t.account_id
      left join payday p on p.m = date_trunc('month', t.txn_date)::date
     where not t.period_locked and (p_from is null or t.txn_date >= p_from))
  update pf_transactions t set period = w.period from want w where w.id = t.id and t.period is distinct from w.period;
  get diagnostics n = row_count;
  return n;
end $$;

-- by hand: p_period null = back to the calendar month (locked there); 'auto' = hand it back to the rule
create or replace function pf_set_period(p_txn bigint, p_period text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not pf_is_member() then raise exception 'not a household member'; end if;
  if p_period = 'auto' then
    update pf_transactions set period_locked = false where id = p_txn;
    perform pf_assign_periods((select txn_date from pf_transactions where id = p_txn));
  else
    update pf_transactions set period_locked = true,
           period = case when p_period = to_char(txn_date, 'YYYY-MM') then null else p_period end where id = p_txn;
  end if;
end $$;

-- reporting: "month" is now the accounting month; cal_month keeps the calendar one
create or replace view pf_v_txns with (security_invoker = true) as
select t.id, t.txn_date, t.txn_time, coalesce(t.period, to_char(t.txn_date, 'YYYY-MM')) as month, t.description, t.amount,
       t.source, t.status, t.slip_id, t.note, t.balance_after, t.category_locked,
       a.id as account_id, a.name as account,
       s.id as sub_id, s.name as sub_name, c.id as cat_id, c.name as cat_name,
       coalesce(s.kind, 'expense') as kind, coalesce(s.discretionary, false) as discretionary,
       coalesce(s.color, c.color) as color,
       to_char(t.txn_date, 'YYYY-MM') as cal_month, t.period_locked
  from pf_transactions t
  join pf_accounts a on a.id = t.account_id
  left join pf_categories s on s.id = t.category_id
  left join pf_categories c on c.id = s.parent_id;

select pf_assign_periods();
notify pgrst, 'reload schema';
