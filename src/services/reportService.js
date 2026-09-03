// Reports are derived client-side from the current in-memory `db` snapshot (itself populated
// from Supabase). Heavier aggregate reports could move to a Supabase view / RPC later so the
// browser isn't summing large tables itself.
export function createReportService(data) {
  return {
    snapshot: () => data.db,
  };
}
