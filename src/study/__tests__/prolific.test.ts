/**
 * Mirrors the Workbench arm's `src/db/__tests__/prolific.test.ts` so both arms
 * are demonstrably parsing Prolific arrivals the same way. If these two files
 * ever disagree, the arms are no longer comparable on attribution.
 */
import { describe, it, expect } from 'vitest';
import { parseProlificParams, parseProlificFromUrl, buildHandoffUrl } from '../prolific';

describe('parseProlificParams', () => {
	it('extracts the canonical Prolific keys', () => {
		expect(
			parseProlificParams({
				PROLIFIC_PID: 'pid-123',
				STUDY_ID: 'study-456',
				SESSION_ID: 'sess-789'
			})
		).toEqual({ prolificPid: 'pid-123', studyId: 'study-456', sessionId: 'sess-789' });
	});

	it('returns null when no Prolific params are present', () => {
		expect(parseProlificParams({})).toBeNull();
		expect(parseProlificParams({ foo: 'bar', ref: 'twitter' })).toBeNull();
	});

	it('keeps whatever subset Prolific sends', () => {
		expect(parseProlificParams({ PROLIFIC_PID: 'pid-only' })).toEqual({ prolificPid: 'pid-only' });
	});

	it('accepts lower_case keys defensively and takes the first repeated value', () => {
		expect(parseProlificParams({ prolific_pid: 'lc' })).toEqual({ prolificPid: 'lc' });
		expect(parseProlificParams({ PROLIFIC_PID: ['a', 'b'] })).toEqual({ prolificPid: 'a' });
	});

	it('ignores blank/whitespace-only values', () => {
		expect(parseProlificParams({ PROLIFIC_PID: '  ', STUDY_ID: '' })).toBeNull();
	});
});

describe('parseProlificFromUrl', () => {
	it('reads the identifiers off a real query string', () => {
		const search = new URLSearchParams('PROLIFIC_PID=abc&STUDY_ID=s1&SESSION_ID=x1&other=ignored');
		expect(parseProlificFromUrl(search)).toEqual({
			prolificPid: 'abc',
			studyId: 's1',
			sessionId: 'x1'
		});
	});

	it('takes the first value when Prolific repeats a param', () => {
		const search = new URLSearchParams('PROLIFIC_PID=first&PROLIFIC_PID=second');
		expect(parseProlificFromUrl(search)).toEqual({ prolificPid: 'first' });
	});

	it('returns null for a direct visit', () => {
		expect(parseProlificFromUrl(new URLSearchParams(''))).toBeNull();
	});
});

describe('buildHandoffUrl', () => {
	it('carries the identifiers to the post-survey', () => {
		const url = new URL(
			buildHandoffUrl('https://example.qualtrics.com/jfe/form/SV_1', {
				prolificPid: 'abc',
				studyId: 's1',
				sessionId: 'x1'
			})
		);
		expect(url.searchParams.get('PROLIFIC_PID')).toBe('abc');
		expect(url.searchParams.get('STUDY_ID')).toBe('s1');
		expect(url.searchParams.get('SESSION_ID')).toBe('x1');
	});

	it('preserves query params already on the configured survey URL', () => {
		const url = new URL(
			buildHandoffUrl('https://example.qualtrics.com/jfe/form/SV_1?Q_Lang=EN', {
				prolificPid: 'abc'
			})
		);
		expect(url.searchParams.get('Q_Lang')).toBe('EN');
		expect(url.searchParams.get('PROLIFIC_PID')).toBe('abc');
	});

	it('is empty when the survey URL is unconfigured, so the UI can warn', () => {
		expect(buildHandoffUrl('', { prolificPid: 'abc' })).toBe('');
	});

	it('still produces a usable link when there are no Prolific params', () => {
		expect(buildHandoffUrl('https://example.qualtrics.com/jfe/form/SV_1', null)).toBe(
			'https://example.qualtrics.com/jfe/form/SV_1'
		);
	});
});
