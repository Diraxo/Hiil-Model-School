import { useCallback, useEffect, useRef, useState } from "react";

// System-wide duplicate-action / double-click protection (Level 1 + Level 2 of the
// duplicate-protection plan). This is the single reusable mechanism every mutation
// call site should route through instead of hand-rolling `useState(submitting)`.
//
//   const { busy, run } = useMutationGuard();
//   async function submit() {
//     // ...validation that can bail early without a network call...
//     await run(async () => {
//       const res = await data.createStudent(form);
//       if (!res.ok) { toast(res.message, "error"); return; }
//       toast("Student added.", "success");
//       onClose();
//     });
//   }
//   <PrimaryButton onClick={submit} loading={busy}>Create Student</PrimaryButton>
//
// One intentional action == one execution. Extra clicks / repeated Enter presses /
// re-renders while a call is in flight are ignored; once it settles the same action
// can be performed again (this is NOT a permanent lock).

// Module-level in-flight registry, keyed by a caller-supplied stable operation key.
// This de-dupes the *same* logical operation even when two different components fire
// it in the same tick (the classic StrictMode / doubled-effect case, and the
// "two buttons wired to the same mutation" case). The entry is removed as soon as
// the promise settles so a later legitimate repeat of the action still runs.
const globalInFlight = new Map();

// Run `fn` at most once concurrently for a given `key`. Concurrent callers with the
// same key share the first call's promise (and therefore its result / rejection).
// Pass `key == null` to skip cross-component de-duping (component-local guarding in
// useMutationGuard still applies) -- appropriate for create-style actions that have
// no natural identity until the row exists.
export function runOnce(key, fn) {
  if (key != null && globalInFlight.has(key)) return globalInFlight.get(key);
  let p;
  try {
    p = Promise.resolve(fn());
  } catch (err) {
    p = Promise.reject(err);
  }
  if (key != null) {
    globalInFlight.set(key, p);
    p.then(
      () => globalInFlight.delete(key),
      () => globalInFlight.delete(key),
    );
  }
  return p;
}

const DEFAULT_KEY = "__default__";

// Guards async mutation handlers in a component against duplicate execution.
// `run(fn, { key })` ignores re-entrant calls for the same key while one is in
// flight. `busy` is true while any call is running; `isBusy(key)` / `busyKey` let a
// single hook instance drive per-row buttons (e.g. an approve/reject list) without a
// child component per row.
export function useMutationGuard() {
  const [busyKeys, setBusyKeys] = useState(() => new Set());
  const activeRef = useRef(new Set());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const sync = useCallback(() => {
    if (mountedRef.current) setBusyKeys(new Set(activeRef.current));
  }, []);

  const run = useCallback(async (fn, opts = {}) => {
    const localKey = opts.key == null ? DEFAULT_KEY : opts.key;
    if (activeRef.current.has(localKey)) return undefined;
    activeRef.current.add(localKey);
    sync();
    try {
      return await runOnce(opts.key == null ? null : opts.key, fn);
    } finally {
      activeRef.current.delete(localKey);
      sync();
    }
  }, [sync]);

  const isBusy = useCallback(
    (key) => busyKeys.has(key == null ? DEFAULT_KEY : key),
    [busyKeys],
  );

  return {
    busy: busyKeys.size > 0,
    busyKey: busyKeys.size ? [...busyKeys][0] : null,
    isBusy,
    run,
  };
}
