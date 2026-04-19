<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	const messageByStatus: Record<number, { title: string; body: string }> = {
		400: { title: 'Invalid request', body: "We couldn't make sense of that. Try again." },
		401: { title: 'Sign-in required', body: 'Please sign in to continue.' },
		403: { title: 'Not allowed', body: "You don't have access to this resource." },
		404: { title: 'Not found', body: "We couldn't find what you were looking for." },
		409: { title: 'Conflict', body: 'That resource already exists or is in use.' },
		500: { title: 'Something went wrong', body: 'An unexpected error occurred on our end.' }
	};

	const fallback = { title: 'Something went wrong', body: 'Please try again in a moment.' };
	const status = $derived(page.status);
	const serverMessage = $derived(page.error?.message?.trim());
	const preset = $derived(messageByStatus[status] ?? fallback);
</script>

<svelte:head>
	<title>{status} · {preset.title}</title>
</svelte:head>

<main
	class="bg-background text-foreground flex min-h-screen items-center justify-center px-6 py-12"
>
	<section
		class="bg-card text-foreground border-border w-full max-w-md rounded-lg border p-8 shadow-sm"
	>
		<p class="text-muted-foreground text-sm font-medium tracking-wide uppercase">
			Error {status}
		</p>
		<h1 class="mt-2 text-2xl font-semibold">{preset.title}</h1>
		<p class="text-muted-foreground mt-3 text-base">
			{serverMessage || preset.body}
		</p>
		<a
			href={resolve('/')}
			class="text-primary mt-6 inline-flex text-sm font-medium underline-offset-4 hover:underline"
		>
			Back to home
		</a>
	</section>
</main>
