<script lang="ts">
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import HistoryIcon from '@lucide/svelte/icons/history';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import PlayIcon from '@lucide/svelte/icons/play';
	import { toast } from 'svelte-sonner';

	import { enhance } from '$app/forms';
	import { Badge } from '$lib/components/ui/badge';
	import * as Button from '$lib/components/ui/button';

	import QuizForm from '../_components/quiz-form.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const STATUS_LABEL: Record<'draft' | 'active' | 'archived', string> = {
		draft: 'Draft',
		active: 'Active',
		archived: 'Archived'
	};

	let starting = $state(false);
</script>

<svelte:head>
	<title>{data.quiz.title} · Quizmo</title>
</svelte:head>

<main class="mx-auto max-w-3xl px-4 py-10 sm:py-16">
	<div class="mb-6">
		<Button.Root href="/dashboard" variant="ghost" size="sm">
			<ArrowLeftIcon class="mr-2 size-4" />
			Back to dashboard
		</Button.Root>
	</div>

	<header class="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
		<div>
			<div class="flex items-center gap-2">
				<h1 class="text-foreground text-3xl font-bold tracking-tight sm:text-4xl">Edit quiz</h1>
				<Badge
					variant={data.quiz.status === 'active'
						? 'default'
						: data.quiz.status === 'draft'
							? 'outline'
							: 'secondary'}
				>
					{STATUS_LABEL[data.quiz.status]}
				</Badge>
			</div>
			<p class="text-muted-foreground mt-2 text-sm sm:text-base">
				Update questions and answers. Changes save on submit.
			</p>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<Button.Root href="/dashboard/{data.quiz.id}/sessions" variant="outline" size="sm">
				<HistoryIcon class="mr-1.5 size-4" aria-hidden="true" />
				Past sessions
			</Button.Root>
			<form
				method="POST"
				action="?/startSession"
				use:enhance={() => {
					starting = true;
					return async ({ result }) => {
						starting = false;
						if (result.type === 'redirect') {
							window.location.href = result.location;
							return;
						}
						if (result.type === 'failure') {
							const msg =
								typeof result.data?.message === 'string'
									? result.data.message
									: 'Could not start session';
							toast.error(msg);
						}
					};
				}}
			>
				<Button.Root
					type="submit"
					size="lg"
					aria-disabled={starting}
					onclick={(e) => {
						if (starting) e.preventDefault();
					}}
				>
					{#if starting}
						<Loader2Icon class="mr-2 size-4 animate-spin" />
					{:else}
						<PlayIcon class="mr-2 size-4" />
					{/if}
					Start Session
				</Button.Root>
			</form>
		</div>
	</header>

	<QuizForm action="?/update" submitLabel="Save changes" form={data.form} />
</main>
