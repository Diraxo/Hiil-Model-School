-- Remove two test staff records created while exercising the Payroll/Staff screens
-- (not real employees), per owner request on 2026-09-19:
--
--   * "ABDIRHAMAN MOHAMED ASKER" — Educational Director (staff.id 8b5b9e19-0c7e-46d0-8007-373783386d4e)
--   * "M.Kader Sheikh Dayib"     — Finance Director     (staff.id 31240a53-2961-4dd0-9bc7-5ce0f750bbff)
--
-- Both were already employment_status = ENDED / status = DISABLED. Neither has any
-- payroll_payments or salary_advances rows recorded (confirmed before writing this
-- migration), so the "net pay owed" shown for them in the UI was only the unpaid
-- salary figure computed from the still-open staff row — deleting the row removes it.
-- The staff -> payroll_payments / salary_advances / staff_attendance foreign keys are
-- ON DELETE CASCADE, so this statement alone covers any such rows.
--
-- Scoped strictly to these two staff.id values. Nothing else (other staff, profiles,
-- auth logins, students, fees, activity/notification history) is touched.

delete from public.staff
where id in (
  '8b5b9e19-0c7e-46d0-8007-373783386d4e',
  '31240a53-2961-4dd0-9bc7-5ce0f750bbff'
);
