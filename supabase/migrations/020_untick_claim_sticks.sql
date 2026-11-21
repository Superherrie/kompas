-- 21 Nov 2026: un-ticking "claim back from work" did nothing on a line that a RULE had put in Work expenses > To claim back
-- ("Vodacom Bundles Johannes": keyword rule vodacom → to claim back). With no earlier category to go back to, the
-- un-tick asked the categoriser again, and the same rule sent the line straight back to "to claim".
--   * the categoriser can now be told to leave one category out (pf_categorise_skip); pf_categorise is the same logic
--     with nothing left out
--   * un-ticking uses the best category that is NOT "to claim back" and locks it, so the next mail or statement load
--     cannot flag the line again
--   * Vodacom bundles are bought privately (Home > Telco / Data, as before Sept 2026); only the monthly Vodacom debit
--     order is claimed from work
-- APPLY ORDER: after 016 (replaces pf_categorise from 016) and after 008 (replaces pf_set_txn_claimable from 008).

create or replace function pf_categorise_skip(p_desc text, p_account int, p_amount numeric, p_skip int) returns int
language plpgsql stable security definer set search_path = public as $$
declare n text := pf_norm(p_desc); r int; payee text; hits int;
begin
  if n = '' then return null; end if;
  -- 1. amount-aware rules (Astron ≤ R110 = coffee)
  if p_amount is not null then
    select category_id into r from pf_amount_rules
     where n like '%' || pattern || '%' and abs(p_amount) <= max_abs and (p_skip is null or category_id <> p_skip)
     order by max_abs limit 1;
    if r is not null then return r; end if;
  end if;
  -- 2. the exact description
  select category_id into r from pf_rules
   where match = 'exact' and pattern = n and (account_id is null or account_id = p_account)
     and (p_skip is null or category_id <> p_skip)
   order by account_id nulls last limit 1;
  if r is not null then return r; end if;
  -- 3. keyword rules
  select category_id into r from pf_rules
   where match = 'contains' and n like '%' || pattern || '%' and (p_skip is null or category_id <> p_skip)
   order by length(pattern) desc limit 1;
  if r is not null then return r; end if;

  -- 4. FNB words a payment by HOW it was made; what follows is the payee
  if n ~ '^(fnbapp|internetpmt|internettrf|payshapaccount|sendmoneyapp|magtape|debicheck|scheduledtrf|scheduledpmt|fnbobpmt|fnbobcoll|rtccredit|eftpayment)' then
    payee := regexp_replace(
               regexp_replace(n, '^(fnbapp(rtc)?(payment|pmt|transfer)to|internet(pmt|trf)to|payshapaccountoffus|sendmoneyappdr|magtape(debit|credit)|debicheck(internaldo)?|scheduled(trf|pmt)to|fnbob(pmt|coll)|rtccredit|eftpayment(to|from)?)', ''),
               '[0-9].*$', '');
    -- a mail shows only the first part of the reference: accept it when it is the start of ONE known payee's rule
    if length(payee) >= 8 then
      select count(distinct category_id), min(category_id) into hits, r from pf_rules
       where match = 'contains' and pattern like payee || '%' and (p_skip is null or category_id <> p_skip);
      if hits = 1 then return r; end if;
    end if;
    return null;          -- no fuzzy matching for these: they share a long stem and nothing else
  end if;

  -- 5. card descriptions: prefix either way (bank mails truncate the merchant), then a shared 12-character stem
  select category_id into r from pf_rules
   where match in ('exact','prefix') and length(pattern) >= 8 and length(n) >= 8
     and (n like pattern || '%' or pattern like n || '%')
     and (account_id is null or account_id = p_account)
     and (p_skip is null or category_id <> p_skip)
   order by length(pattern) desc limit 1;
  if r is not null then return r; end if;
  if length(n) >= 12 then
    select category_id into r from pf_rules
     where match in ('exact','prefix') and pattern like left(n, 12) || '%'
       and (account_id is null or account_id = p_account)
       and (p_skip is null or category_id <> p_skip)
     group by category_id order by count(*) desc limit 1;
  end if;
  return r;
end $$;

-- one copy of the logic: the ordinary categoriser leaves nothing out
create or replace function pf_categorise(p_desc text, p_account int default null, p_amount numeric default null) returns int
language sql stable security definer set search_path = public as
$$ select pf_categorise_skip(p_desc, p_account, p_amount, null) $$;

create or replace function pf_set_txn_claimable(p_txn bigint, p_claimable boolean) returns void
language plpgsql security definer set search_path = public as $$
declare claim int := pf_claim_category_id();
begin
  if not (pf_is_member() or coalesce(auth.role(), '') = 'service_role') then raise exception 'not a household member'; end if;
  if p_claimable then
    update pf_transactions set prev_category_id = case when category_id = claim then prev_category_id else category_id end,
           category_id = claim, category_locked = true where id = p_txn;
  else
    -- back to where it was; a line a rule flagged has no "before", so take the best category that is not the claim one.
    -- Locked either way: "not a claim" is a decision made by hand, a later load must not undo it.
    update pf_transactions t set
           category_id = coalesce(nullif(t.prev_category_id, claim),
                                  pf_categorise_skip(t.description, t.account_id, t.amount, claim),
                                  pf_uncategorised_id(t.amount)),
           category_locked = true, prev_category_id = null, claimed_on = null, repaid_on = null
     where t.id = p_txn and t.category_id = claim;
  end if;
  update pf_slips s set claimable = p_claimable,
         claimed_on = case when p_claimable then s.claimed_on end, repaid_on = case when p_claimable then s.repaid_on end
    from pf_transactions t where t.id = p_txn and s.id = t.slip_id;
end $$;

-- Vodacom bundles are private data top-ups; the longer keyword wins over "vodacom" → to claim back
insert into pf_rules (pattern, match, category_id)
select 'vodacombundles', 'contains', c.id
  from pf_categories p join pf_categories c on c.parent_id = p.id and c.name = 'Telco / Data'
 where p.parent_id is null and p.name = 'Home'
   and not exists (select 1 from pf_rules r where r.pattern = 'vodacombundles' and r.match = 'contains');

notify pgrst, 'reload schema';
