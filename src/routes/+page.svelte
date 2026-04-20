<script lang="ts">
	import PlayIcon from '@lucide/svelte/icons/play';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Share2Icon from '@lucide/svelte/icons/share-2';
	import SparklesIcon from '@lucide/svelte/icons/sparkles';
	import TrophyIcon from '@lucide/svelte/icons/trophy';
	import ZapIcon from '@lucide/svelte/icons/zap';
	import { fly } from 'svelte/transition';

	import { Badge } from '$lib/components/ui/badge';
	import * as Button from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';

	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const steps = [
		{
			icon: PlusIcon,
			title: 'Create',
			description: 'Write questions, set a timer, pick the right answer.'
		},
		{
			icon: Share2Icon,
			title: 'Share',
			description: 'A 6-character code is all players need to join.'
		},
		{
			icon: PlayIcon,
			title: 'Play',
			description: 'Run the quiz live and watch the leaderboard update.'
		}
	];

	const features = [
		{
			icon: ZapIcon,
			title: 'Fast & frictionless',
			description: 'From idea to live game in under a minute. No installs, no accounts for players.'
		},
		{
			icon: TrophyIcon,
			title: 'Live leaderboards',
			description:
				'Scores reorder as answers come in, with smooth animations and instant podium reveals.'
		},
		{
			icon: SparklesIcon,
			title: 'Instant feedback',
			description: 'Players see the correct answer and their ranking the moment the timer runs out.'
		}
	];
</script>

<svelte:head>
	<title>Quizmo · Host live quizzes in seconds</title>
	<meta
		name="description"
		content="Create a quiz, share the code, play live together. Fast, frictionless live quizzes for classrooms, teams, and friends."
	/>
	<meta property="og:title" content="Quizmo · Host live quizzes in seconds" />
	<meta
		property="og:description"
		content="Create a quiz, share the code, play live together."
	/>
	<meta property="og:type" content="website" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="Quizmo · Host live quizzes in seconds" />
	<meta
		name="twitter:description"
		content="Create a quiz, share the code, play live together."
	/>
</svelte:head>

<main class="bg-background text-foreground min-h-dvh">
	<!-- Hero ------------------------------------------------------------ -->
	<section class="relative overflow-hidden px-4 pt-20 pb-16 sm:pt-28 sm:pb-24">
		<div class="mx-auto grid max-w-6xl gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
			<div class="space-y-6 text-center lg:text-left">
				<h1
					class="text-foreground text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl"
				>
					Host live quizzes in seconds
				</h1>
				<p class="text-muted-foreground mx-auto max-w-xl text-lg sm:text-xl lg:mx-0">
					Create a quiz, share the code, play live together.
				</p>
				<div class="flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start">
					<Button.Root href={data.createQuizHref} size="lg" class="w-full sm:w-auto">
						Create a quiz
					</Button.Root>
					<Button.Root href="/join" variant="ghost" size="lg" class="w-full sm:w-auto">
						Join with code
					</Button.Root>
				</div>
			</div>

			<!-- Animated demo card -->
			<div class="relative" in:fly={{ y: 20, duration: 600 }} aria-hidden="true">
				<div
					class="from-primary/30 via-accent/40 absolute -inset-8 -z-10 rounded-[2rem] bg-gradient-to-br to-transparent blur-3xl"
				></div>
				<Card.Root class="border-border/60 overflow-hidden shadow-lg">
					<Card.Header class="space-y-1">
						<div
							class="text-muted-foreground flex items-center gap-2 text-xs font-medium uppercase"
						>
							<span class="bg-primary size-2 rounded-full"></span>
							Question 3 of 5
						</div>
						<Card.Title class="text-xl">Which planet is closest to the sun?</Card.Title>
					</Card.Header>
					<Card.Content class="space-y-2">
						<div
							class="border-border bg-muted/40 flex items-center justify-between rounded-lg border px-3 py-2"
						>
							<span class="text-sm font-medium">Mercury</span>
							<Badge variant="success">Correct</Badge>
						</div>
						<div class="border-border bg-background rounded-lg border px-3 py-2 text-sm">Venus</div>
						<div class="border-border bg-background rounded-lg border px-3 py-2 text-sm">Earth</div>
						<div class="border-border bg-background rounded-lg border px-3 py-2 text-sm">Mars</div>
					</Card.Content>
					<Card.Footer class="border-border bg-muted/30 flex items-center justify-between border-t">
						<span class="text-muted-foreground text-xs font-medium">23 players answered</span>
						<span class="text-primary text-xs font-semibold">+950 pts</span>
					</Card.Footer>
				</Card.Root>
			</div>
		</div>
	</section>

	<!-- How it works ---------------------------------------------------- -->
	<section class="px-4 py-16 sm:py-20">
		<div class="mx-auto max-w-6xl">
			<div class="mb-12 text-center">
				<h2 class="text-foreground text-3xl font-bold tracking-tight sm:text-4xl">How it works</h2>
				<p class="text-muted-foreground mt-3 text-base sm:text-lg">Three steps. No downloads.</p>
			</div>
			<div class="grid gap-6 sm:grid-cols-3">
				{#each steps as step, i (step.title)}
					{@const Icon = step.icon}
					<div
						class="flex flex-col items-center text-center"
						in:fly={{ y: 20, duration: 500, delay: 150 + i * 100 }}
					>
						<div
							class="bg-primary/10 text-primary mb-4 flex size-14 items-center justify-center rounded-2xl"
						>
							<Icon class="size-7" />
						</div>
						<h3 class="text-foreground mb-2 text-lg font-semibold">{step.title}</h3>
						<p class="text-muted-foreground max-w-xs text-sm">{step.description}</p>
					</div>
				{/each}
			</div>
		</div>
	</section>

	<!-- Features -------------------------------------------------------- -->
	<section class="bg-muted/30 px-4 py-16 sm:py-20">
		<div class="mx-auto max-w-6xl">
			<div class="mb-12 text-center">
				<h2 class="text-foreground text-3xl font-bold tracking-tight sm:text-4xl">
					Designed for moments together
				</h2>
				<p class="text-muted-foreground mt-3 text-base sm:text-lg">
					Everything you need for a great live game, nothing you don't.
				</p>
			</div>
			<div class="grid gap-6 sm:grid-cols-3">
				{#each features as feature, i (feature.title)}
					{@const Icon = feature.icon}
					<div in:fly={{ y: 20, duration: 500, delay: 100 + i * 100 }}>
						<Card.Root class="relative h-full overflow-hidden">
							<div class="bg-primary absolute top-0 bottom-0 left-0 w-1" aria-hidden="true"></div>
							<Card.Header class="pl-6">
								<div
									class="bg-primary/10 text-primary mb-3 flex size-10 items-center justify-center rounded-xl"
								>
									<Icon class="size-5" />
								</div>
								<Card.Title>{feature.title}</Card.Title>
							</Card.Header>
							<Card.Content class="pl-6">
								<p class="text-muted-foreground text-sm">{feature.description}</p>
							</Card.Content>
						</Card.Root>
					</div>
				{/each}
			</div>
		</div>
	</section>

	<!-- Final CTA block ------------------------------------------------- -->
	<section class="px-4 py-16 sm:py-20">
		<div class="mx-auto max-w-3xl">
			<div class="bg-accent border-border rounded-2xl border px-6 py-12 text-center sm:px-12">
				<h2 class="text-accent-foreground text-3xl font-bold tracking-tight sm:text-4xl">
					Ready to play?
				</h2>
				<p class="text-accent-foreground/80 mt-3 text-base sm:text-lg">
					Your first quiz is a couple of questions away.
				</p>
				<div class="mt-8 flex justify-center">
					<Button.Root href={data.createQuizHref} size="lg">Create a quiz</Button.Root>
				</div>
			</div>
		</div>
	</section>

	<!-- Footer ---------------------------------------------------------- -->
	<footer class="border-border border-t px-4 py-8">
		<div
			class="text-muted-foreground mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-sm sm:flex-row"
		>
			<p>
				Made with <span aria-hidden="true">❤️</span><span class="sr-only">love</span> by
				<a
					href="https://giova.dev"
					target="_blank"
					rel="noopener noreferrer"
					class="text-foreground hover:text-primary font-medium transition-colors"
				>
					giova.dev
				</a>
			</p>
			<!-- svelte-ignore a11y_invalid_attribute -->
			<a
				href="#"
				class="hover:text-foreground flex items-center gap-2 transition-colors"
				aria-label="View source on GitHub"
			>
				<svg class="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
					<path
						d="M12 .5C5.73.5.5 5.73.5 12a11.5 11.5 0 0 0 7.86 10.93c.58.1.79-.25.79-.56v-2c-3.2.69-3.88-1.37-3.88-1.37-.53-1.35-1.29-1.71-1.29-1.71-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.78 0c2.21-1.49 3.18-1.18 3.18-1.18.63 1.58.23 2.75.11 3.04.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.39-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5z"
					/>
				</svg>
				<span>GitHub</span>
			</a>
		</div>
	</footer>
</main>
