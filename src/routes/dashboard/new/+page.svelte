<script lang="ts">
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';

	import * as Button from '$lib/components/ui/button';

	import QuizForm from '../_components/quiz-form.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Create quiz · Quizmo</title>
</svelte:head>

<main class="mx-auto max-w-3xl px-4 py-10 sm:py-16">
	<div class="mb-6">
		<Button.Root href="/dashboard" variant="ghost" size="sm">
			<ArrowLeftIcon class="mr-2 size-4" />
			Back to dashboard
		</Button.Root>
	</div>

	<header class="mb-8">
		<h1 class="text-foreground text-3xl font-bold tracking-tight sm:text-4xl">Create a quiz</h1>
		<p class="text-muted-foreground mt-2 text-sm sm:text-base">
			Add 3 to 25 questions, each with 2 to 6 answers and exactly one correct choice.
		</p>
	</header>

	<QuizForm action="?/create" submitLabel="Create quiz" form={data.form} />
</main>
