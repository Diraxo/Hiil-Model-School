-- BLOCKER 8 — repair the visible Student ID sequence.
--
-- Root cause: generate_student_id() draws from public.student_number_seq, which is never rolled
-- back. Test/duplicate students that were registered and later deleted (ZZ Test*, ZZDELETE Spot
-- Check, and re-registered duplicates) each burned a number, so the 90 real students sit at
-- TMA-2026-00004 .. TMA-2026-00103 (13 numbers missing: 1,2,3,6,25,30,32-38) and the sequence
-- stood at 103. No test student rows remain in public.students — nothing is deleted here.
--
-- What this does (all-or-nothing: a single DO block, any failed assertion rolls everything back):
--   1. Renumbers the visible code students.student_id to 00001..000NN in registration order
--      (created_at, then old code — identical to the existing ID order, so relative order is
--      preserved). Only the text code changes; students.id (UUID) and every foreign key
--      (10 tables, all keyed on students.id) are untouched. Two phases via unique RENUM-<uuid>
--      placeholders so the UNIQUE(student_id) constraint is never violated mid-way.
--   2. Rewrites the code inside public.activities feed text ("... was added to Grade 9A (TMA-...)")
--      — the only other place the code is copied. Feed lines whose code belongs to an already
--      removed record are labelled "former ID ..." so they can't be mistaken for the new owner
--      of that number.
--   3. Resyncs the sequence to the highest assigned number, so the next registration gets
--      max + 1 (TMA-2026-00091 for 90 students). setval is last, after every assertion.
--
-- students.updated_at is deliberately preserved (its trigger is suspended for this statement only).
-- Idempotent: on an already-sequential table it changes nothing except re-pinning the sequence.

do $$
declare
  v_n        int;
  v_max      int;
  v_changed  int;
begin
  select count(*) into v_n from public.students;
  if v_n = 0 then
    return;
  end if;

  if exists (select 1 from public.students where student_id !~ '^TMA-[0-9]{4}-[0-9]+$') then
    raise exception 'Student ID repair aborted: unexpected non-standard student_id present';
  end if;
  if (select count(distinct substring(student_id from '^TMA-([0-9]{4})-')) from public.students) <> 1 then
    raise exception 'Student ID repair aborted: more than one year prefix present';
  end if;
  if exists (select 1 from public.activities
             where array_length(regexp_split_to_array(text, 'TMA-[0-9]{4}-[0-9]+'), 1) > 2) then
    raise exception 'Student ID repair aborted: an activity line carries more than one student code';
  end if;

  create temp table _sid_map on commit drop as
  select id,
         student_id as old_id,
         'TMA-' || substring(student_id from '^TMA-([0-9]{4})-') || '-'
           || lpad((row_number() over (order by created_at, student_id))::text, 5, '0') as new_id
  from public.students;

  select count(*) into v_changed from _sid_map where old_id <> new_id;

  if v_changed > 0 then
    alter table public.students disable trigger students_set_updated_at;

    -- Phase 1: park every affected row on a value that can never collide with a real code.
    update public.students s
       set student_id = 'RENUM-' || s.id::text
      from _sid_map m
     where m.id = s.id and m.old_id <> m.new_id;

    -- Phase 2: assign the final codes.
    update public.students s
       set student_id = m.new_id
      from _sid_map m
     where m.id = s.id and m.old_id <> m.new_id;

    alter table public.students enable trigger students_set_updated_at;

    -- Activity feed, part A: lines about records that no longer exist (code not held by any
    -- current student) — keep the history but mark the number as retired.
    update public.activities a
       set text = regexp_replace(a.text, '(TMA-[0-9]{4}-[0-9]+)', 'former ID \1')
     where a.text ~ 'TMA-[0-9]{4}-[0-9]+'
       and not exists (select 1 from _sid_map m where a.text like '%' || m.old_id || '%');

    -- Activity feed, part B: lines about current students follow their new code
    -- (one code per line was asserted above, so each line matches at most one mapping row).
    update public.activities a
       set text = replace(a.text, m.old_id, m.new_id)
      from _sid_map m
     where m.old_id <> m.new_id
       and a.text like '%' || m.old_id || '%';
  end if;

  -- ---- invariants: any failure aborts and rolls back everything above ----
  if (select count(*) from public.students) <> v_n then
    raise exception 'Student ID repair failed: student count changed';
  end if;
  if (select count(distinct student_id) from public.students) <> v_n then
    raise exception 'Student ID repair failed: duplicate student_id';
  end if;
  if exists (select 1 from public.students where student_id !~ '^TMA-[0-9]{4}-[0-9]{5}$') then
    raise exception 'Student ID repair failed: placeholder or malformed student_id left behind';
  end if;
  select max(substring(student_id from '([0-9]+)$')::int) into v_max from public.students;
  if v_max <> v_n
     or (select min(substring(student_id from '([0-9]+)$')::int) from public.students) <> 1 then
    raise exception 'Student ID repair failed: codes are not exactly 1..%', v_n;
  end if;
  if exists (select 1 from _sid_map m join public.students s on s.id = m.id where s.student_id <> m.new_id) then
    raise exception 'Student ID repair failed: a student did not receive its planned code';
  end if;
  if v_changed > 0 and (
       select count(*) from public.activities a
       join public.students s on a.text like '%' || s.student_id || '%'
                             and a.text not like '%former ID ' || s.student_id || '%'
     ) <> v_n then
    raise exception 'Student ID repair failed: activity feed does not carry exactly one line per student';
  end if;
  if (select tgenabled from pg_trigger
      where tgrelid = 'public.students'::regclass and tgname = 'students_set_updated_at') <> 'O' then
    raise exception 'Student ID repair failed: students_set_updated_at trigger is not enabled';
  end if;

  -- Last on purpose: sequence changes are not transactional.
  perform setval('public.student_number_seq', v_max, true);
end
$$;
