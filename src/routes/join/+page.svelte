<script lang="ts">
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import { toast } from 'svelte-sonner';
	import { fieldProxy, superForm } from 'sveltekit-superforms';
	import { valibotClient } from 'sveltekit-superforms/adapters';

	import * as Card from '$lib/components/ui/card';
	import * as Form from '$lib/components/ui/form';
	import * as Input from '$lib/components/ui/input';
	import { joinSchema } from '$lib/validators';

	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// superForm takes the initial form snapshot once; the returned stores hook up
	// their own reactivity via SvelteKit's page state, so the one-time capture of
	// `data.form` is intentional.
	// svelte-ignore state_referenced_locally
	const superform = superForm(data.form, {
		validators: valibotClient(joinSchema),
		resetForm: false,
		onUpdated({ form }) {
			if (form.message && !form.valid) {
				toast.error(form.message);
				// Form-level failure: clear the token + reset the widget so the user
				// can retry without a stale challenge in the hidden input.
				$turnstileTokenProxy = '';
				resetTurnstile();
			}
		}
	});

	const { form: formData, errors, enhance, submitting, message } = superform;

	// `fieldProxy` exposes `$formData.turnstileToken` as a plain Writable<string>
	// so the Turnstile callback can write the token without binding gymnastics.
	// Same pattern as `/login` uses for branch-specific fields — the token IS
	// form state, so it lives in `$formData` via the proxy, not a parallel `$state`.
	const turnstileTokenProxy = fieldProxy(superform, 'turnstileToken');

	// Turnstile widget lifecycle — lazy-load the Cloudflare script, render into
	// `turnstileEl`, and funnel the resulting token into the form field via
	// `turnstileTokenProxy` so it submits with the rest of the form data.
	let turnstileEl = $state<HTMLDivElement | null>(null);
	let turnstileWidgetId: string | null = null;

	$effect(() => {
		if (typeof window === 'undefined') return;
		if (!data.turnstileSiteKey) return;

		const render = () => {
			if (!turnstileEl || turnstileWidgetId !== null) return;
			const ts = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
			if (!ts) return;
			turnstileWidgetId = ts.render(turnstileEl, {
				sitekey: data.turnstileSiteKey,
				theme: 'auto',
				callback: (token) => {
					$turnstileTokenProxy = token;
				},
				'expired-callback': () => {
					$turnstileTokenProxy = '';
				},
				'error-callback': () => {
					$turnstileTokenProxy = '';
				}
			});
		};

		const existing = document.getElementById('cf-turnstile-script');
		if (existing) {
			render();
			return;
		}
		const script = document.createElement('script');
		script.id = 'cf-turnstile-script';
		script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
		script.async = true;
		script.defer = true;
		script.onload = render;
		document.head.appendChild(script);
	});

	function resetTurnstile() {
		if (typeof window === 'undefined') return;
		const ts = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
		if (ts && turnstileWidgetId !== null) ts.reset(turnstileWidgetId);
	}

	// `canSubmit` is a UX sugar gate: server-side validation stays authoritative.
	// We only keep it to mirror the original behavior — button stays visibly
	// inactive until the obvious preconditions are met.
	const canSubmit = $derived(
		$formData.code.length === 6 &&
			$formData.nickname.trim().length > 0 &&
			(!data.turnstileSiteKey || $turnstileTokenProxy.length > 0)
	);

	type TurnstileApi = {
		render: (
			el: HTMLElement,
			opts: {
				sitekey: string;
				theme?: 'auto' | 'light' | 'dark';
				callback?: (token: string) => void;
				'error-callback'?: () => void;
				'expired-callback'?: () => void;
			}
		) => string;
		reset: (widgetId?: string) => void;
	};
</script>

<svelte:head>
	<title>Join a quiz · Quizmo</title>
</svelte:head>

<main class="flex min-h-dvh items-center justify-center px-4 py-12">
	<Card.Root class="w-full max-w-sm">
		<Card.Header class="space-y-1 text-center">
			<div
				class="bg-primary/10 text-primary mx-auto mb-2 flex size-12 items-center justify-center rounded-2xl"
			>
				<SparklesIcon class="size-6" aria-hidden="true" />
			</div>
			<Card.Title class="text-2xl">Join a quiz</Card.Title>
			<Card.Description>Enter the code from your host and pick a nickname.</Card.Description>
		</Card.Header>

		<form method="POST" use:enhance>
			<Card.Content class="space-y-4">
				<Form.Field form={superform} name="code">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>Join code</Form.Label>
							<Input.Root
								{...props}
								type="text"
								inputmode="text"
								autocomplete="off"
								autocapitalize="characters"
								spellcheck={false}
								maxlength={6}
								placeholder="ABC123"
								class="text-center font-mono text-3xl tracking-[0.4em] uppercase"
								bind:value={$formData.code}
								oninput={(e) => {
									// Uppercase + strip non [A-Z0-9] as the user types. Max 6 chars.
									const v = (e.target as HTMLInputElement).value
										.toUpperCase()
										.replace(/[^A-Z0-9]/g, '')
										.slice(0, 6);
									$formData.code = v;
								}}
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>

				<Form.Field form={superform} name="nickname">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>Nickname</Form.Label>
							<Input.Root
								{...props}
								type="text"
								autocomplete="off"
								maxlength={20}
								placeholder="Your name"
								bind:value={$formData.nickname}
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>

				<!-- Turnstile token travels as a hidden input so FormData-mode submits
				     carry it, and the widget's callback is the only writer. -->
				<input type="hidden" name="turnstileToken" value={$formData.turnstileToken} />

				{#if data.turnstileSiteKey}
					<div class="flex justify-center">
						<div bind:this={turnstileEl} class="min-h-[65px]"></div>
					</div>
				{:else}
					<p class="text-muted-foreground text-center text-xs">
						Verification is currently unavailable. Joins may be rate-limited.
					</p>
				{/if}

				{#if $errors.turnstileToken}
					<p class="text-destructive text-sm" role="alert">{$errors.turnstileToken[0]}</p>
				{/if}

				{#if $message}
					<p class="text-destructive text-sm" role="alert">{$message}</p>
				{/if}
			</Card.Content>
			<Card.Footer>
				<Form.Button
					class="w-full"
					size="lg"
					aria-disabled={$submitting || !canSubmit}
					onclick={(e) => {
						if ($submitting || !canSubmit) e.preventDefault();
					}}
				>
					{#if $submitting}
						<Loader2Icon class="mr-2 size-4 animate-spin" aria-hidden="true" />
					{/if}
					Join
				</Form.Button>
			</Card.Footer>
		</form>
	</Card.Root>
</main>
