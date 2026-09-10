-- Remove all "ZZTEST" scaffolding created during the pre-handover end-to-end acceptance test
-- (2026-09-10). Everything here is test-only data made against the live database that day, all
-- of it name-prefixed "ZZTEST" or on the *.@hiiltest.com test domain. The 28 real students, the
-- three real leadership accounts (Owner + the two Directors), the real fee rollout and the
-- pre-existing VOIDED demo receipts #0001–#0006 are NOT touched.
--
-- Client-side deletion is blocked for most of this (payments/payroll have no DELETE policy, and
-- payment_allocations.obligation_id / timetable_entries.teacher_id are ON DELETE RESTRICT), so it
-- is done here with owner privileges. Every statement is guarded / pattern-scoped, so on a
-- database without the scaffolding each is a harmless no-op.

do $$
declare
  v_students     uuid[];
  v_staff        uuid[];
  v_test_users   uuid[];
  v_grade9a      uuid;
begin
  select coalesce(array_agg(id), '{}') into v_students
    from public.students where first_name = 'ZZTEST';

  select coalesce(array_agg(id), '{}') into v_staff
    from public.staff where name ilike 'ZZTEST%';

  select coalesce(array_agg(id), '{}') into v_test_users
    from public.profiles
    where email ilike 'zztest.%@hiiltest.com' or full_name ilike 'ZZTEST%';

  select id into v_grade9a from public.classes where grade = 'Grade 9' and section = 'A' limit 1;

  -- ---- financials tied to the ZZTEST student -------------------------------------------------
  if array_length(v_students, 1) is not null then
    delete from public.payments p
    where exists (
      select 1 from public.payment_allocations pa
      join public.student_fee_obligations o on o.id = pa.obligation_id
      where pa.payment_id = p.id and o.student_id = any (v_students)
    );
    -- payments with no allocation left that still name the student in a note are covered above;
    -- obligations + enrolments + attendance + results + behavior + documents + report cards all
    -- cascade on the student delete below.
    delete from public.students where id = any (v_students);
  end if;

  -- ---- ZZTEST staff (teacher + the test Educational Director) --------------------------------
  if array_length(v_staff, 1) is not null then
    -- timetable_entries.teacher_id is ON DELETE RESTRICT against profiles; clear the entries the
    -- ZZTEST teacher was on (they were only ever on the ZZTEST test timetable for Grade 9A).
    delete from public.timetable_entries
    where teacher_id = any (v_test_users);
    -- staff delete cascades staff_attendance / payroll_payments / salary_advances
    delete from public.staff where id = any (v_staff);
  end if;

  -- ---- teacher assignments, homework, announcements ----------------------------------------
  delete from public.teacher_assignments where teacher_id = any (v_test_users);
  delete from public.homework where teacher_id = any (v_test_users) or title ilike 'ZZTEST%';

  -- The Mathematics/English subjects only ever existed because the test created them, so every
  -- result / exam announcement / report card referencing them is test data — including the ones
  -- the run entered against two REAL students (Ahmed Abdulkadir Warsame, HoodoAyaan Abduwali
  -- Mahamud) to make the class ranking meaningful. Remove all of it (result_* sub-tables cascade).
  delete from public.results
    where subject_id in (select id from public.subjects where name in ('Mathematics', 'English'));

  delete from public.notifications n
  where n.announcement_id in (select id from public.announcements where title ilike 'ZZTEST%');
  delete from public.announcements where title ilike 'ZZTEST%';

  -- ---- Grade 9A: undo the test subject wiring + head teacher + the one test attendance day --
  if v_grade9a is not null then
    update public.classes set head_teacher_id = null
      where id = v_grade9a and head_teacher_id = any (v_test_users);
    delete from public.timetable_entries where class_id = v_grade9a;
    -- the run took attendance once for Grade 9A on 2026-09-10 (a pre-year date once the calendar
    -- was reverted); it is the only attendance in the database and covers 11 real students +
    -- the now-deleted ZZTEST student.
    delete from public.attendance where class_id = v_grade9a and date = date '2026-09-10';
    delete from public.class_subjects where class_id = v_grade9a
      and subject_id in (select id from public.subjects where name in ('Mathematics', 'English'));
  end if;
  -- the two subject rows were created by the test (the school had no subjects configured);
  -- drop them only if nothing else references them any more.
  delete from public.subjects s
  where s.name in ('Mathematics', 'English')
    and not exists (select 1 from public.class_subjects cs where cs.subject_id = s.id)
    and not exists (select 1 from public.timetable_entries te where te.subject_id = s.id)
    and not exists (select 1 from public.teacher_assignments ta where ta.subject_id = s.id)
    and not exists (select 1 from public.results r where r.subject_id = s.id)
    and not exists (select 1 from public.homework h where h.subject_id = s.id);

  -- ---- messaging / notifications / activity feed for the ZZTEST users --------------------
  if array_length(v_test_users, 1) is not null then
    delete from public.conversations
      where participant_1_id = any (v_test_users) or participant_2_id = any (v_test_users);
    delete from public.notifications where user_id = any (v_test_users);
    delete from public.parent_students where parent_id = any (v_test_users);
  end if;
  delete from public.activities where text ilike '%ZZTEST%';

  -- ---- finance test artefacts (expense_items cascade from expenses) --------------------
  delete from public.expenses e
    where exists (select 1 from public.expense_items x
                  where x.expense_id = e.id and x.item_name ilike 'ZZTEST%');
  delete from public.payment_methods where name = 'ZZTEST Method';

  -- ---- owner-leave test entry ---------------------------------------------------------
  delete from public.owner_leave_log where note ilike 'ZZTEST%';

  -- ---- finally, the auth accounts (cascades public.profiles, and profile-FK rows) --------
  if array_length(v_test_users, 1) is not null then
    delete from auth.users where id = any (v_test_users);
  end if;
end $$;

-- Receipt / payslip / expense sequences are shared with the school's real numbering. The ZZTEST
-- run consumed payment receipts #0013–#0015, payslip SAL-2026-09-0001 and expense #0001. The
-- school has not issued any real vouchers yet, so restart each sequence at 1 for a clean start.
-- (Guarded: only restarts if the sequence's table is now empty of real rows.)
do $$
begin
  if not exists (select 1 from public.payments) then
    alter sequence public.receipt_no_seq restart with 1;
  end if;
  if not exists (select 1 from public.payroll_payments) then
    alter sequence public.payroll_payment_ref_seq restart with 1;
  end if;
  if not exists (select 1 from public.expenses) then
    alter sequence public.expense_no_seq restart with 1;
  end if;
end $$;
