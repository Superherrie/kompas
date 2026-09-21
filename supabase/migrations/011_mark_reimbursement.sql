-- A company payment accepted as an expense-claim refund without itemising what it paid for (older claims, items never
-- flagged). It leaves the "to match" list and stops counting as income; pf_unsettle_claims puts it back.
create or replace function pf_mark_reimbursement(p_payment bigint, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (pf_is_member() or coalesce(auth.role(), '') = 'service_role') then raise exception 'not a household member'; end if;
  update pf_transactions set
         prev_category_id = case when category_id = pf_reimbursed_category_id() then prev_category_id else category_id end,
         category_id = pf_reimbursed_category_id(), category_locked = true,
         note = coalesce(note, p_note, 'Expense claim — marked as matched by hand (not itemised)')
   where id = p_payment and amount > 0;
end $$;
notify pgrst, 'reload schema';
