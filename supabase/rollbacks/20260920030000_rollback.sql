-- ROLLBACK for 20260920030000_rpc_authorization_null_safe.sql (NOT a migration: lives outside supabase/migrations
-- so it can never be applied by `supabase db push`). Restores the previous function bodies and EXECUTE grants
-- exactly as they were in production (generated from the pre-fix schema; verified by the test suite).
-- WARNING: this RE-OPENS the vulnerabilities that migration fixed (role-less/suspended/anonymous callers passing
-- money and publish RPC guards). For emergencies only. If migration 2 (20260920040000) is applied, roll IT back
-- first (20260920040000_rollback.sql), then this one.
-- Run in the SQL editor / `supabase db query` as a privileged role. No data is touched.

CREATE OR REPLACE FUNCTION public.is_owner()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select public.current_role() = 'OWNER' $function$;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select public.current_role() = 'ADMIN' $function$;

CREATE OR REPLACE FUNCTION public.is_finance()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select public.current_role() = 'FINANCE' $function$;

CREATE OR REPLACE FUNCTION public.is_teacher()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select public.current_role() = 'TEACHER' $function$;

CREATE OR REPLACE FUNCTION public.is_parent()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select public.current_role() = 'PARENT' $function$;

CREATE OR REPLACE FUNCTION public.enforce_profile_privilege_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.role is distinct from old.role and not public.is_owner() then
    raise exception 'Only the Owner may change a user''s role';
  end if;
  if new.status is distinct from old.status then
    if new.id = auth.uid() then
      raise exception 'You cannot change your own account status';
    end if;
    if not (
      public.is_owner()
      or (public.is_admin() and exists (
        select 1 from public.staff s where s.user_id = new.id and s.position = 'Teacher'
      ))
      or (public.is_finance() and exists (
        select 1 from public.staff s where s.user_id = new.id
          and public.staff_group_for_position(s.position) = 'Other Staff'
      ))
    ) then
      raise exception 'Not authorized to change this account''s status';
    end if;
  end if;
  if new.must_change_password is distinct from old.must_change_password and new.id <> auth.uid() and not public.is_owner() then
    raise exception 'Not authorized to change must_change_password for another user';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_staff_financial_field_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (new.salary is distinct from old.salary or new.payment_schedule is distinct from old.payment_schedule)
     and not public.is_owner_or_finance() then
    raise exception 'Only the Owner or Finance & Operations Director may change salary or payment schedule';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_or_create_conversation(user_a uuid, user_b uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  lo uuid := least(user_a, user_b);
  hi uuid := greatest(user_a, user_b);
  conv_id uuid;
begin
  if auth.uid() is null or auth.uid() not in (user_a, user_b) then
    raise exception 'You may only create a conversation you participate in';
  end if;
  if user_a = user_b then
    raise exception 'A conversation requires two distinct participants';
  end if;

  select id into conv_id
    from public.conversations
    where participant_1_id = lo and participant_2_id = hi;

  if conv_id is null then
    insert into public.conversations (participant_1_id, participant_2_id)
      values (lo, hi)
      returning id into conv_id;
  end if;

  return conv_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_message(p_message_id uuid, p_title text, p_message text, p_navigation jsonb DEFAULT NULL::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_msg public.messages;
  v_conv public.conversations;
  v_recipient uuid;
begin
  select * into v_msg from public.messages where id = p_message_id;
  if not found then
    raise exception 'Message % not found', p_message_id;
  end if;
  if v_msg.sender_id is distinct from auth.uid() then
    raise exception 'Only the message sender may send its notification';
  end if;
  select * into v_conv from public.conversations where id = v_msg.conversation_id;
  if auth.uid() not in (v_conv.participant_1_id, v_conv.participant_2_id) then
    raise exception 'Not a participant in this conversation';
  end if;
  -- Idempotent: one notification per message id.
  if exists (
    select 1 from public.notifications
    where type = 'MESSAGE' and (navigation ->> 'messageId') = p_message_id::text
  ) then
    return 0;
  end if;

  v_recipient := case when v_conv.participant_1_id = auth.uid()
                      then v_conv.participant_2_id else v_conv.participant_1_id end;

  insert into public.notifications (user_id, title, message, type, navigation)
  values (v_recipient, p_title, p_message, 'MESSAGE',
          coalesce(p_navigation, '{}'::jsonb)
            || jsonb_build_object('page', 'messages', 'userId', v_msg.sender_id,
                                  'messageId', p_message_id));
  return 1;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_leave_submitted(p_leave_request_id uuid, p_title text, p_message text, p_navigation jsonb DEFAULT NULL::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lr public.leave_requests;
  v_count integer := 0;
begin
  select * into v_lr from public.leave_requests where id = p_leave_request_id;
  if not found then
    raise exception 'Leave request % not found', p_leave_request_id;
  end if;
  -- leave_requests_insert requires requested_by = auth.uid(); only the submitter notifies.
  if v_lr.requested_by is distinct from auth.uid() then
    raise exception 'Only the request submitter may send the submission notification';
  end if;
  if v_lr.submitted_notified then
    return 0;
  end if;

  insert into public.notifications (user_id, title, message, type, navigation)
  select rec.recipient_id, p_title, p_message, 'LEAVE', p_navigation
  from public._leave_admin_recipients(p_leave_request_id) as rec;
  get diagnostics v_count = row_count;

  update public.leave_requests set submitted_notified = true where id = p_leave_request_id;
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_announcement(p_announcement_id uuid, p_title text, p_message text, p_navigation jsonb DEFAULT NULL::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ann public.announcements;
  v_count integer := 0;
begin
  select * into v_ann from public.announcements where id = p_announcement_id;
  if not found then
    raise exception 'Announcement % not found', p_announcement_id;
  end if;
  -- announcements_insert policy = is_owner_or_admin() OR is_finance(), with author_id stamped
  -- server-side; only the author (or an Owner/Educational Director) may dispatch it.
  if not (public.is_owner_or_admin() or v_ann.author_id = auth.uid()) then
    raise exception 'Not authorized to dispatch this announcement';
  end if;
  -- Not yet due, or already dispatched -> no-op (idempotent; safe for a polling caller).
  if v_ann.publish_notified or (v_ann.publish_at is not null and v_ann.publish_at > now()) then
    return 0;
  end if;

  with recipients as (
    select p.id as user_id
    from public.profiles p
    where p.status = 'ACTIVE'
      and (
        case v_ann.audience ->> 'type'
          when 'ALL' then true
          when 'ALL_PARENTS' then p.role = 'PARENT'
          when 'ALL_TEACHERS' then p.role = 'TEACHER'
          when 'USER' then p.id::text = (v_ann.audience ->> 'userId')
          when 'DIRECTORS' then exists (
            select 1 from public.staff s
            where s.user_id = p.id
              and public.staff_group_for_position(s.position) = 'Directors'
          )
          when 'GRADE' then p.role = 'PARENT' and exists (
            select 1 from public.parent_students ps
            join public.students st on st.id = ps.student_id
            where ps.parent_id = p.id and st.status = 'ACTIVE'
              and st.grade = (v_ann.audience ->> 'grade')
          )
          when 'SECTION' then p.role = 'PARENT' and exists (
            select 1 from public.parent_students ps
            join public.students st on st.id = ps.student_id
            where ps.parent_id = p.id and st.status = 'ACTIVE'
              and st.grade = (v_ann.audience ->> 'grade')
              and st.section = (v_ann.audience ->> 'section')
          )
          else false
        end
      )
  )
  insert into public.notifications (user_id, title, message, type, navigation, announcement_id)
  select user_id, p_title, p_message, 'ANNOUNCEMENT', p_navigation, p_announcement_id
  from recipients;
  get diagnostics v_count = row_count;

  update public.announcements set publish_notified = true where id = p_announcement_id;
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.touch_presence()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into public.user_presence (user_id, last_seen_at)
  values (auth.uid(), now())
  on conflict (user_id) do update set last_seen_at = now();
$function$;

CREATE OR REPLACE FUNCTION public.my_staff_record()
 RETURNS staff
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select * from public.staff where user_id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.my_payroll_payments()
 RETURNS SETOF payroll_payments
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.* from public.payroll_payments p
  join public.staff s on s.id = p.staff_id
  where s.user_id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.my_salary_advances()
 RETURNS SETOF salary_advances
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select a.* from public.salary_advances a
  join public.staff s on s.id = a.staff_id
  where s.user_id = auth.uid();
$function$;


-- restore the original grants (anon and PUBLIC EXECUTE on every function, as before)
revoke all on function "current_role"() from public, anon, authenticated, service_role;
grant execute on function "current_role"() to public;
grant execute on function "current_role"() to anon;
grant execute on function "current_role"() to authenticated;
grant execute on function "current_role"() to service_role;
revoke all on function _insert_expense_items(uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function _insert_expense_items(uuid,jsonb) to anon;
grant execute on function _insert_expense_items(uuid,jsonb) to authenticated;
grant execute on function _insert_expense_items(uuid,jsonb) to service_role;
revoke all on function _leave_admin_recipients(uuid) from public, anon, authenticated, service_role;
grant execute on function _leave_admin_recipients(uuid) to anon;
grant execute on function _leave_admin_recipients(uuid) to authenticated;
grant execute on function _leave_admin_recipients(uuid) to service_role;
revoke all on function add_obligation_adjustment(uuid,fee_adjustment_type,numeric,text,uuid) from public, anon, authenticated, service_role;
grant execute on function add_obligation_adjustment(uuid,fee_adjustment_type,numeric,text,uuid) to anon;
grant execute on function add_obligation_adjustment(uuid,fee_adjustment_type,numeric,text,uuid) to authenticated;
grant execute on function add_obligation_adjustment(uuid,fee_adjustment_type,numeric,text,uuid) to service_role;
revoke all on function announcement_read_stats(uuid[]) from public, anon, authenticated, service_role;
grant execute on function announcement_read_stats(uuid[]) to anon;
grant execute on function announcement_read_stats(uuid[]) to authenticated;
grant execute on function announcement_read_stats(uuid[]) to service_role;
revoke all on function attendance_day_in_session(date) from public, anon, authenticated, service_role;
grant execute on function attendance_day_in_session(date) to public;
grant execute on function attendance_day_in_session(date) to anon;
grant execute on function attendance_day_in_session(date) to authenticated;
grant execute on function attendance_day_in_session(date) to service_role;
revoke all on function attendance_phase_blocked(date) from public, anon, authenticated, service_role;
grant execute on function attendance_phase_blocked(date) to public;
grant execute on function attendance_phase_blocked(date) to anon;
grant execute on function attendance_phase_blocked(date) to authenticated;
grant execute on function attendance_phase_blocked(date) to service_role;
revoke all on function can_act_on_period(uuid,date) from public, anon, authenticated, service_role;
grant execute on function can_act_on_period(uuid,date) to public;
grant execute on function can_act_on_period(uuid,date) to anon;
grant execute on function can_act_on_period(uuid,date) to authenticated;
grant execute on function can_act_on_period(uuid,date) to service_role;
revoke all on function can_decide_leave(leave_kind,uuid) from public, anon, authenticated, service_role;
grant execute on function can_decide_leave(leave_kind,uuid) to public;
grant execute on function can_decide_leave(leave_kind,uuid) to anon;
grant execute on function can_decide_leave(leave_kind,uuid) to authenticated;
grant execute on function can_decide_leave(leave_kind,uuid) to service_role;
revoke all on function can_edit_announcement(text) from public, anon, authenticated, service_role;
grant execute on function can_edit_announcement(text) to anon;
grant execute on function can_edit_announcement(text) to authenticated;
grant execute on function can_edit_announcement(text) to service_role;
revoke all on function can_edit_result_component(uuid) from public, anon, authenticated, service_role;
grant execute on function can_edit_result_component(uuid) to public;
grant execute on function can_edit_result_component(uuid) to anon;
grant execute on function can_edit_result_component(uuid) to authenticated;
grant execute on function can_edit_result_component(uuid) to service_role;
revoke all on function can_edit_staff_attendance_for(uuid) from public, anon, authenticated, service_role;
grant execute on function can_edit_staff_attendance_for(uuid) to public;
grant execute on function can_edit_staff_attendance_for(uuid) to anon;
grant execute on function can_edit_staff_attendance_for(uuid) to authenticated;
grant execute on function can_edit_staff_attendance_for(uuid) to service_role;
revoke all on function can_view_announcement(text) from public, anon, authenticated, service_role;
grant execute on function can_view_announcement(text) to anon;
grant execute on function can_view_announcement(text) to authenticated;
grant execute on function can_view_announcement(text) to service_role;
revoke all on function can_view_result(uuid,uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function can_view_result(uuid,uuid,uuid) to public;
grant execute on function can_view_result(uuid,uuid,uuid) to anon;
grant execute on function can_view_result(uuid,uuid,uuid) to authenticated;
grant execute on function can_view_result(uuid,uuid,uuid) to service_role;
revoke all on function can_view_result_audit(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function can_view_result_audit(uuid,uuid) to public;
grant execute on function can_view_result_audit(uuid,uuid) to anon;
grant execute on function can_view_result_audit(uuid,uuid) to authenticated;
grant execute on function can_view_result_audit(uuid,uuid) to service_role;
revoke all on function can_view_result_configuration(uuid) from public, anon, authenticated, service_role;
grant execute on function can_view_result_configuration(uuid) to public;
grant execute on function can_view_result_configuration(uuid) to anon;
grant execute on function can_view_result_configuration(uuid) to authenticated;
grant execute on function can_view_result_configuration(uuid) to service_role;
revoke all on function check_student_ids(text[]) from public, anon, authenticated, service_role;
grant execute on function check_student_ids(text[]) to public;
grant execute on function check_student_ids(text[]) to anon;
grant execute on function check_student_ids(text[]) to authenticated;
grant execute on function check_student_ids(text[]) to service_role;
revoke all on function create_expense(date,text,jsonb,text,text,text,text,text) from public, anon, authenticated, service_role;
grant execute on function create_expense(date,text,jsonb,text,text,text,text,text) to anon;
grant execute on function create_expense(date,text,jsonb,text,text,text,text,text) to authenticated;
grant execute on function create_expense(date,text,jsonb,text,text,text,text,text) to service_role;
revoke all on function decide_leave_request(uuid,leave_approval_status,text) from public, anon, authenticated, service_role;
grant execute on function decide_leave_request(uuid,leave_approval_status,text) to anon;
grant execute on function decide_leave_request(uuid,leave_approval_status,text) to authenticated;
grant execute on function decide_leave_request(uuid,leave_approval_status,text) to service_role;
revoke all on function delete_expense(uuid) from public, anon, authenticated, service_role;
grant execute on function delete_expense(uuid) to anon;
grant execute on function delete_expense(uuid) to authenticated;
grant execute on function delete_expense(uuid) to service_role;
revoke all on function delete_result_configuration(uuid,semester,text) from public, anon, authenticated, service_role;
grant execute on function delete_result_configuration(uuid,semester,text) to authenticated;
grant execute on function delete_result_configuration(uuid,semester,text) to service_role;
revoke all on function directory_contacts() from public, anon, authenticated, service_role;
grant execute on function directory_contacts() to anon;
grant execute on function directory_contacts() to authenticated;
grant execute on function directory_contacts() to service_role;
revoke all on function generate_monthly_fee_installments(uuid) from public, anon, authenticated, service_role;
grant execute on function generate_monthly_fee_installments(uuid) to anon;
grant execute on function generate_monthly_fee_installments(uuid) to authenticated;
grant execute on function generate_monthly_fee_installments(uuid) to service_role;
revoke all on function generate_student_id() from public, anon, authenticated, service_role;
grant execute on function generate_student_id() to public;
grant execute on function generate_student_id() to anon;
grant execute on function generate_student_id() to authenticated;
grant execute on function generate_student_id() to service_role;
revoke all on function get_or_create_conversation(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function get_or_create_conversation(uuid,uuid) to anon;
grant execute on function get_or_create_conversation(uuid,uuid) to authenticated;
grant execute on function get_or_create_conversation(uuid,uuid) to service_role;
revoke all on function heads_class(uuid) from public, anon, authenticated, service_role;
grant execute on function heads_class(uuid) to public;
grant execute on function heads_class(uuid) to anon;
grant execute on function heads_class(uuid) to authenticated;
grant execute on function heads_class(uuid) to service_role;
revoke all on function is_admin() from public, anon, authenticated, service_role;
grant execute on function is_admin() to public;
grant execute on function is_admin() to anon;
grant execute on function is_admin() to authenticated;
grant execute on function is_admin() to service_role;
revoke all on function is_finance() from public, anon, authenticated, service_role;
grant execute on function is_finance() to public;
grant execute on function is_finance() to anon;
grant execute on function is_finance() to authenticated;
grant execute on function is_finance() to service_role;
revoke all on function is_owner() from public, anon, authenticated, service_role;
grant execute on function is_owner() to public;
grant execute on function is_owner() to anon;
grant execute on function is_owner() to authenticated;
grant execute on function is_owner() to service_role;
revoke all on function is_owner_or_admin() from public, anon, authenticated, service_role;
grant execute on function is_owner_or_admin() to public;
grant execute on function is_owner_or_admin() to anon;
grant execute on function is_owner_or_admin() to authenticated;
grant execute on function is_owner_or_admin() to service_role;
revoke all on function is_owner_or_finance() from public, anon, authenticated, service_role;
grant execute on function is_owner_or_finance() to public;
grant execute on function is_owner_or_finance() to anon;
grant execute on function is_owner_or_finance() to authenticated;
grant execute on function is_owner_or_finance() to service_role;
revoke all on function is_parent() from public, anon, authenticated, service_role;
grant execute on function is_parent() to public;
grant execute on function is_parent() to anon;
grant execute on function is_parent() to authenticated;
grant execute on function is_parent() to service_role;
revoke all on function is_parent_of(uuid) from public, anon, authenticated, service_role;
grant execute on function is_parent_of(uuid) to public;
grant execute on function is_parent_of(uuid) to anon;
grant execute on function is_parent_of(uuid) to authenticated;
grant execute on function is_parent_of(uuid) to service_role;
revoke all on function is_teacher() from public, anon, authenticated, service_role;
grant execute on function is_teacher() to public;
grant execute on function is_teacher() to anon;
grant execute on function is_teacher() to authenticated;
grant execute on function is_teacher() to service_role;
revoke all on function log_activity(text,jsonb,text) from public, anon, authenticated, service_role;
grant execute on function log_activity(text,jsonb,text) to anon;
grant execute on function log_activity(text,jsonb,text) to authenticated;
grant execute on function log_activity(text,jsonb,text) to service_role;
revoke all on function manages_staff_group(staff_position) from public, anon, authenticated, service_role;
grant execute on function manages_staff_group(staff_position) to public;
grant execute on function manages_staff_group(staff_position) to anon;
grant execute on function manages_staff_group(staff_position) to authenticated;
grant execute on function manages_staff_group(staff_position) to service_role;
revoke all on function materialize_obligations_for_schedule(uuid,date,fee_obligation_reason) from public, anon, authenticated, service_role;
grant execute on function materialize_obligations_for_schedule(uuid,date,fee_obligation_reason) to anon;
grant execute on function materialize_obligations_for_schedule(uuid,date,fee_obligation_reason) to authenticated;
grant execute on function materialize_obligations_for_schedule(uuid,date,fee_obligation_reason) to service_role;
revoke all on function materialize_obligations_for_student(uuid,uuid,date,fee_obligation_reason) from public, anon, authenticated, service_role;
grant execute on function materialize_obligations_for_student(uuid,uuid,date,fee_obligation_reason) to anon;
grant execute on function materialize_obligations_for_student(uuid,uuid,date,fee_obligation_reason) to authenticated;
grant execute on function materialize_obligations_for_student(uuid,uuid,date,fee_obligation_reason) to service_role;
revoke all on function my_payroll_payments() from public, anon, authenticated, service_role;
grant execute on function my_payroll_payments() to anon;
grant execute on function my_payroll_payments() to authenticated;
grant execute on function my_payroll_payments() to service_role;
revoke all on function my_profile() from public, anon, authenticated, service_role;
grant execute on function my_profile() to public;
grant execute on function my_profile() to anon;
grant execute on function my_profile() to authenticated;
grant execute on function my_profile() to service_role;
revoke all on function my_salary_advances() from public, anon, authenticated, service_role;
grant execute on function my_salary_advances() to anon;
grant execute on function my_salary_advances() to authenticated;
grant execute on function my_salary_advances() to service_role;
revoke all on function my_staff_record() from public, anon, authenticated, service_role;
grant execute on function my_staff_record() to anon;
grant execute on function my_staff_record() to authenticated;
grant execute on function my_staff_record() to service_role;
revoke all on function net_owed_for_obligation(uuid) from public, anon, authenticated, service_role;
grant execute on function net_owed_for_obligation(uuid) to public;
grant execute on function net_owed_for_obligation(uuid) to anon;
grant execute on function net_owed_for_obligation(uuid) to authenticated;
grant execute on function net_owed_for_obligation(uuid) to service_role;
revoke all on function notify_announcement(uuid,text,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function notify_announcement(uuid,text,text,jsonb) to anon;
grant execute on function notify_announcement(uuid,text,text,jsonb) to authenticated;
grant execute on function notify_announcement(uuid,text,text,jsonb) to service_role;
revoke all on function notify_behavior_record(uuid,text,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function notify_behavior_record(uuid,text,text,jsonb) to anon;
grant execute on function notify_behavior_record(uuid,text,text,jsonb) to authenticated;
grant execute on function notify_behavior_record(uuid,text,text,jsonb) to service_role;
revoke all on function notify_exam_announcement(uuid,text,text,text,text,jsonb,jsonb) from public, anon, authenticated, service_role;
grant execute on function notify_exam_announcement(uuid,text,text,text,text,jsonb,jsonb) to anon;
grant execute on function notify_exam_announcement(uuid,text,text,text,text,jsonb,jsonb) to authenticated;
grant execute on function notify_exam_announcement(uuid,text,text,text,text,jsonb,jsonb) to service_role;
revoke all on function notify_homework(uuid,text,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function notify_homework(uuid,text,text,jsonb) to anon;
grant execute on function notify_homework(uuid,text,text,jsonb) to authenticated;
grant execute on function notify_homework(uuid,text,text,jsonb) to service_role;
revoke all on function notify_leave_completed(uuid,text,text,text,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function notify_leave_completed(uuid,text,text,text,text,jsonb) to anon;
grant execute on function notify_leave_completed(uuid,text,text,text,text,jsonb) to authenticated;
grant execute on function notify_leave_completed(uuid,text,text,text,text,jsonb) to service_role;
revoke all on function notify_leave_decided(uuid,text,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function notify_leave_decided(uuid,text,text,jsonb) to anon;
grant execute on function notify_leave_decided(uuid,text,text,jsonb) to authenticated;
grant execute on function notify_leave_decided(uuid,text,text,jsonb) to service_role;
revoke all on function notify_leave_submitted(uuid,text,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function notify_leave_submitted(uuid,text,text,jsonb) to anon;
grant execute on function notify_leave_submitted(uuid,text,text,jsonb) to authenticated;
grant execute on function notify_leave_submitted(uuid,text,text,jsonb) to service_role;
revoke all on function notify_message(uuid,text,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function notify_message(uuid,text,text,jsonb) to anon;
grant execute on function notify_message(uuid,text,text,jsonb) to authenticated;
grant execute on function notify_message(uuid,text,text,jsonb) to service_role;
revoke all on function notify_owner_leave(uuid,text,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function notify_owner_leave(uuid,text,text,jsonb) to anon;
grant execute on function notify_owner_leave(uuid,text,text,jsonb) to authenticated;
grant execute on function notify_owner_leave(uuid,text,text,jsonb) to service_role;
revoke all on function notify_payment_received(uuid) from public, anon, authenticated, service_role;
grant execute on function notify_payment_received(uuid) to anon;
grant execute on function notify_payment_received(uuid) to authenticated;
grant execute on function notify_payment_received(uuid) to service_role;
revoke all on function notify_payment_reminder(uuid[],text,text,text) from public, anon, authenticated, service_role;
grant execute on function notify_payment_reminder(uuid[],text,text,text) to anon;
grant execute on function notify_payment_reminder(uuid[],text,text,text) to authenticated;
grant execute on function notify_payment_reminder(uuid[],text,text,text) to service_role;
revoke all on function notify_report_card_published(uuid,text,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function notify_report_card_published(uuid,text,text,jsonb) to anon;
grant execute on function notify_report_card_published(uuid,text,text,jsonb) to authenticated;
grant execute on function notify_report_card_published(uuid,text,text,jsonb) to service_role;
revoke all on function notify_results_published(uuid,uuid,semester,uuid,uuid[],text,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function notify_results_published(uuid,uuid,semester,uuid,uuid[],text,text,jsonb) to anon;
grant execute on function notify_results_published(uuid,uuid,semester,uuid,uuid[],text,text,jsonb) to authenticated;
grant execute on function notify_results_published(uuid,uuid,semester,uuid,uuid[],text,text,jsonb) to service_role;
revoke all on function notify_salary_advance(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function notify_salary_advance(uuid,text,text) to anon;
grant execute on function notify_salary_advance(uuid,text,text) to authenticated;
grant execute on function notify_salary_advance(uuid,text,text) to service_role;
revoke all on function notify_salary_paid(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function notify_salary_paid(uuid,text,text) to anon;
grant execute on function notify_salary_paid(uuid,text,text) to authenticated;
grant execute on function notify_salary_paid(uuid,text,text) to service_role;
revoke all on function notify_staff_attendance(uuid,text,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function notify_staff_attendance(uuid,text,text,jsonb) to anon;
grant execute on function notify_staff_attendance(uuid,text,text,jsonb) to authenticated;
grant execute on function notify_staff_attendance(uuid,text,text,jsonb) to service_role;
revoke all on function notify_student_attendance(uuid,text,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function notify_student_attendance(uuid,text,text,jsonb) to anon;
grant execute on function notify_student_attendance(uuid,text,text,jsonb) to authenticated;
grant execute on function notify_student_attendance(uuid,text,text,jsonb) to service_role;
revoke all on function notify_student_suspension(uuid,text,text,text,text) from public, anon, authenticated, service_role;
grant execute on function notify_student_suspension(uuid,text,text,text,text) to anon;
grant execute on function notify_student_suspension(uuid,text,text,text,text) to authenticated;
grant execute on function notify_student_suspension(uuid,text,text,text,text) to service_role;
revoke all on function notify_substitute_assigned(uuid,text,text,uuid,text) from public, anon, authenticated, service_role;
grant execute on function notify_substitute_assigned(uuid,text,text,uuid,text) to anon;
grant execute on function notify_substitute_assigned(uuid,text,text,uuid,text) to authenticated;
grant execute on function notify_substitute_assigned(uuid,text,text,uuid,text) to service_role;
revoke all on function notify_substitute_removed(uuid,text) from public, anon, authenticated, service_role;
grant execute on function notify_substitute_removed(uuid,text) to anon;
grant execute on function notify_substitute_removed(uuid,text) to authenticated;
grant execute on function notify_substitute_removed(uuid,text) to service_role;
revoke all on function owns_staff_row(uuid) from public, anon, authenticated, service_role;
grant execute on function owns_staff_row(uuid) to anon;
grant execute on function owns_staff_row(uuid) to authenticated;
grant execute on function owns_staff_row(uuid) to service_role;
revoke all on function record_payment_batch(jsonb,text,date,text,uuid) from public, anon, authenticated, service_role;
grant execute on function record_payment_batch(jsonb,text,date,text,uuid) to anon;
grant execute on function record_payment_batch(jsonb,text,date,text,uuid) to authenticated;
grant execute on function record_payment_batch(jsonb,text,date,text,uuid) to service_role;
revoke all on function record_payroll_payment(uuid,numeric,text,text,date,text,numeric,numeric,numeric,uuid) from public, anon, authenticated, service_role;
grant execute on function record_payroll_payment(uuid,numeric,text,text,date,text,numeric,numeric,numeric,uuid) to anon;
grant execute on function record_payroll_payment(uuid,numeric,text,text,date,text,numeric,numeric,numeric,uuid) to authenticated;
grant execute on function record_payroll_payment(uuid,numeric,text,text,date,text,numeric,numeric,numeric,uuid) to service_role;
revoke all on function record_salary_advance(uuid,numeric,date,text,text,uuid) from public, anon, authenticated, service_role;
grant execute on function record_salary_advance(uuid,numeric,date,text,text,uuid) to anon;
grant execute on function record_salary_advance(uuid,numeric,date,text,text,uuid) to authenticated;
grant execute on function record_salary_advance(uuid,numeric,date,text,text,uuid) to service_role;
revoke all on function result_edit_window_open(uuid,semester,jsonb) from public, anon, authenticated, service_role;
grant execute on function result_edit_window_open(uuid,semester,jsonb) to public;
grant execute on function result_edit_window_open(uuid,semester,jsonb) to anon;
grant execute on function result_edit_window_open(uuid,semester,jsonb) to authenticated;
grant execute on function result_edit_window_open(uuid,semester,jsonb) to service_role;
revoke all on function result_effective_configuration(uuid) from public, anon, authenticated, service_role;
grant execute on function result_effective_configuration(uuid) to public;
grant execute on function result_effective_configuration(uuid) to anon;
grant execute on function result_effective_configuration(uuid) to authenticated;
grant execute on function result_effective_configuration(uuid) to service_role;
revoke all on function result_semester_phase(uuid,semester,date) from public, anon, authenticated, service_role;
grant execute on function result_semester_phase(uuid,semester,date) to public;
grant execute on function result_semester_phase(uuid,semester,date) to anon;
grant execute on function result_semester_phase(uuid,semester,date) to authenticated;
grant execute on function result_semester_phase(uuid,semester,date) to service_role;
revoke all on function save_result_configuration(uuid,semester,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function save_result_configuration(uuid,semester,text,jsonb) to authenticated;
grant execute on function save_result_configuration(uuid,semester,text,jsonb) to service_role;
revoke all on function save_result_configuration_bulk(uuid,semester[],text[],jsonb) from public, anon, authenticated, service_role;
grant execute on function save_result_configuration_bulk(uuid,semester[],text[],jsonb) to authenticated;
grant execute on function save_result_configuration_bulk(uuid,semester[],text[],jsonb) to service_role;
revoke all on function school_today() from public, anon, authenticated, service_role;
grant execute on function school_today() to public;
grant execute on function school_today() to anon;
grant execute on function school_today() to authenticated;
grant execute on function school_today() to service_role;
revoke all on function self_register_link_children(text[]) from public, anon, authenticated, service_role;
grant execute on function self_register_link_children(text[]) to public;
grant execute on function self_register_link_children(text[]) to anon;
grant execute on function self_register_link_children(text[]) to authenticated;
grant execute on function self_register_link_children(text[]) to service_role;
revoke all on function set_fee_schedule_applicable_grades(uuid,text[]) from public, anon, authenticated, service_role;
grant execute on function set_fee_schedule_applicable_grades(uuid,text[]) to anon;
grant execute on function set_fee_schedule_applicable_grades(uuid,text[]) to authenticated;
grant execute on function set_fee_schedule_applicable_grades(uuid,text[]) to service_role;
revoke all on function set_fee_schedule_billed_months(uuid,date[]) from public, anon, authenticated, service_role;
grant execute on function set_fee_schedule_billed_months(uuid,date[]) to anon;
grant execute on function set_fee_schedule_billed_months(uuid,date[]) to authenticated;
grant execute on function set_fee_schedule_billed_months(uuid,date[]) to service_role;
revoke all on function staff_advance_balance(uuid) from public, anon, authenticated, service_role;
grant execute on function staff_advance_balance(uuid) to public;
grant execute on function staff_advance_balance(uuid) to anon;
grant execute on function staff_advance_balance(uuid) to authenticated;
grant execute on function staff_advance_balance(uuid) to service_role;
revoke all on function staff_group_for_position(staff_position) from public, anon, authenticated, service_role;
grant execute on function staff_group_for_position(staff_position) to public;
grant execute on function staff_group_for_position(staff_position) to anon;
grant execute on function staff_group_for_position(staff_position) to authenticated;
grant execute on function staff_group_for_position(staff_position) to service_role;
revoke all on function student_grade_for_year(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function student_grade_for_year(uuid,uuid) to anon;
grant execute on function student_grade_for_year(uuid,uuid) to authenticated;
grant execute on function student_grade_for_year(uuid,uuid) to service_role;
revoke all on function teacher_academic_action_ok(date) from public, anon, authenticated, service_role;
grant execute on function teacher_academic_action_ok(date) to public;
grant execute on function teacher_academic_action_ok(date) to anon;
grant execute on function teacher_academic_action_ok(date) to authenticated;
grant execute on function teacher_academic_action_ok(date) to service_role;
revoke all on function teaches_class_subject(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function teaches_class_subject(uuid,uuid) to public;
grant execute on function teaches_class_subject(uuid,uuid) to anon;
grant execute on function teaches_class_subject(uuid,uuid) to authenticated;
grant execute on function teaches_class_subject(uuid,uuid) to service_role;
revoke all on function teaches_or_heads_class(uuid) from public, anon, authenticated, service_role;
grant execute on function teaches_or_heads_class(uuid) to public;
grant execute on function teaches_or_heads_class(uuid) to anon;
grant execute on function teaches_or_heads_class(uuid) to authenticated;
grant execute on function teaches_or_heads_class(uuid) to service_role;
revoke all on function touch_presence() from public, anon, authenticated, service_role;
grant execute on function touch_presence() to authenticated;
grant execute on function touch_presence() to service_role;
revoke all on function update_expense(uuid,date,text,jsonb,text,text,text,text,text) from public, anon, authenticated, service_role;
grant execute on function update_expense(uuid,date,text,jsonb,text,text,text,text,text) to anon;
grant execute on function update_expense(uuid,date,text,jsonb,text,text,text,text,text) to authenticated;
grant execute on function update_expense(uuid,date,text,jsonb,text,text,text,text,text) to service_role;
revoke all on function void_payment(uuid,text,uuid,user_role,text) from public, anon, authenticated, service_role;
grant execute on function void_payment(uuid,text,uuid,user_role,text) to anon;
grant execute on function void_payment(uuid,text,uuid,user_role,text) to authenticated;
grant execute on function void_payment(uuid,text,uuid,user_role,text) to service_role;

-- the helper introduced by migration 1 is no longer referenced by any function
drop function if exists public.is_trusted_backend();
