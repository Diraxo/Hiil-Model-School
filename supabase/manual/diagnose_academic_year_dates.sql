-- READ ONLY. Run in the Supabase SQL editor BEFORE correcting or switching any academic year. It changes
-- nothing. It works both before and after migration 20260929000000_academic_year_central_scope.sql is
-- applied (the lifecycle column is read through to_jsonb, so it simply shows NULL until then).
--
-- It answers, per academic year row:  A rows · B current/closed flags · C year dates · D semester dates ·
-- E enrollments · F attendance · G fee schedules · H fee installments · I payments · J results ·
-- K payroll — and tells you which row is the 2018-2019 (2025-26) history and which is 2019-2020 (2026-27).
--
-- The dates the app expects for the current school year (Meskerem 1 -> Sene 30, 2019 E.C.):
--   year_start = 2026-09-11   year_end = 2027-07-07   (10 Ethiopian months: Meskerem .. Sene)

-- ------------------------------------------------------------------------------------------------
-- A-D. The rows: identity, flags, year dates, semester dates and the two numbers the app's guard uses.
-- ------------------------------------------------------------------------------------------------
select ay.id,
       ay.gc_label, ay.ec_label,
       ay.is_current,
       to_jsonb(ay) ->> 'closed_at'      as closed_at,        -- NULL: current / upcoming (or migration not applied yet)
       ay.year_start, ay.year_end,
       ay.sem1_start, ay.sem1_end, ay.break_days, ay.sem2_start, ay.sem2_end,
       ay.result_finalization_grace_days as grace_days,
       ay.year_end - ay.year_start       as span_days,        -- > 400 = not one school year
       ay.sem1_start - ay.year_start     as sem1_offset_days, -- > 92  = year start left in the previous year
       case when ay.year_end - ay.year_start > 400 or ay.sem1_start - ay.year_start > 92
            then 'INCONSISTENT — start/end describe more than one school year' else 'ok' end as dates_check
from public.academic_years ay
order by ay.year_start;

-- ------------------------------------------------------------------------------------------------
-- E. Enrollments per year (a student is permanent; enrollments belong to a year).
-- ------------------------------------------------------------------------------------------------
select ay.id as academic_year_id, ay.year_start, e.status, count(*) as enrollments
from public.academic_years ay
left join public.enrollments e on e.academic_year_id = ay.id
group by ay.id, ay.year_start, e.status
order by ay.year_start, e.status;

-- Students who are active but NOT enrolled in the current year. Migration 20260929000000 back-fills an
-- enrollment for each of these (insert-only). Expect 0 if the app has been keeping enrollments in sync.
select count(*) as active_students_without_current_year_enrollment
from public.students s
where s.status in ('ACTIVE', 'ABSENT', 'SUSPENDED')
  and not exists (
    select 1 from public.enrollments e join public.academic_years y on y.id = e.academic_year_id
    where e.student_id = s.id and y.is_current);

-- ------------------------------------------------------------------------------------------------
-- F. Attendance per year (attendance rows carry a date, so a row belongs to the year whose dates contain it).
-- ------------------------------------------------------------------------------------------------
select ay.id as academic_year_id, ay.year_start, ay.year_end, count(a.id) as attendance_rows,
       min(a.date) as first_day, max(a.date) as last_day
from public.academic_years ay
left join public.attendance a on a.date between ay.year_start and ay.year_end
group by ay.id, ay.year_start, ay.year_end
order by ay.year_start;

-- attendance by month: shows whether 2025-26 (Meskerem 2018 .. Sene 2018) data exists at all
select to_char(date, 'YYYY-MM') as month, count(*) as records
from public.attendance
group by 1
order by 1;

-- attendance that falls inside NO year
select count(*) as attendance_outside_every_year
from public.attendance a
where not exists (select 1 from public.academic_years y where a.date between y.year_start and y.year_end);

-- ------------------------------------------------------------------------------------------------
-- G-I. Fees: schedules, installments (billed months) and payments per year.
-- ------------------------------------------------------------------------------------------------
select ay.id as academic_year_id, ay.year_start, ay.year_end,
       (select count(*) from public.fee_schedules fs where fs.academic_year_id = ay.id)                         as fee_schedules,
       (select count(*) from public.fee_installments fi join public.fee_schedules fs on fs.id = fi.fee_schedule_id
         where fs.academic_year_id = ay.id)                                                                     as installments,
       (select min(fi.period_month) from public.fee_installments fi join public.fee_schedules fs on fs.id = fi.fee_schedule_id
         where fs.academic_year_id = ay.id)                                                                     as first_billed_month,
       (select max(fi.period_month) from public.fee_installments fi join public.fee_schedules fs on fs.id = fi.fee_schedule_id
         where fs.academic_year_id = ay.id)                                                                     as last_billed_month,
       (select count(*) from public.student_fee_obligations o join public.fee_installments fi on fi.id = o.fee_installment_id
          join public.fee_schedules fs on fs.id = fi.fee_schedule_id where fs.academic_year_id = ay.id)         as obligations,
       (select count(distinct pa.payment_id) from public.payment_allocations pa
          join public.payments p on p.id = pa.payment_id and p.status = 'POSTED'
          join public.student_fee_obligations o on o.id = pa.obligation_id
          join public.fee_installments fi on fi.id = o.fee_installment_id
          join public.fee_schedules fs on fs.id = fi.fee_schedule_id where fs.academic_year_id = ay.id)         as posted_payments,
       (select coalesce(sum(pa.amount), 0) from public.payment_allocations pa
          join public.payments p on p.id = pa.payment_id and p.status = 'POSTED'
          join public.student_fee_obligations o on o.id = pa.obligation_id
          join public.fee_installments fi on fi.id = o.fee_installment_id
          join public.fee_schedules fs on fs.id = fi.fee_schedule_id where fs.academic_year_id = ay.id)         as posted_amount,
       (select count(distinct pa.payment_id) from public.payment_allocations pa
          join public.payments p on p.id = pa.payment_id and p.status = 'VOIDED'
          join public.student_fee_obligations o on o.id = pa.obligation_id
          join public.fee_installments fi on fi.id = o.fee_installment_id
          join public.fee_schedules fs on fs.id = fi.fee_schedule_id where fs.academic_year_id = ay.id)         as voided_payments
from public.academic_years ay
order by ay.year_start;

-- the billed months of every schedule (a 2019 E.C. year must show Sep 2026 .. Jun 2027 = 10 rows, no 2025 month)
select ay.year_start, ft.name as fee, to_char(fi.period_month, 'YYYY-MM') as billed_month, count(*) as installments
from public.fee_installments fi
join public.fee_schedules fs on fs.id = fi.fee_schedule_id
join public.fee_types ft on ft.id = fs.fee_type_id
join public.academic_years ay on ay.id = fs.academic_year_id
group by ay.year_start, ft.name, fi.period_month
order by ay.year_start, ft.name, fi.period_month;

-- ------------------------------------------------------------------------------------------------
-- J. Results per year and semester.
-- ------------------------------------------------------------------------------------------------
select ay.id as academic_year_id, ay.year_start, r.semester, r.publish_status, count(*) as results
from public.academic_years ay
left join public.results r on r.academic_year_id = ay.id
group by ay.id, ay.year_start, r.semester, r.publish_status
order by ay.year_start, r.semester;

-- ------------------------------------------------------------------------------------------------
-- K. Payroll: payments and advances by salary month (a payroll month belongs to the year whose Ethiopian
--    months include it; the app now refuses payroll for a month outside every year).
-- ------------------------------------------------------------------------------------------------
select month, count(*) as payroll_payments, sum(amount) as amount
from public.payroll_payments
group by month
order by month;

select payroll_month as month, count(*) as salary_advances, sum(amount) as amount
from public.salary_advances
group by payroll_month
order by payroll_month;

-- ------------------------------------------------------------------------------------------------
-- VERDICT HELPER for a row whose year_start is 2025-09-11 but whose semesters are in 2026-27:
-- if every count below is 0 the row carries no 2018-2019 history and repair_academic_year_start.sql.template
-- can safely move its start; otherwise the row mixes two school years and MUST be split by a person.
-- ------------------------------------------------------------------------------------------------
select ay.id as academic_year_id, ay.year_start, ay.year_end,
       (select count(*) from public.attendance a where a.date >= ay.year_start and a.date < date '2026-09-01')      as attendance_before_2026_09_01,
       (select count(*) from public.fee_installments fi join public.fee_schedules fs on fs.id = fi.fee_schedule_id
         where fs.academic_year_id = ay.id and fi.period_month < date '2026-09-01')                               as installments_before_2026_09_01,
       (select count(*) from public.payments p where p.date < date '2026-09-01')                                  as payments_dated_before_2026_09_01,
       (select count(*) from public.payroll_payments pp where pp.month < '2026-09')                              as payroll_before_2026_09
from public.academic_years ay
where ay.year_start < date '2026-09-01' and ay.year_end > date '2026-09-01'
order by ay.year_start;
