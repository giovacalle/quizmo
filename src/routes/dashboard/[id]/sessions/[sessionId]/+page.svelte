<script lang="ts">
	import { DateFormatter } from '@internationalized/date';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import TrophyIcon from '@lucide/svelte/icons/trophy';

	import { page } from '$app/state';
	import Leaderboard from '$lib/components/leaderboard.svelte';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge';
	import * as Button from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { cn } from '$lib/utils';

	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const dateFormatter = new DateFormatter('en-US', {
		dateStyle: 'medium',
		timeStyle: 'short'
	});

	type SessionStatus = PageData['session']['status'];

	const STATUS_META: Record<SessionStatus, { label: string; variant: BadgeVariant }> = {
		lobby: { label: 'Lobby', variant: 'outline' },
		active: { label: 'Live', variant: 'success' },
		revealing: { label: 'Live', variant: 'success' },
		ended: { label: 'Ended', variant: 'secondary' },
		archived: { label: 'Archived', variant: 'outline' }
	};

	const statusMeta = $derived(STATUS_META[data.session.status]);
	const podium = $derived(data.participants.slice(0, 3));

	function formatTimestamp(ts: number | null): string | null {
		if (ts === null) return null;
		return dateFormatter.format(new Date(ts));
	}

	/**
	 * Human "Xm Ys" duration for ended sessions. Mirrors host-side formatting
	 * intent: minutes + seconds, no sub-second precision (D1 stores whole-ms
	 * timestamps but session-length granularity beyond a second is noise).
	 */
	function formatDuration(startedAt: number | null, endedAt: number | null): string | null {
		if (startedAt === null || endedAt === null || endedAt <= startedAt) return null;
		const totalSec = Math.round((endedAt - startedAt) / 1000);
		const minutes = Math.floor(totalSec / 60);
		const seconds = totalSec % 60;
		return `${minutes}m ${seconds}s`;
	}

	// Podium tint matches the Leaderboard component's accent-opacity decision
	// (ops-notes-D-HOST.md deviation #5): no gold/silver/bronze literals, the
	// `accent` token degrades gracefully through opacity in both light + dark.
	function podiumClasses(position: number): string {
		if (position === 1) return 'border-accent bg-accent/60';
		if (position === 2) return 'border-accent/70 bg-accent/40';
		return 'border-accent/50 bg-accent/25';
	}

	const startedLabel = $derived(formatTimestamp(data.session.startedAt));
	const endedLabel = $derived(formatTimestamp(data.session.endedAt));
	const durationLabel = $derived(formatDuration(data.session.startedAt, data.session.endedAt));
	const participantCountLabel = $derived(
		`${data.participants.length} ${data.participants.length === 1 ? 'participant' : 'participants'}`
	);
</script>

<svelte:head>
	<title>Session {data.session.code} · {data.quiz.title} · Quizmo</title>
</svelte:head>

<main class="mx-auto max-w-4xl px-4 py-10 sm:py-16">
	<div class="mb-6">
		<Button.Root href="/dashboard/{page.params.id}/sessions" variant="ghost" size="sm">
			<ArrowLeftIcon class="mr-2 size-4" />
			Back to sessions
		</Button.Root>
	</div>

	<header class="mb-8 space-y-3">
		<div class="flex flex-wrap items-center gap-2">
			<Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
			<Badge variant="outline" class="font-mono tracking-[0.2em] tabular-nums">
				{data.session.code}
			</Badge>
		</div>
		<div>
			<h1 class="text-foreground text-3xl font-bold tracking-tight sm:text-4xl">
				{data.quiz.title}
			</h1>
			{#if startedLabel !== null}
				<p class="text-muted-foreground mt-2 text-sm sm:text-base">
					{#if endedLabel !== null}
						Ran from <span class="text-foreground font-medium">{startedLabel}</span>
						to
						<span class="text-foreground font-medium">{endedLabel}</span>
					{:else}
						Started <span class="text-foreground font-medium">{startedLabel}</span>
					{/if}
				</p>
			{:else}
				<p class="text-muted-foreground mt-2 text-sm sm:text-base">Never started.</p>
			{/if}
		</div>
	</header>

	<Card.Root class="mb-8">
		<Card.Content class="grid gap-4 p-5 sm:grid-cols-3">
			<div>
				<p class="text-muted-foreground text-xs tracking-wider uppercase">Participants</p>
				<p class="text-foreground mt-1 text-lg font-semibold tabular-nums">
					{participantCountLabel}
				</p>
			</div>
			<div>
				<p class="text-muted-foreground text-xs tracking-wider uppercase">Duration</p>
				<p class="text-foreground mt-1 text-lg font-semibold tabular-nums">
					{durationLabel ?? (data.session.endedAt === null ? 'In progress' : '—')}
				</p>
			</div>
			<div>
				<p class="text-muted-foreground text-xs tracking-wider uppercase">Code</p>
				<p class="text-foreground mt-1 font-mono text-lg font-semibold tracking-[0.2em] tabular-nums">
					{data.session.code}
				</p>
			</div>
		</Card.Content>
	</Card.Root>

	{#if data.participants.length === 0}
		<Card.Root class="border-dashed">
			<Card.Content class="flex flex-col items-center gap-4 py-16 text-center">
				<p class="text-muted-foreground text-sm">No one joined this session.</p>
				<Button.Root href="/dashboard/{page.params.id}/sessions" variant="outline">
					Back to sessions
				</Button.Root>
			</Card.Content>
		</Card.Root>
	{:else}
		{#if podium.length >= 3}
			<section class="mb-8" aria-label="Top finishers">
				<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
					{#each podium as p, i (p.id)}
						{@const position = i + 1}
						<Card.Root
							class={cn(
								'text-center',
								podiumClasses(position),
								position === 1 && 'sm:order-2 sm:-translate-y-2'
							)}
						>
							<Card.Header class="pb-2">
								<div
									class="bg-background/70 text-foreground mx-auto flex size-10 items-center justify-center rounded-full text-base font-bold tabular-nums"
								>
									{#if position === 1}
										<TrophyIcon class="text-accent-foreground size-5" aria-hidden="true" />
									{:else}
										{position}
									{/if}
								</div>
								<Card.Title class="mt-2 truncate text-base">{p.nickname}</Card.Title>
							</Card.Header>
							<Card.Content class="pt-0">
								<p class="text-foreground text-2xl font-bold tabular-nums">{p.score}</p>
								<p class="text-muted-foreground text-xs">pts</p>
							</Card.Content>
						</Card.Root>
					{/each}
				</div>
			</section>
		{/if}

		<section aria-label="Full leaderboard">
			<Card.Root>
				<Card.Header class="pb-3">
					<Card.Title class="flex items-center gap-2 text-sm">
						<TrophyIcon class="size-4" />
						Final leaderboard
					</Card.Title>
				</Card.Header>
				<Card.Content>
					<Leaderboard entries={data.participants} frozen />
				</Card.Content>
			</Card.Root>
		</section>
	{/if}
</main>
