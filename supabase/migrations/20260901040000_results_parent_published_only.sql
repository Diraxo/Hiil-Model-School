-- Phase 3 checkpoint 2 (Results / Exams): tighten results / result_components SELECT so a Parent
-- only ever sees PUBLISHED (or LOCKED) results -- never a still-DRAFT score.
--
-- Why this is needed: can_view_result() only answers "is this person related to this student /
-- class / subject" -- it has no result id and so cannot consider publish_status. The original
-- results_select / result_components_select policies used it alone, which meant a Parent could
-- read a child's DRAFT (unpublished) component scores by querying the REST API directly, even
-- though every Parent-facing screen filters to PUBLISHED/LOCKED client-side. result_evidence_select
-- already gets this right (its Parent branch requires r.publish_status in ('PUBLISHED','LOCKED'));
-- this brings the score rows themselves in line with it.
--
-- Scope: this ONLY narrows the Parent path. Owner / Educational Director / the assigned subject
-- teacher are unchanged (the added clause is `not is_parent() or ...`). No writes are affected.
-- No functional change for anyone -- Parent UIs already hide non-published results.

drop policy if exists results_select on public.results;
create policy results_select on public.results
  for select
  using (
    public.can_view_result(class_id, subject_id, student_id)
    and (not public.is_parent() or publish_status in ('PUBLISHED', 'LOCKED'))
  );

drop policy if exists result_components_select on public.result_components;
create policy result_components_select on public.result_components
  for select
  using (exists (
    select 1
    from public.results r
    where r.id = result_components.result_id
      and public.can_view_result(r.class_id, r.subject_id, r.student_id)
      and (not public.is_parent() or r.publish_status in ('PUBLISHED', 'LOCKED'))
  ));
