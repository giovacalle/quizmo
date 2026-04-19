<script lang="ts">
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import SkipForwardIcon from '@lucide/svelte/icons/skip-forward';
	import TrophyIcon from '@lucide/svelte/icons/trophy';
	import UsersIcon from '@lucide/svelte/icons/users';
	import XIcon from '@lucide/svelte/icons/x';
	import { fly } from 'svelte/transition';
	import { toast } from 'svelte-sonner';

	import * as Button from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import Leaderboard from '$lib/components/leaderboard.svelte';
	import { cn } from '$lib/utils';

	import type { PageData } from './$types';
	import { HostSocket } from './_lib/host-socket.svelte';

	let { data }: { data: PageData } = $props();

	// sessionId is route-stable (the page remounts on navigation to a different
	// sessionId, so the socket identity matches the URL). Deliberate capture.
	// svelte-ignore state_referenced_locally
	const socket = new HostSocket(data.sessionId);

	let now = $state(Date.now());
	let copied = $state(false);

	// Open + close the WS with the page lifecycle.
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

	// Derived timer metrics. Absolute ms remaining, percentage for the ring.
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
		if (timePct > 5 / Math.max(socket.currentQuestion?.timeLimitSec ?? 1, 1)) return 'stroke-warning';
		return 'stroke-destructive';
	});

	const pulseLast3 = $derived(timeLeftSec <= 3 && timeLeftSec > 0 && socket.status === 'active');

	const answerCountForCurrent = $derived.by(() => {
		const q = socket.currentQuestion;
		if (!q) return 0;
		return socket.answerCounts[q.qIdx] ?? 0;
	});

	const podium = $derived(socket.finalLeaderboard?.slice(0, 3) ?? []);

	async function copyCode() {
		if (typeof navigator === 'undefined' || !navigator.clipboard) {
			toast.error('Clipboard not available');
			return;
		}
		try {
			await navigator.clipboard.writeText(data.joinCode);
			copied = true;
			toast.success('Code copied');
			setTimeout(() => {
				copied = false;
			}, 1500);
		} catch {
			toast.error('Could not copy code');
		}
	}

	// Timer ring geometry. 96px outer, 8px stroke → r=44, C=276.46.
	const TIMER_R = 44;
	const TIMER_C = 2 * Math.PI * TIMER_R;
	const timerOffset = $derived(TIMER_C * (1 - timePct));

	// Track new joiners briefly for fly-in emphasis
	let joinedIds = $state<string[]>([]);
	let prevCount = $state(0);
	$effect(() => {
		if (socket.participants.length > prevCount) {
			const fresh = socket.participants
				.slice(prevCount)
				.map((p) => p.participantId);
			joinedIds = [...joinedIds, ...fresh];
			const t = setTimeout(() => {
				joinedIds = joinedIds.filter((id) => !fresh.includes(id));
			}, 2000);
			prevCount = socket.participants.length;
			return () => clearTimeout(t);
		}
		prevCount = socket.participants.length;
	});
</script>

<svelte:head>
	<title>Host session · Quizmo</title>
</svelte:head>

<main class="bg-background min-h-dvh px-4 py-6">
	{#if socket.status === 'ended' && socket.finalLeaderboard}
		<!-- End-of-quiz podium ---------------------------------------------- -->
		<div class="mx-auto max-w-3xl space-y-8 py-12 text-center">
			<div>
				<div class="bg-primary/10 text-primary mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl">
					<TrophyIcon class="size-8" />
				</div>
				<h1 class="text-foreground text-4xl font-bold tracking-tight">Quiz complete!</h1>
				<p class="text-muted-foreground mt-2">Thanks for playing.</p>
			</div>

			{#if podium.length > 0}
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
					{#each podium as p, i (p.participantId)}
						<Card.Root
							class={cn(
								'text-center',
								i === 0 && 'sm:order-2 sm:-translate-y-4'
							)}
						>
							<Card.Header>
								<div
									class="bg-accent text-accent-foreground mx-auto flex size-12 items-center justify-center rounded-full text-xl font-bold"
								>
									{i + 1}
								</div>
								<Card.Title class="mt-2 text-lg">{p.nickname}</Card.Title>
							</Card.Header>
							<Card.Content>
								<p class="text-foreground text-3xl font-bold tabular-nums">{p.score}</p>
							</Card.Content>
						</Card.Root>
					{/each}
				</div>
			{/if}

			<div class="mx-auto max-w-md">
				<Leaderboard entries={socket.leaderboardEntries()} maxRows={10} frozen={false} />
			</div>

			<Button.Root href="/dashboard" size="lg">
				<ArrowLeftIcon class="mr-2 size-4" />
				Back to dashboard
			</Button.Root>
		</div>
	{:else}
		<!-- Live session 3-column layout ---------------------------------- -->
		{#if socket.connectionLost}
			<div class="bg-destructive/10 text-destructive mb-4 flex items-center justify-between gap-3 rounded-lg border border-destructive/30 px-4 py-3 text-sm" role="alert">
				<span>Connection lost. Click retry to reconnect.</span>
				<Button.Root size="sm" variant="outline" onclick={() => socket.retry()}>Retry</Button.Root>
			</div>
		{/if}

		<div class="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)_minmax(0,340px)]">
			<!-- LEFT: join code + participants -->
			<aside class="space-y-4">
				<Card.Root>
					<Card.Header class="pb-3">
						<Card.Description class="uppercase tracking-wider text-xs">Join code</Card.Description>
					</Card.Header>
					<Card.Content class="space-y-3">
						<p class="text-foreground text-center font-mono text-4xl font-bold tracking-[0.3em] tabular-nums sm:text-5xl">
							{data.joinCode}
						</p>
						<Button.Root variant="outline" class="w-full" onclick={copyCode}>
							{#if copied}
								<CheckIcon class="mr-2 size-4" />
								Copied
							{:else}
								<CopyIcon class="mr-2 size-4" />
								Copy code
							{/if}
						</Button.Root>
					</Card.Content>
				</Card.Root>

				<Card.Root>
					<Card.Header class="pb-3">
						<Card.Title class="flex items-center gap-2 text-sm">
							<UsersIcon class="size-4" />
							Players
							<span class="text-muted-foreground ml-auto font-normal tabular-nums">
								{socket.participants.length}
							</span>
						</Card.Title>
					</Card.Header>
					<Card.Content>
						{#if socket.participants.length === 0}
							<p class="text-muted-foreground text-sm">Waiting for players…</p>
						{:else}
							<ul class="space-y-1.5">
								{#each socket.participants as p (p.participantId)}
									<li
										class={cn(
											'border-border bg-card flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm',
											joinedIds.includes(p.participantId) && 'bg-success/10 border-success/30'
										)}
										in:fly={{ y: -8, duration: 300 }}
									>
										<span class="bg-primary/10 text-primary flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
											{p.nickname.charAt(0).toUpperCase()}
										</span>
										<span class="text-foreground truncate">{p.nickname}</span>
									</li>
								{/each}
							</ul>
						{/if}
					</Card.Content>
				</Card.Root>
			</aside>

			<!-- CENTER: question + timer + answers -->
			<section>
				{#if socket.status === 'lobby'}
					<Card.Root>
						<Card.Content class="flex flex-col items-center gap-4 py-16 text-center">
							<UsersIcon class="text-muted-foreground size-12" />
							<div>
								<h2 class="text-foreground text-2xl font-semibold">Lobby</h2>
								<p class="text-muted-foreground mt-1 text-sm">
									Share the join code above. Players will appear on the left as they join.
								</p>
							</div>
						</Card.Content>
					</Card.Root>
				{:else if socket.currentQuestion}
					<Card.Root class="overflow-hidden">
						<Card.Header>
							<Card.Description class="text-xs uppercase tracking-wider">
								Question {socket.currentQuestion.qIdx + 1}
							</Card.Description>
							<Card.Title class="text-2xl sm:text-3xl">
								{socket.currentQuestion.text}
							</Card.Title>
						</Card.Header>
						<Card.Content class="space-y-6">
							<!-- Timer ring -->
							<div class="flex items-center justify-center">
								<div class={cn('relative size-24', pulseLast3 && 'animate-pulse')}>
									<svg
										viewBox="0 0 100 100"
										class="size-full -rotate-90"
										aria-hidden="true"
									>
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
									>
										{timeLeftSec}
									</span>
								</div>
							</div>

							<!-- Answer cards -->
							<div class="grid gap-2 sm:grid-cols-2">
								{#each socket.currentQuestion.answers as ans (ans.idx)}
									{@const letter = ['A', 'B', 'C', 'D', 'E', 'F'][ans.idx] ?? '?'}
									{@const isCorrect =
										socket.status === 'revealing' &&
										socket.reveal?.correctIdx === ans.idx}
									<div
										class={cn(
											'border-border bg-background flex items-center gap-3 rounded-lg border p-3 text-sm',
											isCorrect && 'border-success bg-success/10'
										)}
									>
										<span
											class="bg-primary/10 text-primary flex size-7 shrink-0 items-center justify-center rounded-md font-semibold"
										>
											{letter}
										</span>
										<span class="text-foreground flex-1">{ans.text}</span>
										{#if isCorrect}
											<CheckIcon class="text-success size-5" />
										{:else if socket.status === 'revealing'}
											<XIcon class="text-muted-foreground size-5" />
										{/if}
									</div>
								{/each}
							</div>

							<!-- Answer distribution bar -->
							<div class="space-y-1">
								<div class="text-muted-foreground flex items-center justify-between text-xs">
									<span>Answers received</span>
									<span class="tabular-nums">
										{answerCountForCurrent}/{socket.participants.length}
									</span>
								</div>
								<div class="bg-muted h-2 w-full overflow-hidden rounded-full">
									<div
										class="bg-primary h-full transition-all duration-300"
										style:width={`${
											socket.participants.length === 0
												? 0
												: Math.min(
														100,
														(answerCountForCurrent / socket.participants.length) * 100
													)
										}%`}
									></div>
								</div>
							</div>
						</Card.Content>

						<Card.Footer class="border-border gap-2 border-t">
							<Button.Root
								variant="outline"
								onclick={() => socket.reveal_()}
								aria-disabled={socket.status !== 'active'}
								onclickcapture={(e) => {
									if (socket.status !== 'active') e.preventDefault();
								}}
							>
								<EyeIcon class="mr-2 size-4" />
								Reveal answer
							</Button.Root>
							<Button.Root
								onclick={() => socket.advance()}
								aria-disabled={socket.status !== 'revealing'}
								onclickcapture={(e) => {
									if (socket.status !== 'revealing') e.preventDefault();
								}}
							>
								<SkipForwardIcon class="mr-2 size-4" />
								Next question
							</Button.Root>
						</Card.Footer>
					</Card.Root>
				{:else}
					<Card.Root>
						<Card.Content class="py-16 text-center">
							<p class="text-muted-foreground text-sm">Loading question…</p>
						</Card.Content>
					</Card.Root>
				{/if}
			</section>

			<!-- RIGHT: live leaderboard -->
			<aside>
				<Card.Root>
					<Card.Header class="pb-3">
						<Card.Title class="flex items-center gap-2 text-sm">
							<TrophyIcon class="size-4" />
							Leaderboard
						</Card.Title>
					</Card.Header>
					<Card.Content>
						<Leaderboard
							entries={socket.leaderboardEntries()}
							maxRows={10}
							frozen={socket.status === 'active'}
						/>
					</Card.Content>
				</Card.Root>
			</aside>
		</div>
	{/if}
</main>
