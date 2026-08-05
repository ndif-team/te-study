-- Stop participant telemetry being destroyed as a side effect of auth cleanup.
--
-- Both tables carried `user_id ... references auth.users (id) on delete cascade`.
-- That means deleting one anonymous auth user silently removes that
-- participant's te_sessions row AND every te_events row they produced. It is
-- not hypothetical: it happened twice during setup, when smoke-test users were
-- tidied up and took their telemetry with them.
--
-- For a live study this is a standing hazard rather than a tidy-up nuisance:
--
--   * Anyone clearing "test users" in the Supabase Auth dashboard deletes real
--     participant data, with no warning and no trace in the tables themselves.
--   * Anonymous users accumulate, and the standard advice is to prune them on a
--     schedule. Someone acting on that advice mid-study would erase the dataset.
--
-- The foreign key buys nothing here. RLS already guarantees integrity at the
-- only moment it matters: `with check (user_id = auth.uid())` means a row
-- cannot be inserted with anything other than the caller's real authenticated
-- id. Nothing reads through the FK either — te_sessions holds the Prolific ids
-- itself, and the analysis groups by user_id directly.
--
-- So drop the FK and keep user_id as a plain uuid. Deleting a participant's
-- data becomes an explicit DELETE against te_sessions, which is the right shape
-- for a deletion request: a deliberate act, not a side effect of unrelated
-- housekeeping.

alter table public.te_sessions drop constraint if exists te_sessions_user_id_fkey;
alter table public.te_events drop constraint if exists te_events_user_id_fkey;

-- te_events -> te_sessions stays ON DELETE CASCADE. That one is intra-dataset
-- and desirable: purging a participant should take their events with it.

comment on column public.te_sessions.user_id is
    'Supabase anonymous auth uid. Deliberately NOT a foreign key: an FK to '
    'auth.users would cascade-delete study data whenever an anonymous user is '
    'pruned. Integrity is enforced by the RLS insert policy instead.';

comment on column public.te_events.user_id is
    'Supabase anonymous auth uid, denormalized from te_sessions. Authoritative '
    'grouping key for analysis; guaranteed by RLS to be the true author.';
