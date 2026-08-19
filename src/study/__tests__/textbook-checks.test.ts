import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TEXTBOOK_CHECKS } from '../config';
import { expectationFor, isReady, tokenAtRank } from '../checks';

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
			expect(
				check.options[check.correctIndex],
				`${key} correctIndex is out of range`
			).toBeDefined();
		}
	});
});

describe('recording, not grading', () => {
	const probs = [
		{ rank: 0, token: ' Paris' },
		{ rank: 1, token: ' France' }
	];

	/*
	 * The point of the whole module. Wave 2 told a participant their correct
	 * answer was wrong, on screen, and that verdict could not be taken back.
	 * Correctness is now decided in analysis, where it can be corrected.
	 */
	it('exposes no way to decide whether an answer is right', async () => {
		const mod = await import('../checks');
		expect(Object.keys(mod).sort()).toEqual(['expectationFor', 'isReady', 'tokenAtRank']);
	});

	it('records the rank-0 token, not the sampled one', () => {
		// TE samples, so `predictedToken` varies between runs of the same prompt.
		// What is recorded must not.
		expect(expectationFor(TEXTBOOK_CHECKS['how-transformers-work'], { probabilities: probs })).toBe(
			' Paris'
		);
	});

	it('records the runner-up for a rank-1 check', () => {
		expect(expectationFor(TEXTBOOK_CHECKS['output-probabilities'], { probabilities: probs })).toBe(
			' France'
		);
	});

	it('reads by rank rather than array position', () => {
		const reversed = [
			{ rank: 1, token: ' France' },
			{ rank: 0, token: ' Paris' }
		];
		expect(tokenAtRank({ probabilities: reversed }, 0)).toBe(' Paris');
	});

	it('records the live token count', () => {
		const state = { tokens: ['The', ' Eiffel', ' Tower', ' is'] };
		expect(expectationFor(TEXTBOOK_CHECKS['embedding'], state)).toBe('4');
	});

	it('records the configured option for a choice check', () => {
		// Stable, but recorded the same way so analysis has one rule per kind and
		// need not re-read a config that may since have moved.
		const check = TEXTBOOK_CHECKS['blocks'];
		expect(expectationFor(check, {})).toBe(check.kind === 'choice' ? check.options[1] : null);
	});

	it('is not ready before the model has produced anything', () => {
		// Keeps the submit control inert, so an eager click cannot record an answer
		// with nothing to interpret it against.
		expect(isReady(TEXTBOOK_CHECKS['how-transformers-work'], {})).toBe(false);
		expect(isReady(TEXTBOOK_CHECKS['embedding'], {})).toBe(false);
		expect(expectationFor(TEXTBOOK_CHECKS['how-transformers-work'], {})).toBeNull();
	});

	it('is ready for a choice check immediately', () => {
		expect(isReady(TEXTBOOK_CHECKS['blocks'], {})).toBe(true);
	});

	it('records a punctuation token as itself', () => {
		// The old normaliser reduced ',' to '' and then matched any punctuation
		// against it. Recording it verbatim leaves that decision to analysis.
		expect(
			expectationFor(TEXTBOOK_CHECKS['output-probabilities'], {
				probabilities: [
					{ rank: 0, token: ' the' },
					{ rank: 1, token: ',' }
				]
			})
		).toBe(',');
	});
});
