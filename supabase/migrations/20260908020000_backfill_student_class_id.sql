-- Pre-handover data repair: students registered before their class row existed were stored with
-- students.class_id = NULL (createStudent silently fell through when no class matched grade +
-- section). Every consumer that keys off class_id -- attendance rosters, homework delivery, class
-- rosters and counts -- then drops that student. Their `enrollments` rows are correct, so fees /
-- promotion / year scoping were unaffected; only class_id was missing.
--
-- This backfills class_id from the student's own grade + section, and only where that resolves to
-- exactly one class. It never overwrites a non-NULL class_id and never guesses when the match is
-- ambiguous. Idempotent (re-running changes nothing once the NULLs are filled).
--
-- The application code that let this happen is fixed in the same change set (createStudent /
-- updateStudent / promoteStudent derive class_id reliably, and DataContext self-heals a stale NULL
-- on load), so new NULLs should not appear.

update public.students s
set class_id = c.id
from public.classes c
where s.class_id is null
  and c.grade = s.grade
  and coalesce(c.section, '') = coalesce(s.section, '')
  and (
    select count(*) from public.classes c2
    where c2.grade = s.grade and coalesce(c2.section, '') = coalesce(s.section, '')
  ) = 1;
