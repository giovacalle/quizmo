<script lang="ts">
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import { toast } from 'svelte-sonner';

	import { applyAction, enhance } from '$app/forms';
	import * as Button from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Input from '$lib/components/ui/input';
	import * as Label from '$lib/components/ui/label';

	import type { ActionData, PageData } from './$types';

	type FormPayload =
		| undefined
		| null
		| {
				code?: string;
				message?: string;
				values?: { code?: string; nickname?: string };
		  };
	type Props = { data: PageData; form: ActionData };
	let { data, form }: Props = $props();

	const formPayload = $derived(form as FormPayload);

	// Capture initial payload once so the user's edits don't get re-seeded when
	// SvelteKit updates `form` after an action response.
	const initialForm = (): FormPayload => form as FormPayload;
	let code = $state<string>(initialForm()?.values?.code ?? '');
	let nickname = $state<string>(initialForm()?.values?.nickname ?? '');
	let submitting = $state(false);

	// Turnstile widget lifecycle — mirrors the /login implementation so behavior
	// stays consistent between auth + join flows.
	let turnstileToken = $state('');
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
					turnstileToken = token;
				},
				'expired-callback': () => {
					turnstileToken = '';
				},
				'error-callback': () => {
					turnstileToken = '';
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

	function onCodeInput(e: Event) {
		const input = e.target as HTMLInputElement;
		// Uppercase + strip non [A-Z0-9] as the user types. Max 6 chars.
		const sanitized = input.value
			.toUpperCase()
			.replace(/[^A-Z0-9]/g, '')
			.slice(0, 6);
		code = sanitized;
	}

	function joinEnhance() {
		submitting = true;
		return async ({ result, update }: { result: SubmitResult; update: () => Promise<void> }) => {
			submitting = false;
			if (result.type === 'redirect') {
				await applyAction(result);
				return;
			}
			await update();
			if (result.type === 'failure') {
				const msg = typeof result.data?.message === 'string' ? result.data.message : null;
				if (msg) toast.error(msg);
				resetTurnstile();
				turnstileToken = '';
			}
			await applyAction(result);
		};
	}

	function resetTurnstile() {
		const ts = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
		if (ts && turnstileWidgetId !== null) ts.reset(turnstileWidgetId);
	}

	const canSubmit = $derived(
		code.length === 6 &&
			nickname.trim().length > 0 &&
			(!data.turnstileSiteKey || turnstileToken.length > 0) &&
			!submitting
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

	type SubmitResult =
		| { type: 'success'; status: number; data?: Record<string, unknown> }
		| { type: 'failure'; status: number; data?: Record<string, unknown> }
		| { type: 'redirect'; status: number; location: string }
		| { type: 'error'; status?: number; error: unknown };
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

		<form method="POST" use:enhance={joinEnhance}>
			<Card.Content class="space-y-4">
				<div class="space-y-2">
					<Label.Root for="code">Join code</Label.Root>
					<Input.Root
						id="code"
						name="code"
						type="text"
						inputmode="text"
						autocomplete="off"
						autocapitalize="characters"
						spellcheck={false}
						maxlength={6}
						required
						placeholder="ABC123"
						class="text-center font-mono text-3xl tracking-[0.4em] uppercase"
						value={code}
						oninput={onCodeInput}
					/>
				</div>

				<div class="space-y-2">
					<Label.Root for="nickname">Nickname</Label.Root>
					<Input.Root
						id="nickname"
						name="nickname"
						type="text"
						autocomplete="off"
						maxlength={20}
						required
						placeholder="Your name"
						bind:value={nickname}
					/>
				</div>

				<input type="hidden" name="turnstileToken" value={turnstileToken} />

				{#if data.turnstileSiteKey}
					<div class="flex justify-center">
						<div bind:this={turnstileEl} class="min-h-[65px]"></div>
					</div>
				{:else}
					<p class="text-muted-foreground text-center text-xs">
						Verification is currently unavailable. Joins may be rate-limited.
					</p>
				{/if}

				{#if formPayload?.message}
					<p class="text-destructive text-sm" role="alert">{formPayload.message}</p>
				{/if}
			</Card.Content>
			<Card.Footer>
				<Button.Root
					type="submit"
					class="w-full"
					size="lg"
					aria-disabled={!canSubmit}
					onclick={(e) => {
						if (!canSubmit) e.preventDefault();
					}}
				>
					{#if submitting}
						<Loader2Icon class="mr-2 size-4 animate-spin" aria-hidden="true" />
					{/if}
					Join
				</Button.Root>
			</Card.Footer>
		</form>
	</Card.Root>
</main>
