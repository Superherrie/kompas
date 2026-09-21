-- Keyword rules for FNB payees, learned from the history.
-- A statement says "Payshap Account Off-Us Alois" where the inContact mail says "… Ref.Alois" — the payee is the only
-- stable part. For every FNB description that starts with the bank's "how it was paid" wording, take what follows
-- (up to the first digit = the changing reference), and where that payee has only ever had ONE category, remember it.
with payee as (
  select regexp_replace(
           regexp_replace(t.norm, '^(fnbapp(rtc)?(payment|pmt|transfer)to|internet(pmt|trf)to|payshapaccountoffus|sendmoneyappdr|magtape(debit|credit)|debicheck(internaldo)?|scheduled(trf|pmt)to)', ''),
           '[0-9].*$', '') as p,
         t.category_id
    from pf_transactions t join pf_accounts a on a.id = t.account_id
   where a.name = 'FNB' and t.source in ('seed', 'statement')
     and t.norm ~ '^(fnbapp|internetpmt|internettrf|payshapaccount|sendmoneyapp|magtape|debicheck|scheduledtrf|scheduledpmt)'
     and t.category_id is not null and t.category_id <> pf_uncategorised_id(-1)),
one as (
  select p, min(category_id) as category_id from payee
   where length(p) >= 5 group by p having count(distinct category_id) = 1 and count(*) >= 2)
insert into pf_rules (pattern, match, category_id)
select p, 'contains', category_id from one
on conflict do nothing;

-- the scheduled transfer to the children's notice account = the family allowance
insert into pf_rules (pattern, match, category_id)
select 'noticeac218933', 'contains', c.id from pf_categories c join pf_categories p on p.id = c.parent_id
 where p.name = 'Personal Allowances' and c.name = 'Family Allowances'
on conflict do nothing;

-- re-file e-mail lines that were categorised before these rules existed (never touches a category set by hand)
update pf_transactions t set category_id = coalesce(pf_categorise(t.description, t.account_id), pf_uncategorised_id(t.amount))
 where t.source = 'email' and t.status = 'pending' and not t.category_locked;
