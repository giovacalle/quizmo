<script lang="ts">
	import '../app.css';

	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();

	function toggleDark() {
		document.documentElement.classList.toggle('dark');
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="fixed top-4 right-4 z-50">
	<!-- @ts-expect-error one-off until replaces this with mode-toggle.svelte -->
	<button
		type="button"
		onclick={toggleDark}
		class="bg-card text-foreground border-border rounded-md border px-3 py-1.5 text-sm shadow-sm"
	>
		Toggle theme
	</button>
</div>

{@render children()}
