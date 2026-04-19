<script lang="ts">
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from 'svelte-sonner';

	import favicon from '$lib/assets/favicon.svg';
	import ModeToggle from '$lib/components/mode-toggle.svelte';

	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<ModeWatcher />
<Toaster richColors position="bottom-right" />

<div class="fixed top-4 right-4 z-50">
	<ModeToggle />
</div>

{@render children()}
