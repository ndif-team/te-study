-- TE control-arm telemetry.
--
-- Mirrors the Workbench arm's `tutorial_events` table (see
-- workbench-workshops/prolific-tutorial-design-spec.md §5) so the two arms
-- union cleanly in the CHI analysis. Same event_type verbs, same
-- (session, step_id, payload, created_at) shape.
--
-- Participants are Supabase anonymous users, exactly as in the Workbench arm.
-- Because this app is a static site with no server, it cannot hold the
-- service-role key and therefore cannot stamp `app_metadata`. Prolific IDs go
-- into `user_metadata` at sign-in for convenience, but `te_sessions` — written
-- once at landing and immutable under RLS — is the authoritative copy.

create table te_sessions (
    -- Client-generated so the browser never needs to read a row back
    -- (a returning insert would require a SELECT policy, which we don't grant).
    id           uuid primary key,
    user_id      uuid not null unique references auth.users (id) on delete cascade,

    prolific_pid text,
    study_id     text,
    session_id   text,

    arm          text not null default 'transformer_explainer',

    user_agent   text,
    screen_w     integer,
    screen_h     integer,

    started_at   timestamptz not null default now()
);

create table te_events (
    id            uuid primary key default gen_random_uuid(),
    te_session_id uuid not null references te_sessions (id) on delete cascade,

    -- Denormalized from te_sessions. Carrying the owner directly on the row is
    -- what makes the insert policy a plain `user_id = auth.uid()` check.
    -- The obvious alternative — an EXISTS subquery against te_sessions — does
    -- not work: that subquery is itself subject to te_sessions' RLS, and we
    -- deliberately grant no SELECT policy there, so it always returns false and
    -- every insert 403s. This is also the authoritative grouping key for
    -- analysis (see the ownership note below).
    user_id       uuid not null references auth.users (id) on delete cascade,

    -- e.g. 'u3-patterns-beat-facts'; null for session-level events
    step_id       varchar(64),

    -- Shared with tutorial_events: step_started, step_completed, hint_shown,
    -- check_answered. TE-arm additions: landed, model_ready, prompt_run,
    -- interaction, study_completed.
    event_type    varchar(32) not null,

    payload       jsonb not null default '{}'::jsonb,
    created_at    timestamptz not null default now()
);

create index te_events_session_created_idx on te_events (te_session_id, created_at);
create index te_events_user_created_idx on te_events (user_id, created_at);
create index te_sessions_prolific_pid_idx on te_sessions (prolific_pid);

alter table te_sessions enable row level security;
alter table te_events enable row level security;

-- A participant may create exactly one session row, and only for themselves.
-- (`unique (user_id)` enforces the "exactly one" half.)
create policy te_sessions_insert_own on te_sessions
    for insert to authenticated
    with check (user_id = auth.uid());

-- ...and may append events only as themselves.
--
-- Ownership note: this checks the event's own user_id, not that the referenced
-- session belongs to the caller. A participant who somehow learned another
-- participant's te_session_id could therefore write an event pointing at it —
-- but the row would still be stamped with their own user_id, so it is inert:
-- analysis groups by te_events.user_id, which RLS guarantees is the true
-- author. Session ids are random uuids that are never exposed to any other
-- client, and the FK still guarantees the session exists.
create policy te_events_insert_own on te_events
    for insert to authenticated
    with check (user_id = auth.uid());

-- No select/update/delete policies: append-only by construction. Analysis
-- reads with the service-role key, which bypasses RLS.
--
-- PostgREST needs table privileges in addition to RLS. Grant INSERT only —
-- without this, `authenticated` has no rights at all and every insert 401s.
grant insert on table te_sessions to authenticated;
grant insert on table te_events to authenticated;
