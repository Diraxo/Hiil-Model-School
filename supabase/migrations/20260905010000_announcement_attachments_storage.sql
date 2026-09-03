-- Storage hardening, part 2 of 4: a private bucket for announcement attachments.
--
-- BACKGROUND. Announcements carry one optional attachment (an image or a PDF). Until now the file
-- was base64-encoded and stuffed into `announcements.attachment_url` as JSON
-- (`{type,name,dataUrl}`) -- the last user-uploaded file domain still doing that. This migration
-- adds a dedicated PRIVATE bucket; the frontend now uploads the bytes here and stores only
-- `{type,name,path}` JSON in the column.
--
-- Object path convention:  announcement-attachments/<announcement_id>/<filename>
-- (the announcement row is always created first, then the file uploaded, then the column set.)
--
-- ACCESS MODEL -- mirrors the `announcements` table RLS exactly, reusing it rather than
-- re-deriving the audience match:
--   read   : anyone who can SELECT the owning announcement row (Owner/Educational Director see
--            all; an author sees their own; everyone else sees a live row whose audience matches
--            their role/grade/section/user id). `can_view_announcement()` is SECURITY INVOKER, so
--            the announcements RLS policy does the work.
--   write  : the announcement's author, or Owner/Educational Director -- mirrors
--            announcements_insert / announcements_delete. (Finance can author announcements, and
--            reaches its own via the author branch.)
-- There is deliberately NO update policy: a replaced attachment is delete-then-add, same as the
-- other file buckets, so a stale object can never silently shadow a new one.

-- Take the folder segment as text (never cast to uuid in the policy -- a malformed path would
-- raise instead of failing closed). A NULL / unmatched id simply yields no row -> false.
create or replace function public.can_view_announcement(p_id text)
  returns boolean
  language sql
  stable
  security invoker
  set search_path = public
as $$
  select exists (select 1 from public.announcements where id::text = p_id);
$$;

create or replace function public.can_edit_announcement(p_id text)
  returns boolean
  language sql
  stable
  security invoker
  set search_path = public
as $$
  select exists (
    select 1 from public.announcements
    where id::text = p_id and (author_id = auth.uid() or public.is_owner_or_admin())
  );
$$;

revoke all on function public.can_view_announcement(text) from public;
revoke all on function public.can_edit_announcement(text) from public;
grant execute on function public.can_view_announcement(text) to authenticated;
grant execute on function public.can_edit_announcement(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'announcement-attachments', 'announcement-attachments', false, 20 * 1024 * 1024,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf']
)
on conflict (id) do nothing;

drop policy if exists "announcement_attachments_read"   on storage.objects;
drop policy if exists "announcement_attachments_insert" on storage.objects;
drop policy if exists "announcement_attachments_delete" on storage.objects;

create policy "announcement_attachments_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'announcement-attachments'
    and public.can_view_announcement((storage.foldername(name))[1])
  );

create policy "announcement_attachments_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'announcement-attachments'
    and public.can_edit_announcement((storage.foldername(name))[1])
  );

create policy "announcement_attachments_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'announcement-attachments'
    and public.can_edit_announcement((storage.foldername(name))[1])
  );
