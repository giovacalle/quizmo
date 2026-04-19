<script lang="ts">
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlayIcon from '@lucide/svelte/icons/play';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import { toast } from 'svelte-sonner';

	import { enhance } from '$app/forms';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Badge } from '$lib/components/ui/badge';
	import * as Button from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';

	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const STATUS_LABEL: Record<'draft' | 'active' | 'archived', string> = {
		draft: 'Draft',
		active: 'Active',
		archived: 'Archived'
	};

	let deleteTargetId = $state<string | null>(null);
	let deleteTargetTitle = $state<string>('');
	let deleting = $state(false);

	function openDelete(id: string, title: string) {
		deleteTargetId = id;
		deleteTargetTitle = title;
	}
</script>

<svelte:head>
	<title>Your quizzes · Quizmo</title>
</svelte:head>

<main class="mx-auto max-w-4xl px-4 py-10 sm:py-16">
	<header class="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h1 class="text-foreground text-3xl font-bold tracking-tight sm:text-4xl">Your quizzes</h1>
			<p class="text-muted-foreground mt-2 text-sm sm:text-base">
				Create a quiz, start a session, share the code.
			</p>
		</div>
		<Button.Root href="/dashboard/new" size="lg">
			<PlusIcon class="mr-2 size-4" />
			Create quiz
		</Button.Root>
	</header>

	<!-- Quota badges -->
	<div class="mb-6 flex flex-wrap items-center gap-2">
		<Badge variant={data.activeCount >= 3 ? 'destructive' : 'secondary'}>
			{data.activeCount}/3 active
		</Badge>
		<Badge variant={data.nonArchivedCount >= 20 ? 'destructive' : 'secondary'}>
			{data.nonArchivedCount}/20 lifetime
		</Badge>
	</div>

	{#if data.rows.length === 0}
		<Card.Root class="border-dashed">
			<Card.Content class="flex flex-col items-center gap-4 py-16 text-center">
				<div
					class="bg-primary/10 text-primary flex size-14 items-center justify-center rounded-2xl"
				>
					<PlusIcon class="size-7" />
				</div>
				<div class="space-y-1">
					<Card.Title>No quizzes yet</Card.Title>
					<Card.Description>
						Create your first quiz to get a join code for players.
					</Card.Description>
				</div>
				<Button.Root href="/dashboard/new" size="lg">Create your first quiz</Button.Root>
			</Card.Content>
		</Card.Root>
	{:else}
		<ul class="space-y-3" aria-label="Your quizzes">
			{#each data.rows as quiz (quiz.id)}
				<li>
					<Card.Root>
						<div class="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<h3 class="text-foreground truncate text-base font-semibold sm:text-lg">
										{quiz.title}
									</h3>
									<Badge
										variant={quiz.status === 'active'
											? 'default'
											: quiz.status === 'draft'
												? 'outline'
												: 'secondary'}
									>
										{STATUS_LABEL[quiz.status]}
									</Badge>
								</div>
								{#if quiz.description}
									<p class="text-muted-foreground mt-1 truncate text-sm">{quiz.description}</p>
								{/if}
							</div>

							<div class="flex flex-wrap items-center gap-2">
								<Button.Root
									href={`/dashboard/${quiz.id}`}
									variant="outline"
									size="sm"
									aria-label={`Edit ${quiz.title}`}
								>
									<PencilIcon class="mr-1.5 size-3.5" />
									Edit
								</Button.Root>

								<form
									method="POST"
									action={`/dashboard/${quiz.id}?/startSession`}
									use:enhance={() => {
										return async ({ result }) => {
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
										size="sm"
										aria-label={`Start session for ${quiz.title}`}
									>
										<PlayIcon class="mr-1.5 size-3.5" />
										Start Session
									</Button.Root>
								</form>

								<Button.Root
									variant="destructive"
									size="sm"
									aria-label={`Delete ${quiz.title}`}
									onclick={() => openDelete(quiz.id, quiz.title)}
								>
									<TrashIcon class="size-3.5" />
								</Button.Root>
							</div>
						</div>
					</Card.Root>
				</li>
			{/each}
		</ul>
	{/if}
</main>

<!-- Delete confirmation dialog ------------------------------------------ -->
<AlertDialog.Root
	open={deleteTargetId !== null}
	onOpenChange={(o) => {
		if (!o) deleteTargetId = null;
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete this quiz?</AlertDialog.Title>
			<AlertDialog.Description>
				"<span class="text-foreground font-medium">{deleteTargetTitle}</span>" and all its
				questions, answers, and past session history will be permanently removed.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<form
				method="POST"
				action="?/deleteQuiz"
				use:enhance={() => {
					deleting = true;
					return async ({ result, update }) => {
						deleting = false;
						if (result.type === 'success') {
							toast.success('Quiz deleted');
							deleteTargetId = null;
							await update();
							return;
						}
						if (result.type === 'failure') {
							const msg =
								typeof result.data?.message === 'string'
									? result.data.message
									: 'Could not delete quiz';
							toast.error(msg);
						}
					};
				}}
			>
				<input type="hidden" name="quizId" value={deleteTargetId ?? ''} />
				<Button.Root
					type="submit"
					variant="destructive"
					aria-disabled={deleting}
					onclick={(e) => {
						if (deleting) e.preventDefault();
					}}
				>
					{#if deleting}
						<Loader2Icon class="mr-2 size-4 animate-spin" />
					{/if}
					Delete
				</Button.Root>
			</form>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
