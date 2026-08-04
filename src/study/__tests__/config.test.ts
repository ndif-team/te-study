/**
 * Guards the two content constraints that are easy to violate while editing
 * study text and impossible to notice until a participant is stuck.
 */
import { describe, it, expect } from 'vitest';
import { STUDY_UNITS } from '../config';

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

describe('study content constraints', () => {
	it('every prompt fits GPT-2 inside Transformer Explainer', () => {
		// InputForm.svelte: `const wordLimit = 12` and it blocks at
		// `split(' ').length >= wordLimit`, so 12 words is already too many.
		for (const unit of STUDY_UNITS) {
			if (!unit.prompt) continue;
			expect(
				wordCount(unit.prompt),
				`unit "${unit.id}" prompt is ${wordCount(unit.prompt)} words; TE blocks at 12`
			).toBeLessThanOrEqual(11);
		}
	});

	it('unit ids are unique and stable-looking', () => {
		const ids = STUDY_UNITS.map((u) => u.id);
		expect(new Set(ids).size, 'duplicate unit id would merge two steps in analysis').toBe(
			ids.length
		);
		for (const id of ids) {
			expect(id).toMatch(/^u\d+-[a-z0-9-]+$/);
			// te_events.step_id is varchar(64)
			expect(id.length).toBeLessThanOrEqual(64);
		}
	});

	it('every unit has an answerable check', () => {
		for (const unit of STUDY_UNITS) {
			expect(unit.check.question.length, `unit "${unit.id}" needs a question`).toBeGreaterThan(0);
			if (unit.check.kind === 'choice') {
				expect(unit.check.options.length).toBeGreaterThanOrEqual(2);
				expect(unit.check.correctIndex).toBeGreaterThanOrEqual(0);
				expect(unit.check.correctIndex).toBeLessThan(unit.check.options.length);
			}
		}
	});

	it('matches the Workbench arm on unit count, for the arm-parity claim', () => {
		// prolific-tutorial-design-spec.md §3 defines units 0-6 for Patch Lens.
		// Changing this number breaks the matched time budget in §6.
		expect(STUDY_UNITS.length).toBe(7);
	});

	it('exercises both check kinds, so both grading paths stay covered', () => {
		const kinds = new Set(STUDY_UNITS.map((u) => u.check.kind));
		expect(kinds.has('choice')).toBe(true);
		expect(kinds.has('top-token')).toBe(true);
	});
});
