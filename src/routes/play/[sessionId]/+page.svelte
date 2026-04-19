<script lang="ts">
	import CheckCircleIcon from '@lucide/svelte/icons/check-circle-2';
	import HourglassIcon from '@lucide/svelte/icons/hourglass';
	import TrophyIcon from '@lucide/svelte/icons/trophy';
	import UsersIcon from '@lucide/svelte/icons/users';
	import XCircleIcon from '@lucide/svelte/icons/x-circle';
	import { toast } from 'svelte-sonner';
	import { fly } from 'svelte/transition';

	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { ParticipantSocket } from '$lib/client/participant-socket.svelte';
	import Leaderboard from '$lib/components/leaderboard.svelte';
	import * as Button from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { cn } from '$lib/utils';

	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// svelte-ignore state_referenced_locally
	const socket = new ParticipantSocket(data.sessionId, data.nickname);

	let now = $state(Date.now());

	$effect(() => {
		socket.connect();
		let raf: number | null = null;
		const tick = () => {
			now = Date.now();
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => {
			if (raf !== null) cancelAnimationFrame(raf);
			socket.close();
		};
	});

	// Redirect back to /join on a tampered token — the DO has told us the token
	// doesn't verify, sessionStorage is already cleared by the socket.
	$effect(() => {
		if (socket.authError) {
			toast.error('Your session expired. Please rejoin.');
			goto(resolve('/join'), { replaceState: true });
		}
	});

	// Timer
	const timeLeftMs = $derived.by(() => {
		const q = socket.currentQuestion;
		if (!q) return 0;
		const total = q.timeLimitSec * 1000;
		return Math.max(0, q.questionStartedAtMs + total - now);
	});
	const timeLeftSec = $derived(Math.ceil(timeLeftMs / 1000));
	const timePct = $derived.by(() => {
		const q = socket.currentQuestion;
		if (!q) return 0;
		const total = q.timeLimitSec * 1000;
		return Math.max(0, Math.min(1, timeLeftMs / total));
	});
	const timerColorClass = $derived.by(() => {
		if (timePct > 0.5) return 'stroke-success';
		if (timeLeftSec > 5) return 'stroke-warning';
		return 'stroke-destructive';
	});

	const TIMER_R = 44;
	const TIMER_C = 2 * Math.PI * TIMER_R;
	const timerOffset = $derived(TIMER_C * (1 - timePct));

	// A 1-second undo window after tapping an option. We stage the choice locally
	// then fire `submit-answer` once the window elapses. If the user taps again
	// (or a different option) during the window the timer is reset.
	let pendingChoice = $state<number | null>(null);
	let pendingTimer: ReturnType<typeof setTimeout> | null = null;
	const UNDO_WINDOW_MS = 1000;

	function chooseAnswer(choice: number) {
		if (socket.status !== 'question' || !socket.currentQuestion) return;
		if (socket.submittedChoice !== null) return;
		pendingChoice = choice;
		if (pendingTimer !== null) clearTimeout(pendingTimer);
		pendingTimer = setTimeout(() => {
			if (!socket.currentQuestion) return;
			socket.submitAnswer(socket.currentQuestion.qIdx, choice);
			pendingChoice = null;
			pendingTimer = null;
		}, UNDO_WINDOW_MS);
	}

	function undo() {
		if (pendingTimer !== null) {
			clearTimeout(pendingTimer);
			pendingTimer = null;
		}
		pendingChoice = null;
	}

	function rejoinFresh() {
		socket.resetIdentity();
		goto(resolve('/join'), { replaceState: true });
	}

	const letterFor = (i: number) => ['A', 'B', 'C', 'D', 'E', 'F'][i] ?? '?';

	const leaderboardEntries = $derived(
		socket.leaderboard.map((p) => ({
			id: p.participantId,
			nickname: p.nickname,
			score: p.score
		}))
	);
</script>

<svelte:head>
	<title>Play · Quizmo</title>
</svelte:head>

<main class="bg-background text-foreground min-h-dvh px-4 py-6 sm:py-10">
	<div class="mx-auto w-full max-w-md space-y-4">
		{#if socket.connectionLost}
			<div
				class="bg-destructive/10 text-destructive border-destructive/30 flex flex-col gap-3 rounded-lg border px-4 py-3 text-sm"
				role="alert"
			>
				<span>Connection lost after multiple attempts.</span>
				<div class="flex gap-2">
					<Button.Root size="sm" variant="outline" onclick={() => socket.retry()}>Retry</Button.Root
					>
					<Button.Root size="sm" variant="ghost" onclick={rejoinFresh}>
						Rejoin as new player
					</Button.Root>
				</div>
			</div>
		{/if}

		<!-- Header with nickname + status hint -->
		<div class="flex items-center justify-between">
			<div class="min-w-0">
				<p class="text-muted-foreground text-xs tracking-wider uppercase">Playing as</p>
				<p class="text-foreground truncate text-lg font-semibold">{data.nickname}</p>
			</div>
			{#if socket.status !== 'ended'}
				<div class="text-muted-foreground flex items-center gap-1.5 text-xs">
					<UsersIcon class="size-3.5" />
					<span class="tabular-nums">{socket.participants.length}</span>
				</div>
			{/if}
		</div>

		{#if socket.status === 'lobby'}
			<!-- LOBBY ------------------------------------------------------ -->
			<Card.Root>
				<Card.Content class="flex flex-col items-center gap-4 py-16 text-center">
					<div
						class="bg-primary/10 text-primary flex size-14 items-center justify-center rounded-2xl"
					>
						<HourglassIcon class="size-7" />
					</div>
					<div class="space-y-1">
						<h2 class="text-foreground text-xl font-semibold">Waiting for host</h2>
						<p class="text-muted-foreground text-sm">The quiz will start soon.</p>
					</div>
					{#if socket.participants.length > 0}
						<p class="text-muted-foreground text-xs">
							{socket.participants.length}
							{socket.participants.length === 1 ? 'player' : 'players'} in the lobby
						</p>
					{/if}
				</Card.Content>
			</Card.Root>
		{:else if socket.status === 'question' && socket.currentQuestion}
			<!-- QUESTION --------------------------------------------------- -->
			<Card.Root>
				<Card.Header>
					<Card.Description class="text-xs tracking-wider uppercase">
						Question {socket.currentQuestion.qIdx + 1}
					</Card.Description>
					<Card.Title class="text-xl sm:text-2xl">{socket.currentQuestion.text}</Card.Title>
				</Card.Header>
				<Card.Content class="space-y-4">
					<div class="flex items-center justify-center">
						<div class="relative size-24">
							<svg viewBox="0 0 100 100" class="size-full -rotate-90" aria-hidden="true">
								<circle
									cx="50"
									cy="50"
									r={TIMER_R}
									class="stroke-muted fill-none"
									stroke-width="8"
								/>
								<circle
									cx="50"
									cy="50"
									r={TIMER_R}
									class={cn(timerColorClass, 'fill-none transition-all duration-200')}
									stroke-width="8"
									stroke-linecap="round"
									stroke-dasharray={TIMER_C}
									stroke-dashoffset={timerOffset}
								/>
							</svg>
							<span
								class="text-foreground absolute inset-0 flex items-center justify-center text-2xl font-bold tabular-nums"
								aria-live="polite"
								aria-label={`${timeLeftSec} seconds remaining`}
							>
								{timeLeftSec}
							</span>
						</div>
					</div>

					<div class="space-y-2">
						{#each socket.currentQuestion.answers as ans (ans.idx)}
							{@const submitted = socket.submittedChoice === ans.idx}
							{@const pending = pendingChoice === ans.idx}
							{@const disabled =
								socket.submittedChoice !== null ||
								(pendingChoice !== null && pendingChoice !== ans.idx)}
							<Button.Root
								variant="outline"
								size="lg"
								class={cn(
									'h-auto w-full justify-start gap-3 py-4 text-left text-base',
									submitted && 'border-primary bg-primary/10 text-foreground',
									pending && 'border-primary bg-primary/5'
								)}
								aria-disabled={disabled}
								onclick={(e) => {
									if (disabled) {
										e.preventDefault();
										return;
									}
									chooseAnswer(ans.idx);
								}}
							>
								<span
									class="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-md text-base font-semibold"
								>
									{letterFor(ans.idx)}
								</span>
								<span class="text-foreground flex-1 whitespace-normal">{ans.text}</span>
							</Button.Root>
						{/each}
					</div>

					{#if pendingChoice !== null && socket.submittedChoice === null}
						<div
							class="border-primary/30 bg-primary/5 flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
							role="status"
						>
							<span>Locking in {letterFor(pendingChoice)}…</span>
							<Button.Root size="sm" variant="ghost" onclick={undo}>Undo</Button.Root>
						</div>
					{/if}

					{#if socket.submittedChoice !== null}
						<p class="text-muted-foreground text-center text-sm" role="status">
							Answer submitted. Waiting for results…
						</p>
					{/if}
				</Card.Content>
			</Card.Root>
		{:else if socket.status === 'feedback' && socket.reveal}
			<!-- FEEDBACK ---------------------------------------------------- -->
			<div in:fly={{ y: 10, duration: 300 }}>
				<Card.Root>
					<Card.Content class="space-y-5 py-8 text-center">
						{#if socket.reveal.selfCorrect}
							<div
								class="bg-success/10 text-success mx-auto flex size-20 items-center justify-center rounded-full"
							>
								<CheckCircleIcon class="size-10" />
							</div>
							<div>
								<h2 class="text-foreground text-2xl font-bold">Correct!</h2>
								{#if socket.reveal.selfDelta > 0}
									<p class="text-success mt-1 text-sm font-semibold">
										+{socket.reveal.selfDelta} points
									</p>
								{/if}
							</div>
						{:else}
							<div
								class="bg-destructive/10 text-destructive mx-auto flex size-20 items-center justify-center rounded-full"
							>
								<XCircleIcon class="size-10" />
							</div>
							<div>
								<h2 class="text-foreground text-2xl font-bold">Not quite</h2>
								<p class="text-muted-foreground mt-1 text-sm">
									The correct answer was {letterFor(socket.reveal.correctIdx)}.
								</p>
							</div>
						{/if}

						<div class="bg-muted/40 border-border rounded-lg border px-4 py-3">
							<p class="text-muted-foreground text-xs tracking-wider uppercase">Your position</p>
							<p class="text-foreground mt-1 text-lg font-semibold tabular-nums">
								{socket.reveal.selfPosition} of {socket.reveal.selfTotal}
							</p>
						</div>

						<p class="text-muted-foreground text-xs">Next question starting shortly…</p>
					</Card.Content>
				</Card.Root>
			</div>
		{:else if socket.status === 'ended' && socket.finalLeaderboard}
			<!-- END ---------------------------------------------------------- -->
			<div class="space-y-6 py-4 text-center">
				<div>
					<div
						class="bg-primary/10 text-primary mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl"
					>
						<TrophyIcon class="size-8" />
					</div>
					<h1 class="text-foreground text-3xl font-bold tracking-tight">Quiz complete!</h1>
					{#if socket.finalPosition}
						<p class="text-muted-foreground mt-2 text-base">
							You finished <span class="text-foreground font-semibold">
								#{socket.finalPosition}
							</span>
							of {socket.finalLeaderboard.length}
						</p>
					{/if}
				</div>

				<Card.Root>
					<Card.Header class="pb-3">
						<Card.Title class="text-sm">Final standings</Card.Title>
					</Card.Header>
					<Card.Content>
						<Leaderboard entries={leaderboardEntries} maxRows={10} frozen={false} />
					</Card.Content>
				</Card.Root>

				<Button.Root href="/join" size="lg" variant="outline" class="w-full">
					Play again
				</Button.Root>
			</div>
		{:else}
			<!-- Reconnecting / initial fetch --------------------------------- -->
			<Card.Root>
				<Card.Content class="py-16 text-center">
					<p class="text-muted-foreground text-sm">Connecting…</p>
				</Card.Content>
			</Card.Root>
		{/if}
	</div>
</main>
