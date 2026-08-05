import { test, expect } from '@playwright/test';
import { ANON_KEY } from './helpers';

/**
 * The anon key ships in a public bundle on a public repo, so these are the
 * assertions that make that safe. If any of them fail, the study database is
 * readable or mutable by anyone who views source.
 */
const API = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:56321';
const SERVICE = process.env.SERVICE_ROLE_KEY!;

type Signed = { token: string; userId: string };

async function signInAnon(): Promise<Signed> {
	const res = await fetch(`${API}/auth/v1/signup`, {
		method: 'POST',
		headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
		body: JSON.stringify({ data: { prolific_pid: 'rls-probe' } })
	});
	const json = await res.json();
	return { token: json.access_token, userId: json.user.id };
}

const asParticipant = (s: Signed, init: RequestInit = {}) => ({
	...init,
	headers: {
		apikey: ANON_KEY,
		Authorization: `Bearer ${s.token}`,
		'Content-Type': 'application/json',
		...(init.headers ?? {})
	}
});

test.describe('RLS contract', () => {
	test('a participant can insert their own session and events', async () => {
		const me = await signInAnon();
		const sid = crypto.randomUUID();

		const s = await fetch(
			`${API}/rest/v1/te_sessions`,
			asParticipant(me, {
				method: 'POST',
				body: JSON.stringify({ id: sid, user_id: me.userId, prolific_pid: 'rls-probe' })
			})
		);
		expect(s.status).toBe(201);

		const e = await fetch(
			`${API}/rest/v1/te_events`,
			asParticipant(me, {
				method: 'POST',
				body: JSON.stringify({ te_session_id: sid, user_id: me.userId, event_type: 'landed' })
			})
		);
		expect(e.status).toBe(201);
	});

	test('a participant cannot read any telemetry, including their own', async () => {
		const me = await signInAnon();
		for (const table of ['te_events', 'te_sessions']) {
			const res = await fetch(`${API}/rest/v1/${table}?select=*`, asParticipant(me));
			const body = await res.json();

			// Two acceptable outcomes, and the distinction is worth keeping visible:
			// a 200 with an empty array means RLS filtered everything out, while a
			// 4xx means `authenticated` holds no SELECT privilege at all. Both mean
			// no rows leak. Asserting only `toEqual([])` would silently pass on an
			// error object coerced to a default, hiding a change in which mechanism
			// is actually doing the work.
			if (res.ok) {
				expect(body, `${table} leaked rows to a participant`).toEqual([]);
			} else {
				expect(res.status, `${table} returned an unexpected error`).toBeGreaterThanOrEqual(400);
				expect(body.code, `${table} denied for an unexpected reason`).toBe('42501');
			}
		}
	});

	test('a participant cannot write events as another participant', async () => {
		const victim = await signInAnon();
		const attacker = await signInAnon();
		const sid = crypto.randomUUID();

		await fetch(
			`${API}/rest/v1/te_sessions`,
			asParticipant(victim, {
				method: 'POST',
				body: JSON.stringify({ id: sid, user_id: victim.userId })
			})
		);

		const forged = await fetch(
			`${API}/rest/v1/te_events`,
			asParticipant(attacker, {
				method: 'POST',
				body: JSON.stringify({
					te_session_id: sid,
					user_id: victim.userId,
					event_type: 'forged'
				})
			})
		);
		expect(forged.status).toBe(403);
	});

	test('a participant cannot create a session owned by someone else', async () => {
		const victim = await signInAnon();
		const attacker = await signInAnon();

		const res = await fetch(
			`${API}/rest/v1/te_sessions`,
			asParticipant(attacker, {
				method: 'POST',
				body: JSON.stringify({ id: crypto.randomUUID(), user_id: victim.userId })
			})
		);
		expect(res.status).toBe(403);
	});

	test('telemetry is append-only: updates and deletes change nothing', async () => {
		const me = await signInAnon();
		const sid = crypto.randomUUID();
		await fetch(
			`${API}/rest/v1/te_sessions`,
			asParticipant(me, {
				method: 'POST',
				body: JSON.stringify({ id: sid, user_id: me.userId, prolific_pid: 'rls-append' })
			})
		);
		await fetch(
			`${API}/rest/v1/te_events`,
			asParticipant(me, {
				method: 'POST',
				body: JSON.stringify({
					te_session_id: sid,
					user_id: me.userId,
					event_type: 'original'
				})
			})
		);

		// PostgREST answers 204 here because RLS filters the target set to zero
		// rows rather than refusing outright — so the assertion that matters is
		// that the data is untouched, not the status code.
		await fetch(
			`${API}/rest/v1/te_events?te_session_id=eq.${sid}`,
			asParticipant(me, { method: 'PATCH', body: JSON.stringify({ event_type: 'tampered' }) })
		);
		await fetch(
			`${API}/rest/v1/te_events?te_session_id=eq.${sid}`,
			asParticipant(me, { method: 'DELETE' })
		);

		const rows = await fetch(`${API}/rest/v1/te_events?te_session_id=eq.${sid}&select=event_type`, {
			headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` }
		}).then((r) => r.json());

		expect(rows).toHaveLength(1);
		expect(rows[0].event_type).toBe('original');
	});

	test('the anon key alone (no user session) can do nothing', async () => {
		const res = await fetch(`${API}/rest/v1/te_events`, {
			method: 'POST',
			headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				te_session_id: crypto.randomUUID(),
				user_id: crypto.randomUUID(),
				event_type: 'anon-write'
			})
		});
		expect(res.status).toBeGreaterThanOrEqual(400);

		const read = await fetch(`${API}/rest/v1/te_sessions?select=*`, {
			headers: { apikey: ANON_KEY }
		});
		const rows = await read.json();
		expect(Array.isArray(rows) ? rows : []).toEqual([]);
	});

	test('deleting an anonymous auth user does NOT destroy their telemetry', async () => {
		// Both tables once had `user_id references auth.users on delete cascade`,
		// so pruning an anonymous user silently erased that participant's session
		// and every event they produced. Anonymous users accumulate and the usual
		// advice is to prune them on a schedule — following that mid-study would
		// have deleted the dataset. This is the guard.
		const me = await signInAnon();
		const sid = crypto.randomUUID();
		const pid = `fk-guard-${Date.now()}`;

		await fetch(
			`${API}/rest/v1/te_sessions`,
			asParticipant(me, {
				method: 'POST',
				body: JSON.stringify({ id: sid, user_id: me.userId, prolific_pid: pid })
			})
		);
		await fetch(
			`${API}/rest/v1/te_events`,
			asParticipant(me, {
				method: 'POST',
				body: JSON.stringify({ te_session_id: sid, user_id: me.userId, event_type: 'landed' })
			})
		);

		const svc = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` };
		await fetch(`${API}/auth/v1/admin/users/${me.userId}`, { method: 'DELETE', headers: svc });

		const sessions = await fetch(`${API}/rest/v1/te_sessions?prolific_pid=eq.${pid}&select=id`, {
			headers: svc
		}).then((r) => r.json());
		expect(sessions, 'session was destroyed by deleting the auth user').toHaveLength(1);

		const events = await fetch(`${API}/rest/v1/te_events?te_session_id=eq.${sid}&select=id`, {
			headers: svc
		}).then((r) => r.json());
		expect(events, 'events were destroyed by deleting the auth user').toHaveLength(1);

		// A deliberate purge must still work, and still take the events with it.
		await fetch(`${API}/rest/v1/te_sessions?id=eq.${sid}`, { method: 'DELETE', headers: svc });
		const after = await fetch(`${API}/rest/v1/te_events?te_session_id=eq.${sid}&select=id`, {
			headers: svc
		}).then((r) => r.json());
		expect(after, 'purging a session should cascade to its events').toHaveLength(0);
	});
});
