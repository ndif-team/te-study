import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The pilot's dominant failure mode: Begin was `disabled` until all ~627 MB of
 * weights arrived, so most participants left before `model_ready` ever fired.
 *
 * This is asserted against the source rather than the rendered page because the
 * E2E suite runs in mock-model mode, where `isFetchingModel` is false from the
 * first frame — the loading state that caused the dropout is precisely the one
 * CI cannot reproduce. A source-level guard is crude, but it fails if someone
 * reintroduces the block, which is the regression that actually cost us data.
 */
const gate = readFileSync(
	fileURLToPath(new URL('../Gate.svelte', import.meta.url)),
	'utf8'
);

describe('the intro gate does not block on the model download', () => {
	const beginButton = gate.match(/<button[^>]*data-testid="begin-study"[^>]*>/)?.[0];

	it('renders a Begin button', () => {
		expect(beginButton, 'begin-study button not found in Gate.svelte').toBeTruthy();
	});

	it('never disables Begin while the model is still downloading', () => {
		expect(beginButton).not.toMatch(/disabled/);
	});

	it('still tells the participant a download is happening', () => {
		// Removing the block must not mean removing the explanation: an unexplained
		// dead text input is its own kind of confusing.
		expect(gate).toMatch(/data-testid="model-loading"/);
	});

	it('tells them they can start without waiting', () => {
		expect(gate.toLowerCase()).toMatch(/do not need to wait/);
	});
});
