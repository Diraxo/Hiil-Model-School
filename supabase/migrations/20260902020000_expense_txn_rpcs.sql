-- Phase 4 (Fees / Payments / Expenses), part 3 of 3: transactional expense RPCs + the
-- private Storage bucket for expense receipts.
--
-- expenses.total_amount is derived by the recalc_expense_total() trigger from expense_items;
-- the client must never send a total. These RPCs let Finance/Owner write an expense header +
-- all its line items (and edit / delete) in ONE transaction, with recorded_by stamped from
-- auth.uid() server-side so it can never be spoofed.
--
-- expense_no is assigned by the pre-existing assign_expense_no() BEFORE INSERT trigger.

-- =====================================================================
-- expense-receipts bucket   path: <expense_id>/<filename>
--   read/write: Owner / Finance & Operations Director only -- same boundary as expenses_select.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('expense-receipts', 'expense-receipts', false, 20 * 1024 * 1024,
     array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

drop policy if exists "expense_receipts_read"   on storage.objects;
drop policy if exists "expense_receipts_insert" on storage.objects;
drop policy if exists "expense_receipts_update" on storage.objects;
drop policy if exists "expense_receipts_delete" on storage.objects;

create policy "expense_receipts_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'expense-receipts' and public.is_owner_or_finance());
create policy "expense_receipts_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'expense-receipts' and public.is_owner_or_finance());
create policy "expense_receipts_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'expense-receipts' and public.is_owner_or_finance())
  with check (bucket_id = 'expense-receipts' and public.is_owner_or_finance());
create policy "expense_receipts_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'expense-receipts' and public.is_owner_or_finance());

-- ---------------------------------------------------------------------------------------
-- Shared helper: validate + insert the line items for an expense. Raises on bad input, so
-- the whole enclosing RPC transaction rolls back (no orphan header).
-- ---------------------------------------------------------------------------------------
create or replace function public._insert_expense_items(p_expense_id uuid, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item      jsonb;
  v_name      text;
  v_qty       numeric;
  v_price     numeric;
  v_count     integer := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'An expense needs at least one line item';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_name  := trim(coalesce(v_item ->> 'item_name', ''));
    v_qty   := (v_item ->> 'quantity')::numeric;
    v_price := (v_item ->> 'unit_price')::numeric;

    if v_name = '' then
      raise exception 'Every line item needs a name';
    end if;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Every line item needs a quantity greater than 0';
    end if;
    if v_price is null or v_price <= 0 then
      raise exception 'Every line item needs a unit price greater than 0';
    end if;

    insert into public.expense_items (expense_id, item_name, quantity, unit_price)
      values (p_expense_id, v_name, v_qty, v_price);
    v_count := v_count + 1;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- create_expense
-- ---------------------------------------------------------------------------------------
create or replace function public.create_expense(
  p_date              date,
  p_method            text,
  p_items             jsonb,
  p_purchased_by      text default null,
  p_note              text default null,
  p_receipt_image_url text default null,
  p_receipt_name      text default null,
  p_receipt_type      text default null
)
returns public.expenses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expense public.expenses;
begin
  if not public.is_owner_or_finance() then
    raise exception 'Only the Owner or Finance & Operations Director may record expenses';
  end if;
  if p_date is null then
    raise exception 'An expense date is required';
  end if;
  if coalesce(trim(p_method), '') = '' then
    raise exception 'A payment method is required';
  end if;

  insert into public.expenses
    (date, total_amount, method, purchased_by, note,
     receipt_image_url, receipt_name, receipt_type, recorded_by)
  values
    (p_date, 0, trim(p_method), nullif(trim(coalesce(p_purchased_by, '')), ''), nullif(trim(coalesce(p_note, '')), ''),
     p_receipt_image_url, p_receipt_name, p_receipt_type, auth.uid())
  returning * into v_expense;

  perform public._insert_expense_items(v_expense.id, p_items);

  -- re-read: the recalc_expense_total() trigger set total_amount from the items just inserted
  select * into v_expense from public.expenses where id = v_expense.id;
  return v_expense;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- update_expense -- replaces the header fields and the full set of line items in one txn.
-- ---------------------------------------------------------------------------------------
create or replace function public.update_expense(
  p_id                uuid,
  p_date              date,
  p_method            text,
  p_items             jsonb,
  p_purchased_by      text default null,
  p_note              text default null,
  p_receipt_image_url text default null,
  p_receipt_name      text default null,
  p_receipt_type      text default null
)
returns public.expenses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expense public.expenses;
begin
  if not public.is_owner_or_finance() then
    raise exception 'Only the Owner or Finance & Operations Director may edit expenses';
  end if;

  select * into v_expense from public.expenses where id = p_id for update;
  if v_expense.id is null then
    raise exception 'Expense % not found', p_id;
  end if;
  if p_date is null then
    raise exception 'An expense date is required';
  end if;
  if coalesce(trim(p_method), '') = '' then
    raise exception 'A payment method is required';
  end if;

  update public.expenses set
    date              = p_date,
    method            = trim(p_method),
    purchased_by      = nullif(trim(coalesce(p_purchased_by, '')), ''),
    note              = nullif(trim(coalesce(p_note, '')), ''),
    receipt_image_url = p_receipt_image_url,
    receipt_name      = p_receipt_name,
    receipt_type      = p_receipt_type
  where id = p_id;

  delete from public.expense_items where expense_id = p_id;
  perform public._insert_expense_items(p_id, p_items);

  select * into v_expense from public.expenses where id = p_id;
  return v_expense;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- delete_expense
-- ---------------------------------------------------------------------------------------
create or replace function public.delete_expense(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner_or_finance() then
    raise exception 'Only the Owner or Finance & Operations Director may delete expenses';
  end if;
  -- expense_items rows cascade on the FK; a Storage receipt object (if any) is cleaned up
  -- client-side before this call.
  delete from public.expenses where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------------------
revoke all on function public._insert_expense_items(uuid, jsonb) from public;
revoke all on function public.create_expense(date, text, jsonb, text, text, text, text, text) from public;
revoke all on function public.update_expense(uuid, date, text, jsonb, text, text, text, text, text) from public;
revoke all on function public.delete_expense(uuid) from public;

grant execute on function public.create_expense(date, text, jsonb, text, text, text, text, text) to authenticated;
grant execute on function public.update_expense(uuid, date, text, jsonb, text, text, text, text, text) to authenticated;
grant execute on function public.delete_expense(uuid) to authenticated;
-- _insert_expense_items is an internal helper -- NOT granted to authenticated; only the
-- SECURITY DEFINER RPCs above (which run as the definer) may call it.
