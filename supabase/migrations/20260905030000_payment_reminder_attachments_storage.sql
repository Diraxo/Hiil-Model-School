-- Storage hardening, part 4 of 4: move the optional payment-reminder attachment off base64.
--
-- BACKGROUND. When the Owner / Finance & Operations Director sends a payment reminder they may
-- attach one image (e.g. a bank account number or a payment QR code). `notify_payment_reminder`
-- fans the reminder out to every selected parent as one `notifications` row each, and the image
-- was copied into `notifications.image` as a base64 data URI on EVERY row -- a real
-- table-bloat problem for a wide fan-out.
--
-- This bucket stores the image once. `notifications.image` now holds the object path; the fan-out
-- RPC is unchanged (it just copies the short path string onto each row).
--
-- Object path convention:  payment-reminder-attachments/<sender_id>/<uuid>.<ext>
--
-- ACCESS MODEL:
--   read   : Owner / Finance & Operations Director (they send them), OR any parent who actually
--            has a notifications row pointing at this exact object (so a parent only ever sees the
--            image for a reminder that was genuinely sent to them).
--   write  : Owner / Finance & Operations Director only -- mirrors notify_payment_reminder's own
--            is_owner_or_finance() gate.
-- No update policy: an attachment is never edited in place.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-reminder-attachments', 'payment-reminder-attachments', false, 5 * 1024 * 1024,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

drop policy if exists "payment_reminder_attachments_read"   on storage.objects;
drop policy if exists "payment_reminder_attachments_insert" on storage.objects;
drop policy if exists "payment_reminder_attachments_delete" on storage.objects;

create policy "payment_reminder_attachments_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'payment-reminder-attachments'
    and (
      public.is_owner_or_finance()
      or exists (
        select 1 from public.notifications n
        where n.user_id = auth.uid() and n.image = storage.objects.name
      )
    )
  );

create policy "payment_reminder_attachments_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'payment-reminder-attachments' and public.is_owner_or_finance());

create policy "payment_reminder_attachments_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'payment-reminder-attachments' and public.is_owner_or_finance());
