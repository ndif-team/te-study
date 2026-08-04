-- Make table privileges explicit rather than inherited.
--
-- The initial migration granted INSERT to `authenticated` and said nothing about
-- `service_role`, relying on the `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON
-- TABLES TO anon, authenticated, service_role` that a Supabase project normally
-- carries. That held on this machine (CLI 2.26.6) and on the hosted project, but
-- NOT on a database created by the newer CLI in CI, where every analysis read
-- failed with:
--
--   42501 permission denied for table te_sessions
--
-- A study database may well be recreated — for a pilot, a second wave, or a
-- restore — so the schema should not depend on ambient platform defaults it
-- cannot see. These grants are idempotent and safe to apply where the defaults
-- already provided them.
--
-- Note this changes nothing about who can read the data: RLS is what confines
-- participants, and it is unchanged. `service_role` bypasses RLS by design and
-- is the key the analysis uses; it still needs table privileges on top.

grant select, insert, update, delete on table public.te_sessions to service_role;
grant select, insert, update, delete on table public.te_events to service_role;

-- Participants: append-only, exactly as before. Restated so the full privilege
-- picture lives in one place.
grant insert on table public.te_sessions to authenticated;
grant insert on table public.te_events to authenticated;

-- `anon` (an unauthenticated visitor holding only the public key) gets nothing.
-- Supabase's defaults hand it GRANT ALL; RLS blocks it regardless, but there is
-- no reason to leave the privilege sitting there.
revoke all on table public.te_sessions from anon;
revoke all on table public.te_events from anon;
