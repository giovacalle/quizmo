<script lang="ts">
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import { toast } from 'svelte-sonner';

	import { applyAction, enhance } from '$app/forms';
	import * as Button from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Input from '$lib/components/ui/input';
	import * as Label from '$lib/components/ui/label';
	import * as RadioGroup from '$lib/components/ui/radio-group';

	interface AnswerInput {
		text: string;
		isCorrect: boolean;
	}
	interface QuestionInput {
		text: string;
		timeLimitSec: number;
		points: number;
		answers: AnswerInput[];
	}
	interface QuizFormValue {
		title: string;
		description: string;
		questions: QuestionInput[];
	}

	interface Props {
		initial?: QuizFormValue;
		action: string;
		submitLabel: string;
	}

	let { initial, action, submitLabel }: Props = $props();

	// Sensible default: 3 questions with 2 answers each — matches the schema's
	// minimum (questions >= 3, answers >= 2), so a fresh draft is already valid.
	function blankAnswer(): AnswerInput {
		return { text: '', isCorrect: false };
	}
	function blankQuestion(): QuestionInput {
		return {
			text: '',
			timeLimitSec: 20,
			points: 1000,
			answers: [
				{ ...blankAnswer(), isCorrect: true },
				blankAnswer()
			]
		};
	}

	// Untracked `initial` capture — the form is mounted once per create/edit nav,
	// and subsequent edits are driven by the user. We deliberately do NOT $effect
	// back-sync; the dashboard page key remounts on new quiz IDs.
	const seedInitial = $derived.by(() => initial);
	let title = $state('');
	let description = $state('');
	let questions = $state<QuestionInput[]>([]);

	$effect(() => {
		const seed = seedInitial;
		title = seed?.title ?? '';
		description = seed?.description ?? '';
		questions =
			seed?.questions && seed.questions.length > 0
				? seed.questions.map((q) => ({
						...q,
						answers: q.answers.map((a) => ({ ...a }))
					}))
				: [blankQuestion(), blankQuestion(), blankQuestion()];
	});

	let submitting = $state(false);

	function addQuestion() {
		if (questions.length >= 25) {
			toast.error('A quiz can have at most 25 questions');
			return;
		}
		questions = [...questions, blankQuestion()];
	}
	function removeQuestion(idx: number) {
		if (questions.length <= 3) {
			toast.error('A quiz needs at least 3 questions');
			return;
		}
		questions = questions.filter((_, i) => i !== idx);
	}
	function addAnswer(qIdx: number) {
		const q = questions[qIdx];
		if (!q) return;
		if (q.answers.length >= 6) {
			toast.error('A question can have at most 6 answers');
			return;
		}
		q.answers = [...q.answers, blankAnswer()];
	}
	function removeAnswer(qIdx: number, aIdx: number) {
		const q = questions[qIdx];
		if (!q) return;
		if (q.answers.length <= 2) {
			toast.error('A question needs at least 2 answers');
			return;
		}
		const removed = q.answers[aIdx];
		q.answers = q.answers.filter((_, i) => i !== aIdx);
		// If we removed the only correct answer, move correctness to the first remaining.
		if (removed?.isCorrect && !q.answers.some((a) => a.isCorrect) && q.answers[0]) {
			q.answers[0].isCorrect = true;
		}
	}
	function setCorrect(qIdx: number, aIdx: number) {
		const q = questions[qIdx];
		if (!q) return;
		q.answers = q.answers.map((a, i) => ({ ...a, isCorrect: i === aIdx }));
	}

	// Client-side validity gate — UX only. The server runs the full valibot pipe.
	const clientValid = $derived(
		title.trim().length > 0 &&
			title.trim().length <= 120 &&
			description.trim().length <= 500 &&
			questions.length >= 3 &&
			questions.length <= 25 &&
			questions.every(
				(q) =>
					q.text.trim().length > 0 &&
					q.text.trim().length <= 500 &&
					q.timeLimitSec >= 5 &&
					q.timeLimitSec <= 120 &&
					q.points >= 100 &&
					q.points <= 5000 &&
					q.answers.length >= 2 &&
					q.answers.length <= 6 &&
					q.answers.filter((a) => a.isCorrect).length === 1 &&
					q.answers.every((a) => a.text.trim().length > 0 && a.text.trim().length <= 200)
			)
	);

	function buildPayload() {
		return JSON.stringify({
			title,
			description: description.trim() ? description : undefined,
			questions: questions.map((q) => ({
				text: q.text,
				timeLimitSec: Number(q.timeLimitSec),
				points: Number(q.points),
				answers: q.answers.map((a) => ({ text: a.text, isCorrect: !!a.isCorrect }))
			}))
		});
	}
</script>

<form
	method="POST"
	{action}
	use:enhance={() => {
		submitting = true;
		return async ({ result }) => {
			submitting = false;
			if (result.type === 'redirect') {
				await applyAction(result);
				return;
			}
			if (result.type === 'failure') {
				const msg =
					typeof result.data?.message === 'string' ? result.data.message : 'Could not save quiz';
				toast.error(msg);
			} else if (result.type === 'error') {
				const msg =
					result.error && typeof result.error === 'object' && 'message' in result.error
						? String((result.error as { message: unknown }).message)
						: 'Could not save quiz';
				toast.error(msg);
			}
			await applyAction(result);
		};
	}}
	class="space-y-6"
>
	<input type="hidden" name="payload" value={buildPayload()} />

	<!-- Metadata -->
	<Card.Root>
		<Card.Header>
			<Card.Title>Basics</Card.Title>
			<Card.Description>A title players see in the lobby.</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<div class="space-y-2">
				<Label.Root for="quiz-title">Title</Label.Root>
				<Input.Root
					id="quiz-title"
					type="text"
					placeholder="e.g. Capitals of Europe"
					maxlength={120}
					bind:value={title}
					required
				/>
				{#if title.trim().length === 0}
					<p class="text-muted-foreground text-xs">1–120 characters.</p>
				{/if}
			</div>
			<div class="space-y-2">
				<Label.Root for="quiz-description">Description (optional)</Label.Root>
				<Input.Root
					id="quiz-description"
					type="text"
					placeholder="Short one-liner"
					maxlength={500}
					bind:value={description}
				/>
			</div>
		</Card.Content>
	</Card.Root>

	<!-- Questions -->
	<div class="space-y-4">
		<div class="flex items-center justify-between">
			<div>
				<h2 class="text-foreground text-xl font-semibold tracking-tight">Questions</h2>
				<p class="text-muted-foreground text-sm">
					{questions.length} of 25 · 3 minimum · 2–6 answers, one correct
				</p>
			</div>
			<Button.Root type="button" variant="outline" onclick={addQuestion}>
				<PlusIcon class="mr-1.5 size-3.5" />
				Add question
			</Button.Root>
		</div>

		{#each questions as question, qIdx (qIdx)}
			<Card.Root>
				<Card.Header>
					<div class="flex items-center justify-between">
						<Card.Title class="text-base">Question {qIdx + 1}</Card.Title>
						<Button.Root
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label="Remove question"
							onclick={() => removeQuestion(qIdx)}
						>
							<TrashIcon class="size-4" />
						</Button.Root>
					</div>
				</Card.Header>
				<Card.Content class="space-y-4">
					<div class="space-y-2">
						<Label.Root for={`q-${qIdx}-text`}>Question text</Label.Root>
						<Input.Root
							id={`q-${qIdx}-text`}
							type="text"
							placeholder="What's the question?"
							maxlength={500}
							bind:value={question.text}
							required
						/>
					</div>

					<div class="grid gap-3 sm:grid-cols-2">
						<div class="space-y-2">
							<Label.Root for={`q-${qIdx}-time`}>Time limit (seconds)</Label.Root>
							<Input.Root
								id={`q-${qIdx}-time`}
								type="number"
								min={5}
								max={120}
								bind:value={question.timeLimitSec}
							/>
						</div>
						<div class="space-y-2">
							<Label.Root for={`q-${qIdx}-points`}>Base points</Label.Root>
							<Input.Root
								id={`q-${qIdx}-points`}
								type="number"
								min={100}
								max={5000}
								step={100}
								bind:value={question.points}
							/>
						</div>
					</div>

					<div class="space-y-2">
						<p class="text-foreground mb-1 text-sm font-medium">Answers</p>
						<RadioGroup.Root
							value={String(
								question.answers.findIndex((a) => a.isCorrect) >= 0
									? question.answers.findIndex((a) => a.isCorrect)
									: 0
							)}
							onValueChange={(val) => setCorrect(qIdx, Number(val))}
							class="space-y-2"
						>
							{#each question.answers as answer, aIdx (aIdx)}
								<div class="flex items-center gap-2">
									<div
										class="border-border bg-muted/30 inline-flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs"
									>
										<RadioGroup.Item
											value={String(aIdx)}
											id={`q-${qIdx}-a-${aIdx}-correct`}
											aria-label={`Mark answer ${aIdx + 1} as correct`}
										/>
										<Label.Root
											for={`q-${qIdx}-a-${aIdx}-correct`}
											class="cursor-pointer text-xs font-medium"
										>
											Correct
										</Label.Root>
									</div>
									<Input.Root
										type="text"
										placeholder={`Answer ${aIdx + 1}`}
										maxlength={200}
										bind:value={answer.text}
										required
										class="flex-1"
									/>
									<Button.Root
										type="button"
										variant="ghost"
										size="icon-sm"
										aria-label="Remove answer"
										onclick={() => removeAnswer(qIdx, aIdx)}
									>
										<TrashIcon class="size-4" />
									</Button.Root>
								</div>
							{/each}
						</RadioGroup.Root>
						<Button.Root type="button" variant="ghost" size="sm" onclick={() => addAnswer(qIdx)}>
							<PlusIcon class="mr-1.5 size-3.5" />
							Add answer
						</Button.Root>
					</div>
				</Card.Content>
			</Card.Root>
		{/each}
	</div>

	<div class="flex flex-wrap items-center justify-end gap-3">
		<Button.Root href="/dashboard" variant="ghost">Cancel</Button.Root>
		<Button.Root
			type="submit"
			size="lg"
			aria-disabled={!clientValid || submitting}
			onclick={(e) => {
				if (!clientValid || submitting) e.preventDefault();
			}}
		>
			{#if submitting}
				<Loader2Icon class="mr-2 size-4 animate-spin" />
			{/if}
			{submitLabel}
		</Button.Root>
	</div>
</form>
