import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		// Unit tests only. `tests/` holds the Playwright E2E suite, which needs a
		// browser and a live Supabase — run it with `npm run test:e2e`.
		include: ['src/**/*.test.ts'],
		environment: 'node'
	}
});
