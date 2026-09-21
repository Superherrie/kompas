-- Kompas — personal finance tracker. Lives in the shared Supabase project, every object prefixed pf_.
-- The project's auth.users also holds work logins, so NOTHING here is open to "authenticated":
-- every policy goes through pf_is_member() (the household list).

create table if not exists pf_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  email text,
  role text not null default 'member' check (role in ('owner','member')),
  created_at timestamptz not null default now()
);

create or replace function pf_is_member() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from pf_members where user_id = auth.uid()) $$;

create or replace function pf_is_owner() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from pf_members where user_id = auth.uid() and role = 'owner') $$;

create or replace function pf_norm(t text) returns text
language sql immutable as $$ select regexp_replace(lower(coalesce(t,'')), '[^a-z0-9]', '', 'g') $$;

create table if not exists pf_accounts (
  id serial primary key,
  name text not null unique,              -- 'FNB', 'Discovery'
  bank text,
  purpose text,                           -- 'Salary & monthly payments' / 'Daily spend'
  card_last4 text[] not null default '{}',
  color text,
  sort int not null default 0
);

-- two levels: parent_id null = category, otherwise sub-category. Transactions point at the sub-category.
create table if not exists pf_categories (
  id serial primary key,
  parent_id int references pf_categories(id) on delete cascade,
  name text not null,
  kind text not null default 'expense' check (kind in ('expense','income','transfer')),
  discretionary boolean not null default false,
  color text,
  icon text,
  budget numeric(12,2),                   -- monthly budget (sub-category level)
  sort int not null default 0
);
create unique index if not exists pf_categories_uq on pf_categories (coalesce(parent_id,0), name);

create table if not exists pf_slips (
  id bigserial primary key,
  image_path text,                        -- storage: pf-slips/<path>
  merchant text,
  slip_date date,
  slip_time time,
  total numeric(12,2),
  vat numeric(12,2),
  payment_method text,
  card_last4 text,
  items jsonb not null default '[]',      -- [{name, qty, amount}]
  raw jsonb,
  status text not null default 'new' check (status in ('new','matched','unmatched','failed')),
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists pf_transactions (
  id bigserial primary key,
  account_id int not null references pf_accounts(id),
  txn_date date not null,
  txn_time time,
  description text not null,
  norm text generated always as (pf_norm(description)) stored,
  amount numeric(12,2) not null,          -- negative = money out
  category_id int references pf_categories(id) on delete set null,
  category_locked boolean not null default false,   -- set by a person: imports never overwrite it
  source text not null default 'statement' check (source in ('statement','email','slip','manual','seed')),
  source_ref text,                        -- e-mail internetMessageId etc. (dedupe)
  status text not null default 'cleared' check (status in ('pending','cleared')),
  balance_after numeric(12,2),
  slip_id bigint references pf_slips(id) on delete set null,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index if not exists pf_txn_source_ref_uq on pf_transactions (source_ref) where source_ref is not null;
create index if not exists pf_txn_date_ix on pf_transactions (txn_date desc);
create index if not exists pf_txn_cat_ix on pf_transactions (category_id, txn_date);
create index if not exists pf_txn_match_ix on pf_transactions (account_id, amount, txn_date);

-- learned description -> category. 'exact' = whole normalised description, 'prefix' = starts with.
create table if not exists pf_rules (
  id serial primary key,
  pattern text not null,                  -- pf_norm()'d
  match text not null default 'exact' check (match in ('exact','prefix','contains')),
  account_id int references pf_accounts(id) on delete cascade,
  category_id int not null references pf_categories(id) on delete cascade,
  created_at timestamptz not null default now()
);
create unique index if not exists pf_rules_uq on pf_rules (pattern, match, coalesce(account_id,0));
create index if not exists pf_rules_pat_ix on pf_rules (pattern text_pattern_ops);

create table if not exists pf_settings (key text primary key, value text);

create table if not exists pf_sync_log (
  id bigserial primary key,
  source text not null,
  received int not null default 0,
  inserted int not null default 0,
  note text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- categorise
-- exact rule -> longest prefix rule either way round (bank e-mails truncate the merchant) -> contains rule
create or replace function pf_categorise(p_desc text, p_account int default null) returns int
language plpgsql stable security definer set search_path = public as $$
declare n text := pf_norm(p_desc); r int;
begin
  if n = '' then return null; end if;
  select category_id into r from pf_rules
   where match = 'exact' and pattern = n and (account_id is null or account_id = p_account)
   order by account_id nulls last limit 1;
  if r is not null then return r; end if;
  select category_id into r from pf_rules
   where match in ('exact','prefix') and length(pattern) >= 8 and length(n) >= 8
     and (n like pattern || '%' or pattern like n || '%')
     and (account_id is null or account_id = p_account)
   order by length(pattern) desc limit 1;
  if r is not null then return r; end if;
  -- shorter shared stem: first 12 characters (e.g. 'liquorshopjukskei…' vs another branch reference)
  if length(n) >= 12 then
    select category_id into r from pf_rules
     where match in ('exact','prefix') and pattern like left(n, 12) || '%'
       and (account_id is null or account_id = p_account)
     group by category_id order by count(*) desc limit 1;
    if r is not null then return r; end if;
  end if;
  select category_id into r from pf_rules
   where match = 'contains' and n like '%' || pattern || '%'
   order by length(pattern) desc limit 1;
  return r;
end $$;

-- fallback bucket: unrecognised money OUT → Uncategorised (expense); unrecognised money IN → Income > Uncategorised income
-- (a credit parked in an expense bucket would silently net off spending)
create or replace function pf_uncategorised_id(p_amount numeric default -1) returns int
language sql stable security definer set search_path = public as $$
  select c.id from pf_categories c join pf_categories p on p.id = c.parent_id
   where (p_amount > 0 and p.name = 'Income' and c.name = 'Uncategorised income')
      or (not p_amount > 0 and p.name = 'Uncategorised' and c.name = 'Uncategorised') limit 1 $$;

-- ---------------------------------------------------------------- import
-- p_rows: [{date, time?, description, amount, balance?, ref?}]
-- p_source 'statement': clears matching pending e-mail/slip/manual rows instead of duplicating them.
-- p_source 'email'/'manual': inserted as pending, skipped when already there (source_ref or same statement line).
create or replace function pf_import_txns(p_account text, p_source text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  acc int; r jsonb; d date; t time; a numeric; ds text; n40 text; hit bigint; cat int;
  ins int := 0; skipped int := 0; cleared int := 0;
begin
  if not (pf_is_member() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'not a household member';
  end if;
  select id into acc from pf_accounts where lower(name) = lower(p_account);
  if acc is null then raise exception 'unknown account %', p_account; end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    d := (r->>'date')::date; t := nullif(r->>'time','')::time;
    a := round((r->>'amount')::numeric, 2); ds := trim(r->>'description');
    n40 := left(pf_norm(ds), 40);

    if r->>'ref' is not null and exists (select 1 from pf_transactions where source_ref = r->>'ref') then
      skipped := skipped + 1; continue;
    end if;

    -- same line already loaded from a statement (or the seed)?
    select id into hit from pf_transactions x
     where x.account_id = acc and x.txn_date = d and x.amount = a and x.status = 'cleared'
       and (left(x.norm, 40) = n40 or (p_source <> 'statement' and (x.norm like n40 || '%' or n40 like left(x.norm, 12) || '%')))
       and (x.txn_time is null or t is null or date_trunc('minute', x.txn_time) = date_trunc('minute', t))
     limit 1;
    if hit is not null then
      update pf_transactions set txn_time = coalesce(txn_time, t) where id = hit;
      skipped := skipped + 1; continue;
    end if;

    if p_source = 'statement' then
      -- a pending row (bank e-mail, slip, manual) for the same money: card lines post up to a few days later
      select id into hit from pf_transactions x
       where x.account_id = acc and x.amount = a and x.status = 'pending'
         and x.txn_date between d - 5 and d + 1
       order by abs(x.txn_date - d), (left(x.norm, 8) = left(n40, 8)) desc limit 1;
      if hit is not null then
        update pf_transactions x set status = 'cleared', description = ds,
               txn_time = coalesce(x.txn_time, t),
               category_id = case when x.category_locked or x.category_id is distinct from pf_uncategorised_id(a)
                                  then x.category_id else coalesce(pf_categorise(ds, acc), x.category_id) end
         where id = hit;
        cleared := cleared + 1; continue;
      end if;
    end if;

    if p_source = 'email' then
      -- the slip photo (or a manual entry) got there first: the bank mail adopts that line instead of adding a second one
      select id into hit from pf_transactions x
       where x.account_id = acc and x.amount = a and x.status = 'pending' and x.source in ('slip','manual')
         and x.source_ref is null and x.txn_date between d - 1 and d + 1
       order by abs(x.txn_date - d) limit 1;
      if hit is not null then
        update pf_transactions set source_ref = r->>'ref', txn_time = coalesce(t, txn_time),
               balance_after = nullif(r->>'balance','')::numeric where id = hit;
        skipped := skipped + 1; continue;
      end if;
    end if;

    cat := coalesce(pf_categorise(ds, acc), nullif(r->>'category_id','')::int, pf_uncategorised_id(a));
    insert into pf_transactions (account_id, txn_date, txn_time, description, amount, category_id, source, source_ref, status, balance_after)
    values (acc, d, t, ds, a, cat, p_source, r->>'ref',
            case when p_source = 'statement' then 'cleared' else 'pending' end,
            nullif(r->>'balance','')::numeric);
    ins := ins + 1;
  end loop;

  -- new bank lines may be the payment an earlier, still unmatched slip was waiting for
  perform pf_match_slip(sl.id) from pf_slips sl where sl.status = 'unmatched' and sl.created_at > now() - interval '180 days';

  insert into pf_sync_log (source, received, inserted, note)
  values (p_source || ':' || p_account, jsonb_array_length(p_rows), ins, format('%s cleared, %s skipped', cleared, skipped));
  return jsonb_build_object('inserted', ins, 'cleared', cleared, 'skipped', skipped);
end $$;

-- set a category; optionally remember it for every transaction with the same description
create or replace function pf_set_category(p_txn bigint, p_category int, p_remember boolean default true)
returns int language plpgsql security definer set search_path = public as $$
declare n text; acc int; cnt int := 1;
begin
  if not pf_is_member() then raise exception 'not a household member'; end if;
  update pf_transactions set category_id = p_category, category_locked = true where id = p_txn
  returning norm, account_id into n, acc;
  if p_remember and n <> '' then
    insert into pf_rules (pattern, match, account_id, category_id) values (n, 'exact', null, p_category)
    on conflict (pattern, match, coalesce(account_id,0)) do update set category_id = excluded.category_id;
    update pf_transactions set category_id = p_category
     where norm = n and id <> p_txn and not category_locked;
    get diagnostics cnt = row_count; cnt := cnt + 1;
  end if;
  return cnt;
end $$;

-- pf_match_slip / pf_find_payment: see 005_slip_tip_and_history.sql

create or replace function pf_add_member(p_email text, p_name text) returns text
language plpgsql security definer set search_path = public, auth as $$
declare u uuid;
begin
  if not pf_is_owner() then raise exception 'only the owner can add household members'; end if;
  select id into u from auth.users where lower(email) = lower(trim(p_email));
  if u is null then return 'no-login'; end if;
  insert into pf_members (user_id, display_name, email) values (u, p_name, lower(trim(p_email)))
  on conflict (user_id) do update set display_name = excluded.display_name;
  return 'added';
end $$;

-- ---------------------------------------------------------------- reporting view
create or replace view pf_v_txns with (security_invoker = true) as
select t.id, t.txn_date, t.txn_time, to_char(t.txn_date, 'YYYY-MM') as month, t.description, t.amount,
       t.source, t.status, t.slip_id, t.note, t.balance_after, t.category_locked,
       a.id as account_id, a.name as account,
       s.id as sub_id, s.name as sub_name, c.id as cat_id, c.name as cat_name,
       coalesce(s.kind, 'expense') as kind, coalesce(s.discretionary, false) as discretionary,
       coalesce(s.color, c.color) as color
  from pf_transactions t
  join pf_accounts a on a.id = t.account_id
  left join pf_categories s on s.id = t.category_id
  left join pf_categories c on c.id = s.parent_id;

-- monthly totals per sub-category (keeps dashboards off the raw table)
create or replace view pf_v_monthly with (security_invoker = true) as
select month, cat_id, cat_name, sub_id, sub_name, kind, discretionary, color, account,
       sum(amount) as total, count(*) as n
  from pf_v_txns group by 1,2,3,4,5,6,7,8,9;

-- ---------------------------------------------------------------- RLS
do $$ declare t text; begin
  foreach t in array array['pf_accounts','pf_categories','pf_slips','pf_transactions','pf_rules','pf_settings','pf_sync_log'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_member', t);
    execute format('create policy %I on %I for all to authenticated using (pf_is_member()) with check (pf_is_member())', t || '_member', t);
  end loop;
end $$;
alter table pf_members enable row level security;
drop policy if exists pf_members_read on pf_members;
create policy pf_members_read on pf_members for select to authenticated using (pf_is_member());
drop policy if exists pf_members_write on pf_members;
create policy pf_members_write on pf_members for all to authenticated using (pf_is_owner()) with check (pf_is_owner());

revoke all on pf_members, pf_accounts, pf_categories, pf_slips, pf_transactions, pf_rules, pf_settings, pf_sync_log from anon;

-- ---------------------------------------------------------------- slip photos (private bucket)
insert into storage.buckets (id, name, public) values ('pf-slips', 'pf-slips', false) on conflict (id) do nothing;
drop policy if exists pf_slips_objects on storage.objects;
create policy pf_slips_objects on storage.objects for all to authenticated
  using (bucket_id = 'pf-slips' and pf_is_member()) with check (bucket_id = 'pf-slips' and pf_is_member());
