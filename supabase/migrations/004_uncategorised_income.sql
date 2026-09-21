-- Money IN that no rule recognises must not land in the (expense, discretionary) Uncategorised bucket, where it
-- silently nets off spending (an R21k inward SWIFT made August's cumulative spend line drop). It goes to
-- Income > Uncategorised income instead, to be looked at there.
insert into pf_categories (parent_id, name, kind)
select p.id, 'Uncategorised income', 'income' from pf_categories p where p.parent_id is null and p.name = 'Income'
on conflict do nothing;

create or replace function pf_uncategorised_id(p_amount numeric default -1) returns int
language sql stable security definer set search_path = public as $$
  select c.id from pf_categories c join pf_categories p on p.id = c.parent_id
   where (p_amount > 0 and p.name = 'Income' and c.name = 'Uncategorised income')
      or (not p_amount > 0 and p.name = 'Uncategorised' and c.name = 'Uncategorised') limit 1 $$;
drop function if exists pf_uncategorised_id();

-- known credits
insert into pf_rules (pattern, match, category_id)
select v.pattern, 'contains', c.id from (values ('lottowinnings', 'Lottery Winnings'), ('inwardswift', 'Other Income')) v(pattern, sub)
  join pf_categories c on c.name = v.sub join pf_categories p on p.id = c.parent_id and p.name = 'Income'
on conflict do nothing;

-- existing rows: credits parked in Uncategorised → rule if one matches, else Uncategorised income
update pf_transactions t set category_id = coalesce(
    (select r.category_id from pf_rules r where r.match = 'contains' and t.norm like '%' || r.pattern || '%' order by length(r.pattern) desc limit 1),
    pf_uncategorised_id(1))
 where t.amount > 0 and not t.category_locked
   and t.category_id = pf_uncategorised_id(-1);
