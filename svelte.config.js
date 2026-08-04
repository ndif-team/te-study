// import adapter from '@sveltejs/adapter-auto';
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://kit.svelte.dev/docs/integrations#preprocessors
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		// adapter-auto only supports some environments, see https://kit.svelte.dev/docs/adapter-auto for a list.
		// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
		// See https://kit.svelte.dev/docs/adapters for more information about adapters.
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: null,
			precompress: false,
			strict: false // Ignore errors about dynamic routes
		}),
		prerender: {
			// List the specific routes to prerender
			entries: ['/' /* other routes if needed */]
		},
		alias: {
			'~': './src'
		},
		paths: {
			// Repo name on GitHub Pages (https://ndif-team.github.io/te-study/).
			// Override with BASE_PATH= for a custom domain or a different repo name;
			// set BASE_PATH= (empty) when serving from a domain root.
			base:
				process.env.NODE_ENV === 'production'
					? (process.env.BASE_PATH ?? '/te-study')
					: ''
		}
	}
};

export default config;
