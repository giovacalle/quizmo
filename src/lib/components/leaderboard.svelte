<script lang="ts">
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import { flip } from 'svelte/animate';
	import { quintOut } from 'svelte/easing';

	import { cn } from '$lib/utils';

	interface LeaderboardEntry {
		id: string;
		nickname: string;
		score: number;
		/** Previous position (1-indexed). Omit on initial render — no arrow shown. */
		prevPosition?: number;
	}

	interface Props {
		entries: LeaderboardEntry[];
		maxRows?: number;
		/**
		 * Suppress FLIP animation while an active question is in flight — reordering
		 * during play is distracting for hosts. Default: false (animated).
		 */
		frozen?: boolean;
		class?: string;
	}

	let { entries, maxRows, frozen = false, class: className }: Props = $props();

	/** Sort + assign current positions + compute deltas. */
	const rows = $derived.by(() => {
		const sorted = [...entries].sort((a, b) => b.score - a.score);
		const capped = maxRows !== undefined ? sorted.slice(0, maxRows) : sorted;
		return capped.map((entry, idx) => {
			const currentPosition = idx + 1;
			const delta =
				entry.prevPosition !== undefined && entry.prevPosition !== currentPosition
					? entry.prevPosition - currentPosition
					: 0;
			return { ...entry, currentPosition, delta };
		});
	});

	/**
	 * Transient 2-second highlight tracker for entries whose position moved since
	 * the last render. Keyed by entry id. Each entry into the set is timed out
	 * independently so overlapping moves don't reset each other.
	 */
	let highlighted = $state<Record<string, true>>({});
	let lastSeen = $state<Record<string, number>>({});

	$effect(() => {
		// When a row's position differs from its cached `lastSeen`, highlight it
		// for 2s and update the cache.
		const snapshot = rows;
		const timers: ReturnType<typeof setTimeout>[] = [];
		for (const r of snapshot) {
			const prev = lastSeen[r.id];
			if (prev !== undefined && prev !== r.currentPosition) {
				highlighted[r.id] = true;
				timers.push(
					setTimeout(() => {
						delete highlighted[r.id];
					}, 2000)
				);
			}
			lastSeen[r.id] = r.currentPosition;
		}
		return () => {
			for (const t of timers) clearTimeout(t);
		};
	});

	/**
	 * Podium background tint. We keep the badge palette rooted in our semantic
	 * tokens (no hardcoded hex) — `accent` anchors the visual weight, opacity
	 * conveys rank so the component still reads correctly in both light + dark
	 * mode. We opted against gold/silver/bronze hardcoded colors: they would
	 * require three new standalone tokens just to theme three rows, bloating
	 * the design system for a fleeting visual cue.
	 */
	function podiumClasses(position: number): string {
		if (position === 1) return 'border-accent bg-accent/60 text-accent-foreground';
		if (position === 2) return 'border-accent/70 bg-accent/40 text-accent-foreground';
		if (position === 3) return 'border-accent/50 bg-accent/25 text-accent-foreground';
		return 'border-border bg-muted/40 text-foreground';
	}
</script>

{#if rows.length === 0}
	<p class="text-muted-foreground px-4 py-8 text-center text-sm" role="status">No scores yet</p>
{:else}
	<ol aria-live="polite" aria-label="Leaderboard" class={cn('space-y-2', className)}>
		{#each rows as row (row.id)}
			<li
				animate:flip={frozen ? { duration: 0 } : { duration: 400, easing: quintOut }}
				class={cn(
					'border-border bg-card flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors',
					highlighted[row.id] && row.delta > 0 && 'bg-success/10',
					highlighted[row.id] && row.delta < 0 && 'bg-destructive/10'
				)}
			>
				<div
					class={cn(
						'flex size-8 shrink-0 items-center justify-center rounded-md border text-sm font-semibold tabular-nums',
						podiumClasses(row.currentPosition)
					)}
					aria-label={`Position ${row.currentPosition}`}
				>
					{row.currentPosition}
				</div>

				<div class="min-w-0 flex-1">
					<p class="text-foreground truncate text-sm font-medium">{row.nickname}</p>
				</div>

				{#if row.delta !== 0}
					{#if row.delta > 0}
						<span
							class="text-success inline-flex items-center gap-0.5 text-xs font-medium"
							aria-label={`Moved up ${row.delta}`}
						>
							<ChevronUpIcon class="size-3.5" />
							{row.delta}
						</span>
					{:else}
						<span
							class="text-destructive inline-flex items-center gap-0.5 text-xs font-medium"
							aria-label={`Moved down ${Math.abs(row.delta)}`}
						>
							<ChevronDownIcon class="size-3.5" />
							{Math.abs(row.delta)}
						</span>
					{/if}
				{/if}

				<div class="text-foreground text-sm font-semibold tabular-nums">{row.score}</div>
			</li>
		{/each}
	</ol>
{/if}
