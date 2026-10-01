-- Live evidence updates. results / result_components / notifications already stream over Supabase
-- Realtime; result_evidence did not, so when a teacher added, removed or reordered an evidence image
-- an open Parent screen kept showing the old set until a refresh. Adding the table lets the app refetch
-- evidence the moment it changes. Row access is unchanged: Realtime applies the table's RLS
-- (result_evidence_select), so a parent only receives changes for published results of their own child.
--
-- Additive and re-runnable; no row is written, updated or deleted.
-- Rollback: alter publication supabase_realtime drop table public.result_evidence;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'result_evidence'
  ) then
    alter publication supabase_realtime add table public.result_evidence;
  end if;
end $$;
