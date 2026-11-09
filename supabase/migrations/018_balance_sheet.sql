-- 9 Nov 2026: a personal balance sheet. Items (what Herman owns and owes) and dated valuations for each, so the
-- sheet can be shown "as at" any date and net worth tracked over time. Bank/card accounts can link to pf_accounts.
-- APPLY ORDER: after 001 (standalone).

create table if not exists pf_balance_items (
  id serial primary key,
  name text not null,
  side text not null check (side in ('asset','liability')),
  grp text not null,                       -- Cash & bank | Investments | Retirement | Property | Vehicles | Other assets | Home loans | Vehicle finance | Cards & overdrafts | Other liabilities
  account_id int references pf_accounts(id) on delete set null,
  note text,
  sort int not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists pf_balance_values (
  id bigserial primary key,
  item_id int not null references pf_balance_items(id) on delete cascade,
  as_of date not null,
  value numeric(14,2) not null,            -- positive for both sides; the view applies the sign
  source text,                             -- where the figure came from (statement, retail value, estimate …)
  created_at timestamptz not null default now(),
  unique (item_id, as_of)
);
create index if not exists pf_balance_values_item_date on pf_balance_values (item_id, as_of desc);

alter table pf_balance_items enable row level security;
alter table pf_balance_values enable row level security;
drop policy if exists pf_balance_items_member on pf_balance_items;
create policy pf_balance_items_member on pf_balance_items for all using (pf_is_member()) with check (pf_is_member());
drop policy if exists pf_balance_values_member on pf_balance_values;
create policy pf_balance_values_member on pf_balance_values for all using (pf_is_member()) with check (pf_is_member());

-- the sheet as at a date: each active item's latest valuation on or before that date
create or replace function pf_balance_sheet(p_as_of date default current_date)
returns table (item_id int, name text, side text, grp text, sort int, note text, account_id int, as_of date, value numeric, signed numeric, source text, stale_days int)
language sql stable security invoker as $$
  select i.id, i.name, i.side, i.grp, i.sort, i.note, i.account_id, v.as_of, v.value,
         case when i.side = 'asset' then v.value else -v.value end,
         v.source, (p_as_of - v.as_of)::int
    from pf_balance_items i
    left join lateral (select * from pf_balance_values x where x.item_id = i.id and x.as_of <= p_as_of order by x.as_of desc limit 1) v on true
   where i.active
   order by i.side desc, i.sort, i.name
$$;

notify pgrst, 'reload schema';
