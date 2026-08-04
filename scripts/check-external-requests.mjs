/**
 * Loads the production build and fails if the page talks to anything other than
 * its own origin and the configured Supabase project.
 *
 * This is the check behind the IRB answer "participant data goes to our
 * Supabase project and nowhere else", and behind the self-hosting claim: TE
 * upstream pulls its ONNX runtime from jsDelivr and its tokenizer from the
 * Hugging Face CDN, both of which we vendor.
 *
 *   node scripts/check-external-requests.mjs <url> [--wait-ms 60000]
 */
import { chromium } from '@playwright/test';

const url = process.argv[2];
if (!url) {
	console.error('usage: node scripts/check-external-requests.mjs <url> [--wait-ms N]');
	process.exit(2);
}
const waitIdx = process.argv.indexOf('--wait-ms');
const waitMs = waitIdx > -1 ? Number(process.argv[waitIdx + 1]) : 60_000;

const pageOrigin = new URL(url).origin;
const supabaseOrigin = process.env.VITE_SUPABASE_URL
	? new URL(process.env.VITE_SUPABASE_URL).origin
	: null;

const ALWAYS_BAD = [
	'googletagmanager.com',
	'google-analytics.com',
	'doubleclick.net',
	'posthog.com',
	'i.posthog.com',
	'cdn.jsdelivr.net',
	'huggingface.co',
	'cdn-lfs.huggingface.co',
	'unpkg.com'
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const external = new Set();
const flagged = new Set();

page.on('request', (req) => {
	const u = req.url();
	if (u.startsWith('data:') || u.startsWith('blob:')) return;
	const origin = new URL(u).origin;
	if (origin === pageOrigin) return;
	if (supabaseOrigin && origin === supabaseOrigin) return;
	external.add(origin);
	if (ALWAYS_BAD.some((host) => new URL(u).hostname.endsWith(host))) flagged.add(u);
});

await page.goto(url, { waitUntil: 'load' });
// Let the model/tokenizer load and the study bootstrap run.
await page.waitForTimeout(waitMs);

const modelReady = await page
	.getByTestId('begin-study')
	.isEnabled()
	.catch(() => false);

// Which ONNX wasm variant actually got fetched — decides what we can drop from static/ort.
const ortFetched = await page.evaluate(() =>
	performance
		.getEntriesByType('resource')
		.map((e) => e.name)
		.filter((n) => n.includes('/ort/'))
		.map((n) => n.split('/').pop())
);

await browser.close();

console.log('page origin      :', pageOrigin);
console.log('supabase origin  :', supabaseOrigin ?? '(unset)');
console.log('model ready      :', modelReady);
console.log('ort files fetched:', ortFetched.length ? ortFetched.join(', ') : '(none)');
console.log('other origins    :', external.size ? [...external].join(', ') : '(none)');

if (flagged.size) {
	console.error('\nFAIL — requests to known third-party hosts:');
	for (const u of flagged) console.error('  ' + u);
	process.exit(1);
}
if (external.size) {
	console.error('\nFAIL — unexpected external origins:', [...external].join(', '));
	process.exit(1);
}
console.log('\nOK — no third-party requests.');
