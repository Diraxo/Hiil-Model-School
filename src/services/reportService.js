// Phase 1: reports are derived client-side from the current db snapshot.
// Phase 2: heavier aggregate reports can move to a Supabase view / RPC
// function so the browser isn't summing large tables itself.
export function createReportService(data) {
  return {
    snapshot: () => data.db,
  };
}
