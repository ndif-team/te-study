import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TEXTBOOK_CHECKS } from '../config';
import { gradeCheck, normalise, tokenAtRank } from '../checks';

/**
 * `textbookPages.ts` imports Svelte components and TE's animation helpers, so it
 * cannot be imported under plain vitest. The page ids are read out of the source
 * instead — the point is to catch a typo'd key, and for that the literal list is
 * exactly the right source of truth.
 */
const pageSrc = readFileSync(
	fileURLToPath(new URL('../../utils/textbookPages.ts', import.meta.url)),
	'utf8'
);
const PAGE_IDS = [...pageSrc.matchAll(/^\t\tid: '([a-z0-9-]+)'/gm)].map((m) => m[1]);

describe('textbook check wiring', () => {
	it('reads a plausible set of page ids from upstream', () => {
		expect(PAGE_IDS.length).toBeGreaterThanOrEqual(15);
		expect(PAGE_IDS).toContain('masked-self-attention');
	});

	it('every check key matches a real TE textbook page', () => {
		// A key that matches nothing renders nothing, silently — the check would
		// just never appear, and nothing else would fail.
		for (const key of Object.keys(TEXTBOOK_CHECKS)) {
			expect(PAGE_IDS, `no TE textbook page with id "${key}"`).toContain(key);
		}
	});

	it('covers 8-10 pages, not all of them', () => {
		// A question on every page turns a walkthrough into an exam.
		const n = Object.keys(TEXTBOOK_CHECKS).length;
		expect(n).toBeGreaterThanOrEqual(8);
		expect(n).toBeLessThanOrEqual(10);
		expect(n).toBeLessThan(PAGE_IDS.length);
	});

	it('never asks what the model "said" — TE samples, so that has no stable answer', () => {
		// The determinism rule, enforced rather than documented. Wording that asks
		// for the model's OUTPUT would be graded against rank 0 and mark people
		// wrong at random whenever TE sampled something else.
		const banned = /\b(did the model (say|output|pick|choose)|what did it (say|output|pick))\b/i;
		for (const [key, check] of Object.entries(TEXTBOOK_CHECKS)) {
			expect(check.question, `${key} asks about the sampled output`).not.toMatch(banned);
		}
	});

	it('choice checks have a correctIndex that exists', () => {
		for (const [key, check] of Object.entries(TEXTBOOK_CHECKS)) {
			if (check.kind !== 'choice') continue;
			expect(check.options.length, `${key} needs at least two options`).toBeGreaterThan(1);
			expect(check.options[check.correctIndex], `${key} correctIndex is out of range`).toBeDefined();
		}
	});
});

describe('grading', () => {
	const probs = [
		{ rank: 0, token: ' Paris' },
		{ rank: 1, token: ' France' }
	];

	it('grades a top-token check against rank 0, not the sampled token', () => {
		const check = TEXTBOOK_CHECKS['how-transformers-work'];
		expect(gradeCheck(check, { text: 'Paris' }, { probabilities: probs })).toMatchObject({
			correct: true,
			expected: ' Paris'
		});
		expect(gradeCheck(check, { text: 'France' }, { probabilities: probs })?.correct).toBe(false);
	});

	it('grades a rank-1 check against the runner-up', () => {
		const check = TEXTBOOK_CHECKS['output-probabilities'];
		expect(gradeCheck(check, { text: 'France' }, { probabilities: probs })?.correct).toBe(true);
		expect(gradeCheck(check, { text: 'Paris' }, { probabilities: probs })?.correct).toBe(false);
	});

	it('forgives the leading space GPT-2 tokens carry, and case', () => {
		expect(normalise(' Paris')).toBe('paris');
		expect(normalise('paris.')).toBe('paris');
	});

	it('reads by rank rather than array position', () => {
		const reversed = [
			{ rank: 1, token: ' France' },
			{ rank: 0, token: ' Paris' }
		];
		expect(tokenAtRank({ probabilities: reversed }, 0)).toBe(' Paris');
	});

	it('grades token-count against the live tokenisation', () => {
		const check = TEXTBOOK_CHECKS['embedding'];
		const state = { tokens: ['The', ' Eiffel', ' Tower', ' is'] };
		expect(gradeCheck(check, { text: '4' }, state)?.correct).toBe(true);
		expect(gradeCheck(check, { text: '3' }, state)?.correct).toBe(false);
	});

	it('refuses to grade before the model has produced anything', () => {
		// Otherwise an eager click records a wrong answer the participant never
		// had a chance to get right.
		expect(gradeCheck(TEXTBOOK_CHECKS['how-transformers-work'], { text: 'Paris' }, {})).toBeNull();
		expect(gradeCheck(TEXTBOOK_CHECKS['embedding'], { text: '4' }, {})).toBeNull();
	});

	it('refuses to grade an empty answer', () => {
		expect(
			gradeCheck(TEXTBOOK_CHECKS['how-transformers-work'], { text: '  ' }, { probabilities: probs })
		).toBeNull();
		expect(gradeCheck(TEXTBOOK_CHECKS['blocks'], { choice: null }, {})).toBeNull();
	});
});
