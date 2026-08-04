import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Playwright does not read .env, but the specs need the Supabase URL, the anon
// key (to act as a participant) and the service-role key (to read telemetry
// back). Load it here so `npx playwright test` works with no preamble.
try {
	for (const line of readFileSync(new URL('.env', import.meta.url), 'utf8').split('\n')) {
		const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
		if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
	}
} catch {
	// CI writes these into the environment directly.
}

const PORT = Number(process.env.STUDY_DEV_PORT ?? 5199);

/**
 * The suite runs against `vite dev`, not `build && preview`, on purpose: the
 * production build copies ~720 MB of static assets (the ONNX chunks and the
 * vendored ORT runtime) into build/, which is pure waste per test run. Dev
 * serves them lazily, and VITE_STUDY_MOCK_MODEL means we never touch them.
 *
 * Tests share one local Supabase; specs must not assume an empty database.
 * Each spec scopes its assertions to a PROLIFIC_PID it generates.
 */
export default defineConfig({
	testDir: './tests',
	fullyParallel: false,
	workers: 1,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
	timeout: 60_000,
	expect: { timeout: 15_000 },
	use: {
		baseURL: `http://127.0.0.1:${PORT}`,
		trace: 'retain-on-failure',
		// The study refuses viewports under MIN_STUDY_WIDTH (1100). Default to a
		// desktop size; gate.spec.ts overrides this to assert the refusal.
		viewport: { width: 1440, height: 900 }
	},
	projects: [
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
				// devices['Desktop Chrome'] carries a 1280x720 viewport, which is
				// below MIN_STUDY_WIDTH (1300) and would put every test behind the
				// desktop-only gate. Project-level `use` wins over the top-level
				// block, so it has to be restated here.
				viewport: { width: 1600, height: 1000 }
			}
		}
	],
	webServer: {
		// --host 127.0.0.1 is load-bearing: Vite otherwise binds to `localhost`,
		// which resolves to ::1 first on GitHub runners, while the readiness probe
		// below polls 127.0.0.1. The server came up in ~1s and the probe still
		// timed out for the full budget.
		command: `npx vite dev --host 127.0.0.1 --port ${PORT} --strictPort`,
		url: `http://127.0.0.1:${PORT}`,
		reuseExistingServer: !process.env.CI,
		// Cold-start on a 2-core CI runner is slow: Vite has to pre-bundle a large
		// dep graph (d3, flowbite, onnxruntime-web, transformers.js) before it
		// serves anything, which blew past 180s. CI warms the cache with
		// `vite optimize` first; this is the headroom for the rest.
		timeout: 420_000,
		stdout: 'pipe',
		stderr: 'pipe'
	}
});
