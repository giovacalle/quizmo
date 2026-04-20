<script lang="ts">
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import MailIcon from '@lucide/svelte/icons/mail';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import { toast } from 'svelte-sonner';
	import { fieldProxy, superForm } from 'sveltekit-superforms';
	import { valibotClient } from 'sveltekit-superforms/adapters';

	import * as Button from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Form from '$lib/components/ui/form';
	import * as Input from '$lib/components/ui/input';
	import { loginWizardSchema } from '$lib/validators';

	import type { LoginMessage } from './+page.server';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// svelte-ignore state_referenced_locally
	const superform = superForm(data.form, {
		validators: valibotClient(loginWizardSchema),
		// Keep the email input on a failed step-1 submit (rate-limit, Turnstile
		// denial) so the user doesn't re-type. v2's default preserves failure
		// state, stated explicitly for critical flows.
		resetForm: false,
		onUpdated({ form }) {
			const msg = form.message as LoginMessage | undefined;
			if (!msg) return;
			if (msg.kind === 'advanced') {
				// Server advanced to step 2 via `form.data.step = 'verify'` + message().
				// Reset the 30s resend cooldown and clear any stale Turnstile token —
				// the widget is unmounted on step 2 and a fresh one renders on resend.
				$codeProxy = '';
				$turnstileTokenProxy = '';
				turnstileWidgetId = null;
				resendDisabledUntil = Date.now() + 30_000;
				now = Date.now();
				toast.success(msg.text);
				return;
			}
			// kind === 'error' — toast-level form failure (rate-limit / Turnstile).
			toast.error(msg.text);
			// Reset Turnstile so the user can retry with a fresh challenge.
			if ($formData.step === 'send') {
				resetTurnstile();
				$turnstileTokenProxy = '';
			}
		}
	});
	const { form: formData, errors, enhance, submitting, message } = superform;

	// `code` lives only on the 'verify' branch and `turnstileToken` only on the
	// 'send' branch of `loginWizardSchema` — superforms can't narrow a reactive
	// store access through `{#if}` guards. `fieldProxy` exposes each branch-only
	// field as a plain Writable<string> so bindings and callbacks stay simple.
	const codeProxy = fieldProxy(superform, 'code');
	const turnstileTokenProxy = fieldProxy(superform, 'turnstileToken');

	// Resend cooldown — pure UI timer, NOT form state. Stays local so the user
	// can flip back to step 1 without the server clearing this.
	let resendDisabledUntil = $state(0);
	let now = $state(Date.now());
	const resendRemainingSec = $derived(Math.max(0, Math.ceil((resendDisabledUntil - now) / 1000)));
	const canResend = $derived(resendRemainingSec === 0);

	// Turnstile widget lifecycle ------------------------------------------------
	// Renders a token on step 1, writes it into the form via `turnstileTokenProxy`.
	// Re-renders a fresh widget on every 'send'-step mount (including after a
	// resend click — `turnstileWidgetId` is cleared in `requestResend`).
	let turnstileEl = $state<HTMLDivElement | null>(null);
	let turnstileWidgetId: string | null = null;

	$effect(() => {
		// Tick the countdown only while a cooldown is active. Without this gate
		// the effect would re-schedule forever.
		if (resendDisabledUntil === 0 || now >= resendDisabledUntil) return;
		const t = setTimeout(() => {
			now = Date.now();
		}, 1000);
		return () => clearTimeout(t);
	});

	$effect(() => {
		// Mount the widget on step 1 only. Re-runs when $formData.step flips back
		// to 'send' via the resend flow, which resets turnstileWidgetId in
		// `requestResend` so the render branch fires again.
		if (typeof window === 'undefined') return;
		if ($formData.step !== 'send') return;
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

	$effect(() => {
		// Clean up the Turnstile widget when the component unmounts — prevents
		// orphan script handlers if the user navigates away mid-challenge.
		return () => {
			const ts = (window as unknown as { turnstile?: TurnstileApi } | undefined)?.turnstile;
			if (ts && turnstileWidgetId !== null) ts.remove?.(turnstileWidgetId);
		};
	});

	function resetTurnstile() {
		const ts = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
		if (ts && turnstileWidgetId !== null) ts.reset(turnstileWidgetId);
	}

	// Tear the widget down via the Turnstile API so Svelte's DOM ownership stays
	// consistent. The render `$effect` remounts a fresh challenge on the next
	// 'send'-step pass because `turnstileWidgetId` is back to null.
	function removeTurnstile() {
		const ts = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
		if (ts && turnstileWidgetId !== null) ts.remove?.(turnstileWidgetId);
		turnstileWidgetId = null;
	}

	// Flip back to step 1 and reset the widget so the user can request a fresh
	// code. Does NOT auto-submit — the user clicks "Send code" again after the
	// challenge resolves. Whole-object assignment widens the union to the 'send'
	// branch so branch-specific fields (turnstileToken) are typed.
	function requestResend() {
		if (!canResend) return;
		$formData = { step: 'send', email: $formData.email, turnstileToken: '' };
		removeTurnstile();
	}

	// "Use a different email" — clear the form entirely and return to step 1.
	function useDifferentEmail() {
		$formData = { step: 'send', email: '', turnstileToken: '' };
		removeTurnstile();
	}

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
		remove?: (widgetId?: string) => void;
	};
</script>

<svelte:head>
	<title>Sign in · Quizmo</title>
</svelte:head>

<main class="flex min-h-dvh items-center justify-center px-4 py-12">
	<Card.Root class="w-full max-w-sm">
		<Card.Header>
			<Card.Title class="flex items-center gap-2 text-xl">
				{#if $formData.step === 'send'}
					<MailIcon class="text-primary size-5" aria-hidden="true" />
					Sign in to Quizmo
				{:else}
					<ShieldCheckIcon class="text-primary size-5" aria-hidden="true" />
					Enter your code
				{/if}
			</Card.Title>
			<Card.Description>
				{#if $formData.step === 'send'}
					Enter your email and we'll send you a one-time code.
				{:else}
					We sent a 6-digit code to <span class="text-foreground font-medium"
						>{$formData.email}</span
					>.
				{/if}
			</Card.Description>
		</Card.Header>

		<form method="POST" use:enhance>
			<!-- Variant discriminant: has to ride as a form field so the server
			     parser picks the right branch of loginWizardSchema. -->
			<input type="hidden" name="step" value={$formData.step} />

			{#if $formData.step === 'send'}
				<Card.Content class="space-y-4">
					<Form.Field form={superform} name="email">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>Email</Form.Label>
								<Input.Root
									{...props}
									type="email"
									autocomplete="email"
									placeholder="you@example.com"
									bind:value={$formData.email}
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>

					<!-- Turnstile token is a schema field (`minLength(1)` on the 'send'
					     branch). `$turnstileTokenProxy` is the Writable face of
					     `$formData.turnstileToken` — the widget callback writes it and
					     valibotClient sees it during client-side validation. -->
					<input type="hidden" name="turnstileToken" value={$turnstileTokenProxy} />

					{#if data.turnstileSiteKey}
						<div class="flex justify-center">
							<div bind:this={turnstileEl} class="min-h-[65px]"></div>
						</div>
					{:else}
						<p class="text-muted-foreground text-center text-xs">
							Verification is currently unavailable. Code sends may be rate-limited.
						</p>
					{/if}

					{#if $errors.turnstileToken}
						<p class="text-destructive text-sm" role="alert">{$errors.turnstileToken[0]}</p>
					{/if}
				</Card.Content>
				<Card.Footer class="flex flex-col gap-2">
					<Form.Button
						class="w-full"
						aria-disabled={$submitting ||
							$formData.email.trim().length === 0 ||
							(!!data.turnstileSiteKey && $turnstileTokenProxy.length === 0)}
						onclick={(e) => {
							if (
								$submitting ||
								$formData.email.trim().length === 0 ||
								(!!data.turnstileSiteKey && $turnstileTokenProxy.length === 0)
							) {
								e.preventDefault();
							}
						}}
					>
						{#if $submitting}
							<Loader2Icon class="mr-2 size-4 animate-spin" aria-hidden="true" />
						{/if}
						Send code
					</Form.Button>
				</Card.Footer>
			{:else}
				<Card.Content class="space-y-4">
					<!-- Email echo: variant schema requires it on step 2 too, and it's
					     not editable here — just a hidden input + visible text. -->
					<input type="hidden" name="email" value={$formData.email} />

					<Form.Field form={superform} name="code">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>6-digit code</Form.Label>
								<Input.Root
									{...props}
									type="text"
									inputmode="numeric"
									autocomplete="one-time-code"
									maxlength={6}
									placeholder="123456"
									class="text-center text-2xl tracking-[0.4em]"
									bind:value={$codeProxy}
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>

					{#if $message?.kind === 'error'}
						<p class="text-destructive text-sm" role="alert">{$message.text}</p>
					{/if}
				</Card.Content>
				<Card.Footer class="flex flex-col gap-3">
					<Form.Button
						class="w-full"
						aria-disabled={$submitting || $codeProxy.length !== 6}
						onclick={(e) => {
							if ($submitting || $codeProxy.length !== 6) e.preventDefault();
						}}
					>
						{#if $submitting}
							<Loader2Icon class="mr-2 size-4 animate-spin" aria-hidden="true" />
						{/if}
						Verify code
					</Form.Button>

					<div class="text-muted-foreground flex w-full items-center justify-between text-xs">
						<Button.Root
							type="button"
							variant="link"
							size="sm"
							class="h-auto px-0 text-xs"
							onclick={useDifferentEmail}
						>
							Use a different email
						</Button.Root>

						{#if canResend}
							<Button.Root
								type="button"
								variant="link"
								size="sm"
								class="h-auto px-0 text-xs"
								onclick={requestResend}
							>
								Resend code
							</Button.Root>
						{:else}
							<span>Resend in {resendRemainingSec}s</span>
						{/if}
					</div>
				</Card.Footer>
			{/if}
		</form>
	</Card.Root>
</main>
