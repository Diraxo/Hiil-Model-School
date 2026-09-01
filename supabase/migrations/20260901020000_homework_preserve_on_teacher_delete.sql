-- Phase 3, pre-checkpoint-2 fix: deleting a Teacher account must NOT erase the homework they
-- assigned. Old homework is part of a student's academic history and should survive the teacher's
-- departure, exactly as their results and behaviour records already do.
--
-- Before this migration, homework.teacher_id was `not null references profiles(id) on delete
-- cascade`, so `auth.admin.deleteUser()` (manage-staff-account Edge Function) -> profiles cascade
-- -> homework cascade wiped every row the teacher ever created. The DataContext.deleteTeacher
-- comment already claimed the rows were "left as historical records" -- the schema disagreed. This
-- makes the schema match the intent.
--
-- Changes:
--   1. teacher_name  -- a text snapshot of the assigning teacher's name, captured at creation, so
--      the "Teacher" line on a homework card/detail still reads correctly after the account is
--      gone. Live rows keep resolving the name from profiles via teacher_id; the snapshot is only
--      the fallback once teacher_id goes null.
--   2. teacher_id  -- now nullable, FK behaviour ON DELETE CASCADE -> ON DELETE SET NULL.
--
-- RLS is unchanged and NOT weakened: homework_select still shows a null-teacher row to Owner/
-- Educational Director, to any teacher who currently teaches that class+subject, and to the class's
-- parents; homework_update / homework_delete still gate the teacher branch on
-- `teacher_id = auth.uid()`, which a null simply never satisfies -- a departed teacher's homework
-- becomes an Owner/Director-only historical record, which is the desired outcome.

alter table public.homework
  add column if not exists teacher_name text;

-- Backfill the snapshot for every existing row from the current profile.
update public.homework h
set teacher_name = p.full_name
from public.profiles p
where p.id = h.teacher_id
  and h.teacher_name is null;

alter table public.homework
  alter column teacher_id drop not null;

alter table public.homework
  drop constraint if exists homework_teacher_id_fkey;

alter table public.homework
  add constraint homework_teacher_id_fkey
  foreign key (teacher_id) references public.profiles (id) on delete set null;

comment on column public.homework.teacher_name is
  'Snapshot of the assigning teacher''s name at creation time. Fallback for display after the '
  'teacher_id profile is deleted (ON DELETE SET NULL) -- live rows still resolve via teacher_id.';
