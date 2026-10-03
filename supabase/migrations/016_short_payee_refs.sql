-- 3 Oct 2026: FNB's inContact mails cut the payee reference short — the statement says
-- "FNB App Payment To Levies Riverglades Rgs0369B", the mail only "…Levies Riverglades". The payee rules learned from
-- statements (012) were therefore LONGER than the mail text and never matched: levies, Eagle Reef levy, the school
-- sponsorships and others landed in Uncategorised.
--   * the categoriser now also accepts a mail payee that is the START of a known payee rule (when that points to one
--     category only)
--   * keyword rules for payees whose statement wording differs altogether (Ninety One, salary, NSRI, Netflix, Airbnb)
-- APPLY ORDER: after 014 (this replaces pf_categorise from 014).

create or replace function pf_categorise(p_desc text, p_account int default null, p_amount numeric default null) returns int
language plpgsql stable security definer set search_path = public as $$
declare n text := pf_norm(p_desc); r int; payee text; hits int;
begin
  if n = '' then return null; end if;
  -- 1. amount-aware rules (Astron ≤ R110 = coffee)
  if p_amount is not null then
    select category_id into r from pf_amount_rules
     where n like '%' || pattern || '%' and abs(p_amount) <= max_abs order by max_abs limit 1;
    if r is not null then return r; end if;
  end if;
  -- 2. the exact description
  select category_id into r from pf_rules
   where match = 'exact' and pattern = n and (account_id is null or account_id = p_account)
   order by account_id nulls last limit 1;
  if r is not null then return r; end if;
  -- 3. keyword rules
  select category_id into r from pf_rules
   where match = 'contains' and n like '%' || pattern || '%'
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
       where match = 'contains' and pattern like payee || '%';
      if hits = 1 then return r; end if;
    end if;
    return null;          -- no fuzzy matching for these: they share a long stem and nothing else
  end if;

  -- 5. card descriptions: prefix either way (bank mails truncate the merchant), then a shared 12-character stem
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

-- keyword rules: (pattern, parent category, sub-category)
insert into pf_rules (pattern, match, category_id)
select v.pattern, 'contains', c.id
  from (values
    ('ninetyone',      'External Savings and Investments', 'Investments'),
    ('salary2533',     'Income',                           'Salary'),
    ('nsri',           'Miscellaneous',                    'Donations'),
    ('netflix',        'Recreation',                       'TV'),
    ('airbnb',         'Recreation',                       'Accommodation'),
    ('intlpaymentfee', 'Fees and Interest',                'Bank Fees')
  ) v(pattern, cat, sub)
  join pf_categories p on p.parent_id is null and p.name = v.cat
  join pf_categories c on c.parent_id = p.id and c.name = v.sub
 where not exists (select 1 from pf_rules r where r.pattern = v.pattern and r.match = 'contains');

-- money in that the mail parser labelled "Magtape Debit" is a credit
update pf_transactions set description = regexp_replace(description, '^Magtape Debit', 'Magtape Credit')
 where amount > 0 and description like 'Magtape Debit%';

-- re-file what is sitting in the two Uncategorised buckets (never a category set by hand)
update pf_transactions t set category_id = c.new_cat
  from (select id, pf_categorise(description, account_id, amount) as new_cat from pf_transactions
         where not category_locked and category_id in (pf_uncategorised_id(-1), pf_uncategorised_id(1))) c
 where c.id = t.id and c.new_cat is not null;

notify pgrst, 'reload schema';

-- two more that need no judgement
insert into pf_rules (pattern, match, category_id)
select v.pattern, 'contains', c.id
  from (values ('lottopurchase', 'Miscellaneous', 'Lottery'), ('powerballpurchase', 'Miscellaneous', 'Lottery'), ('returneddebitorderfee', 'Fees and Interest', 'Bank Fees')) v(pattern, cat, sub)
  join pf_categories p on p.parent_id is null and p.name = v.cat
  join pf_categories c on c.parent_id = p.id and c.name = v.sub
 where not exists (select 1 from pf_rules r where r.pattern = v.pattern and r.match = 'contains');
update pf_transactions t set category_id = c.new_cat
  from (select id, pf_categorise(description, account_id, amount) as new_cat from pf_transactions
         where not category_locked and category_id in (pf_uncategorised_id(-1), pf_uncategorised_id(1))) c
 where c.id = t.id and c.new_cat is not null;
