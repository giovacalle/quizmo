<script lang="ts">
	import { DateFormatter } from '@internationalized/date';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import TrophyIcon from '@lucide/svelte/icons/trophy';

	import { page } from '$app/state';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge';
	import * as Button from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';

	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const dateFormatter = new DateFormatter('en-US', {
		dateStyle: 'medium',
		timeStyle: 'short'
	});

	type SessionStatus = PageData['sessions'][number]['status'];

	const STATUS_META: Record<SessionStatus, { label: string; variant: BadgeVariant }> = {
		lobby: { label: 'Lobby', variant: 'outline' },
		active: { label: 'Live', variant: 'success' },
		revealing: { label: 'Live', variant: 'success' },
		ended: { label: 'Ended', variant: 'secondary' },
		archived: { label: 'Archived', variant: 'outline' }
	};

	function formatStartedAt(ts: number | null): string {
		if (ts === null) return 'Not started';
		return dateFormatter.format(new Date(ts));
	}
</script>

<svelte:head>
	<title>Past sessions · {data.quiz.title} · Quizmo</title>
</svelte:head>

<main class="mx-auto max-w-4xl px-4 py-10 sm:py-16">
	<div class="mb-6">
		<Button.Root href="/dashboard/{page.params.id}" variant="ghost" size="sm">
			<ArrowLeftIcon class="mr-2 size-4" />
			Back to quiz
		</Button.Root>
	</div>

	<header class="mb-8">
		<h1 class="text-foreground text-3xl font-bold tracking-tight sm:text-4xl">Past sessions</h1>
		<p class="text-muted-foreground mt-2 text-sm sm:text-base">
			Every run of <span class="text-foreground font-medium">{data.quiz.title}</span>, newest first.
		</p>
	</header>

	{#if data.sessions.length === 0}
		<Card.Root class="border-dashed">
			<Card.Content class="flex flex-col items-center gap-4 py-16 text-center">
				<p class="text-muted-foreground text-sm">
					No sessions yet — start one from the quiz detail page.
				</p>
				<Button.Root href="/dashboard/{page.params.id}">Back to quiz</Button.Root>
			</Card.Content>
		</Card.Root>
	{:else}
		<ul class="space-y-3" aria-label="Past sessions">
			{#each data.sessions as session (session.id)}
				{@const meta = STATUS_META[session.status]}
				<li>
					<Card.Root>
						<div class="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-2">
									<p class="text-foreground text-sm font-semibold tabular-nums sm:text-base">
										{formatStartedAt(session.startedAt)}
									</p>
									<Badge variant={meta.variant}>{meta.label}</Badge>
								</div>
								<p class="text-muted-foreground mt-1 text-xs sm:text-sm">
									{session.participantCount}
									{session.participantCount === 1 ? 'participant' : 'participants'}
								</p>
							</div>

							<div class="flex flex-wrap items-center gap-3 sm:gap-4">
								{#if session.winnerNickname !== null && session.winnerScore !== null}
									<div
										class="text-foreground inline-flex items-center gap-1.5 text-sm"
										aria-label="Winner"
									>
										<TrophyIcon class="text-success size-4" aria-hidden="true" />
										<span class="max-w-[10rem] truncate font-medium">{session.winnerNickname}</span>
										<span class="text-muted-foreground tabular-nums">
											+{session.winnerScore} pts
										</span>
									</div>
								{:else}
									<span class="text-muted-foreground text-sm italic">No participants</span>
								{/if}

								<Button.Root
									href="/dashboard/{page.params.id}/sessions/{session.id}"
									variant="outline"
									size="sm"
								>
									View leaderboard
								</Button.Root>
							</div>
						</div>
					</Card.Root>
				</li>
			{/each}
		</ul>
	{/if}
</main>
