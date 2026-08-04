<script>
	import katex from 'katex';
	import { base } from '$app/paths';

	export let math;
	export let displayMode = false;
	export let style;

	const options = {
		displayMode,
		throwOnError: false,
		style
	};

	$: katexString = katex.renderToString(math, options);
</script>

<svelte:head>
	<!--
		Self-hosted from static/katex/ instead of jsDelivr, so a study session makes
		no third-party requests. Vendored copy is katex 0.16.10 (the version in
		package.json), which also fixes upstream's mismatch against the 0.12.0 CSS
		it was loading from the CDN.
	-->
	<link rel="stylesheet" href={`${base}/katex/katex.min.css`} />
</svelte:head>

{@html katexString}
