-- Monthly budget per category (parent level), from the household budget workbook. month = 'YYYY-MM'.
-- A category's budget for a month = its row for that month, else the latest earlier row (budgets carry forward).
create table if not exists pf_budgets (
  category_id int not null references pf_categories(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  amount numeric(12,2) not null,
  note text,
  primary key (category_id, month)
);
alter table pf_budgets enable row level security;
drop policy if exists pf_budgets_member on pf_budgets;
create policy pf_budgets_member on pf_budgets for all to authenticated using (pf_is_member()) with check (pf_is_member());
revoke all on pf_budgets from anon;
notify pgrst, 'reload schema';
