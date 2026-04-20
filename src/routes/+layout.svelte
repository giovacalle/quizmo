<script lang="ts">
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from 'svelte-sonner';
	import { fade } from 'svelte/transition';

	import { page } from '$app/state';
	import ModeToggle from '$lib/components/mode-toggle.svelte';

	import '../app.css';

	let { children } = $props();

	// Keyed wrapper for the route-level crossfade. `page.route.id` changes on
	// every navigation, so Svelte unmounts the old `div` + mounts a new one,
	// triggering the transition directives. ModeToggle + Toaster live OUTSIDE
	// the keyed block so they don't flicker on every navigation.
	const routeId = $derived(page.route?.id ?? '');
</script>

<svelte:head>
	<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
	<meta name="theme-color" content="#4F46E5" media="(prefers-color-scheme: light)" />
	<meta name="theme-color" content="#0F0F14" media="(prefers-color-scheme: dark)" />
</svelte:head>

<ModeWatcher />
<Toaster richColors position="top-center" />

<div class="fixed top-4 right-4 z-50">
	<ModeToggle />
</div>

{#key routeId}
	<div in:fade={{ duration: 180, delay: 40 }} out:fade={{ duration: 120 }}>
		{@render children()}
	</div>
{/key}
