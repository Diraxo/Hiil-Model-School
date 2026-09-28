-- ONE-OFF (owner-run): delete the test result rows. Aborts, deleting nothing, unless production holds
-- exactly 2 results / 2 scores / 0 evidence pages (what was there when this was written). One atomic block.
-- Does not touch students, enrollments, or the result structures. Deleting a result also removes its
-- change-history entries (they are tied to the row).
do $$
declare n_r int; n_c int; n_e int; d_c int; d_r int; left_r int; left_c int;
begin
  select count(*) into n_r from public.results;
  select count(*) into n_c from public.result_components;
  select count(*) into n_e from public.result_evidence;
  if n_r <> 2 or n_c <> 2 or n_e <> 0 then
    raise exception 'Aborted, nothing deleted: expected 2 results / 2 scores / 0 evidence, found % / % / %', n_r, n_c, n_e;
  end if;
  delete from public.result_components; get diagnostics d_c = row_count;
  delete from public.results; get diagnostics d_r = row_count;
  select count(*) into left_r from public.results;
  select count(*) into left_c from public.result_components;
  if left_r <> 0 or left_c <> 0 then raise exception 'Aborted: rows remain (% results, % scores)', left_r, left_c; end if;
  raise notice 'deleted % results and % scores', d_r, d_c;
end $$;

select (select count(*) from public.results) as results,
       (select count(*) from public.result_components) as components,
       (select count(*) from public.result_configurations) as structures_kept;
