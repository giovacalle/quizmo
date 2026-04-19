<script lang="ts">
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import MailIcon from '@lucide/svelte/icons/mail';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
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
				step?: 'send' | 'verify';
				code?: string;
				message?: string;
				email?: string;
		  };
	type Props = { data: PageData; form: ActionData };
	let { data, form }: Props = $props();

	// Narrow `form` to the inline-error shape we actually emit from the action.
	// SvelteKit infers `ActionData` wide because success returns are structural;
	// this alias keeps downstream access type-safe without `as any`.
	const formPayload = $derived(form as FormPayload);

	// Advance to step 2 when the server reports a successful send. We read the
	// initial form payload eagerly (SvelteKit hydrates `form` once per nav) —
	// subsequent mutations are local state, which is what we want here so the
	// user can flip back to step 1 without the server overriding.
	const initialForm = (): FormPayload => form as FormPayload;
	let step = $state<'send' | 'verify'>(initialForm()?.step === 'verify' ? 'verify' : 'send');
	let email = $state(initialForm()?.email ?? '');
	let otp = $state('');

	let sending = $state(false);
	let verifying = $state(false);
	let resendDisabledUntil = $state(0);
	let now = $state(Date.now());
	const resendRemainingSec = $derived(Math.max(0, Math.ceil((resendDisabledUntil - now) / 1000)));
	const canResend = $derived(resendRemainingSec === 0);

	// Turnstile widget lifecycle ------------------------------------------------
	// The widget renders a token into a hidden input via the global `turnstile.render`
	// callback. We lazy-load the script on first mount so the initial render stays
	// fast. The widget re-renders on `.reset()` after a failed verify attempt.
	let turnstileToken = $state('');
	let turnstileEl = $state<HTMLDivElement | null>(null);
	let turnstileWidgetId: string | null = null;

	$effect(() => {
		// Drive the live-countdown display without needing setInterval inside the
		// `disabled` check — `$effect` re-evaluates when `now` changes.
		if (resendDisabledUntil === 0 || now >= resendDisabledUntil) return;
		const t = setTimeout(() => {
			now = Date.now();
		}, 1000);
		return () => clearTimeout(t);
	});

	$effect(() => {
		if (typeof window === 'undefined') return;
		if (step !== 'send') return;
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

	// -------------------------------------------------------------------------
	// Form action wiring. `use:enhance` preserves progressive enhancement; the
	// submit-handler captures loading state and the onresult callback drives the
	// step advance + toast-on-failure.
	// -------------------------------------------------------------------------

	function sendOtpEnhance() {
		sending = true;
		return async ({ result, update }: { result: SubmitResult; update: () => Promise<void> }) => {
			sending = false;
			await update();
			if (result.type === 'success' || result.type === 'redirect') {
				step = 'verify';
				otp = '';
				resendDisabledUntil = Date.now() + 30_000;
				now = Date.now();
				toast.success('Code sent. Check your email.');
				return;
			}
			if (result.type === 'failure') {
				const msg = typeof result.data?.message === 'string' ? result.data.message : null;
				if (msg) toast.error(msg);
				// Turnstile binds the token to the submitting request only; reset the
				// widget so the user can retry.
				resetTurnstile();
				turnstileToken = '';
			}
			await applyAction(result);
		};
	}

	function verifyOtpEnhance() {
		verifying = true;
		return async ({ result, update }: { result: SubmitResult; update: () => Promise<void> }) => {
			verifying = false;
			if (result.type === 'redirect') {
				await applyAction(result);
				return;
			}
			await update();
			if (result.type === 'failure') {
				const msg = typeof result.data?.message === 'string' ? result.data.message : null;
				if (msg) toast.error(msg);
			}
			await applyAction(result);
		};
	}

	function resetTurnstile() {
		const ts = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
		if (ts && turnstileWidgetId !== null) ts.reset(turnstileWidgetId);
	}

	function backToEmail() {
		step = 'send';
		otp = '';
		turnstileToken = '';
		turnstileWidgetId = null;
	}

	// Minimal typing for the Turnstile global. Full types would pull in an extra
	// dev dep for no meaningful payoff on a single page.
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
	<title>Sign in · Quizmo</title>
</svelte:head>

<main class="flex min-h-dvh items-center justify-center px-4 py-12">
	<Card.Root class="w-full max-w-sm">
		<Card.Header>
			<Card.Title class="flex items-center gap-2 text-xl">
				{#if step === 'send'}
					<MailIcon class="text-primary size-5" aria-hidden="true" />
					Sign in to Quizmo
				{:else}
					<ShieldCheckIcon class="text-primary size-5" aria-hidden="true" />
					Enter your code
				{/if}
			</Card.Title>
			<Card.Description>
				{#if step === 'send'}
					Enter your email and we'll send you a one-time code.
				{:else}
					We sent a 6-digit code to <span class="text-foreground font-medium">{email}</span>.
				{/if}
			</Card.Description>
		</Card.Header>

		{#if step === 'send'}
			<form method="POST" action="?/sendOtp" use:enhance={sendOtpEnhance}>
				<Card.Content class="space-y-4">
					<div class="space-y-2">
						<Label.Root for="email">Email</Label.Root>
						<Input.Root
							id="email"
							name="email"
							type="email"
							autocomplete="email"
							required
							placeholder="you@example.com"
							bind:value={email}
						/>
					</div>

					<input type="hidden" name="turnstileToken" value={turnstileToken} />

					{#if data.turnstileSiteKey}
						<div class="flex justify-center">
							<div bind:this={turnstileEl} class="min-h-[65px]"></div>
						</div>
					{:else}
						<p class="text-muted-foreground text-center text-xs">
							Verification is currently unavailable. Code sends may be rate-limited.
						</p>
					{/if}

					{#if formPayload?.step === 'send' && formPayload?.message}
						<p class="text-destructive text-sm" role="alert">{formPayload.message}</p>
					{/if}
				</Card.Content>
				<Card.Footer class="flex flex-col gap-2">
					<Button.Root
						type="submit"
						class="w-full"
						aria-disabled={sending ||
							email.trim().length === 0 ||
							(!!data.turnstileSiteKey && turnstileToken.length === 0)}
						onclick={(e) => {
							if (
								sending ||
								email.trim().length === 0 ||
								(!!data.turnstileSiteKey && turnstileToken.length === 0)
							) {
								e.preventDefault();
							}
						}}
					>
						{#if sending}
							<Loader2Icon class="mr-2 size-4 animate-spin" aria-hidden="true" />
						{/if}
						Send code
					</Button.Root>
				</Card.Footer>
			</form>
		{:else}
			<form method="POST" action="?/verifyOtp" use:enhance={verifyOtpEnhance}>
				<Card.Content class="space-y-4">
					<input type="hidden" name="email" value={email} />
					<div class="space-y-2">
						<Label.Root for="otp">6-digit code</Label.Root>
						<Input.Root
							id="otp"
							name="otp"
							type="text"
							inputmode="numeric"
							autocomplete="one-time-code"
							maxlength={6}
							required
							placeholder="123456"
							class="text-center text-2xl tracking-[0.4em]"
							bind:value={otp}
						/>
					</div>

					{#if formPayload?.step === 'verify' && formPayload?.message}
						<p class="text-destructive text-sm" role="alert">{formPayload.message}</p>
					{/if}
				</Card.Content>
				<Card.Footer class="flex flex-col gap-3">
					<Button.Root
						type="submit"
						class="w-full"
						aria-disabled={verifying || otp.length !== 6}
						onclick={(e) => {
							if (verifying || otp.length !== 6) e.preventDefault();
						}}
					>
						{#if verifying}
							<Loader2Icon class="mr-2 size-4 animate-spin" aria-hidden="true" />
						{/if}
						Verify code
					</Button.Root>

					<div class="text-muted-foreground flex w-full items-center justify-between text-xs">
						<Button.Root
							type="button"
							variant="link"
							size="sm"
							class="h-auto px-0 text-xs"
							onclick={backToEmail}
						>
							Use a different email
						</Button.Root>

						{#if canResend}
							<Button.Root
								type="button"
								variant="link"
								size="sm"
								class="h-auto px-0 text-xs"
								onclick={backToEmail}
							>
								Resend code
							</Button.Root>
						{:else}
							<span>Resend in {resendRemainingSec}s</span>
						{/if}
					</div>
				</Card.Footer>
			</form>
		{/if}
	</Card.Root>
</main>
