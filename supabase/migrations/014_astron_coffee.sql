-- Astron Jukskei Park is the morning coffee stop: anything there up to ~R110 is one or two coffees (Herman, 2026-09-22);
-- larger amounts are fuel / shop. A plain description rule can't tell them apart, so the categoriser gets an
-- amount-aware rule table for such vendors.
create table if not exists pf_amount_rules (
  id serial primary key,
  pattern text not null,                        -- pf_norm()'d, matched with 'contains'
  max_abs numeric(12,2) not null,               -- applies when |amount| <= max_abs
  category_id int not null references pf_categories(id) on delete cascade,
  note text
);
alter table pf_amount_rules enable row level security;
drop policy if exists pf_amount_rules_member on pf_amount_rules;
create policy pf_amount_rules_member on pf_amount_rules for all to authenticated using (pf_is_member()) with check (pf_is_member());

insert into pf_amount_rules (pattern, max_abs, category_id, note)
select 'astron', 110, c.id, 'Astron Jukskei Park coffee (1–2 cups); more than this is fuel or the shop'
  from pf_categories c join pf_categories p on p.id = c.parent_id where p.name = 'Food and Drink' and c.name = 'Coffee'
on conflict do nothing;

-- amount-aware rules win before everything else; the plain categoriser keeps its old signature for existing callers
create or replace function pf_categorise(p_desc text, p_account int default null, p_amount numeric default null) returns int
language plpgsql stable security definer set search_path = public as $$
declare n text := pf_norm(p_desc); r int;
begin
  if n = '' then return null; end if;
  if p_amount is not null then
    select category_id into r from pf_amount_rules
     where n like '%' || pattern || '%' and abs(p_amount) <= max_abs order by max_abs limit 1;
    if r is not null then return r; end if;
  end if;
  select category_id into r from pf_rules
   where match = 'exact' and pattern = n and (account_id is null or account_id = p_account)
   order by account_id nulls last limit 1;
  if r is not null then return r; end if;
  select category_id into r from pf_rules
   where match = 'contains' and n like '%' || pattern || '%'
   order by length(pattern) desc limit 1;
  if r is not null then return r; end if;
  if n ~ '^(fnbapp|internetpmt|internettrf|payshapaccount|sendmoneyapp|magtape|debicheck|scheduledtrf|scheduledpmt|fnbobpmt|rtccredit|eftpayment)' then
    return null;
  end if;
  select category_id into r from pf_rules
   where match in ('exact','prefix') and length(pattern) >= 8 and length(n) >= 8
     and (n like pattern || '%' or pattern like n || '%')
     and (account_id is null or account_id = p_account)
   order by length(pattern) desc limit 1;
  if r is not null then return r; end if;
  if length(n) >= 12 then
    select category_id into r from pf_rules
     where match in ('exact','prefix') and pattern like left(n, 12) || '%'
       and (account_id is null or account_id = p_account)
     group by category_id order by count(*) desc limit 1;
  end if;
  return r;
end $$;
drop function if exists pf_categorise(text, int);

-- re-file the history (hand-set categories are left alone)
update pf_transactions t set category_id = r.category_id
  from pf_amount_rules r
 where t.norm like '%' || r.pattern || '%' and abs(t.amount) <= r.max_abs and t.category_id <> r.category_id and not t.category_locked;
notify pgrst, 'reload schema';
