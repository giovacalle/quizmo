<script lang="ts">
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import { toast } from 'svelte-sonner';
	import { arrayProxy, superForm, type SuperValidated } from 'sveltekit-superforms';
	import { valibotClient } from 'sveltekit-superforms/adapters';

	import * as Button from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Form from '$lib/components/ui/form';
	import * as Input from '$lib/components/ui/input';
	import * as Label from '$lib/components/ui/label';
	import * as RadioGroup from '$lib/components/ui/radio-group';
	import { quizWithQuestionsSchema, type QuizWithQuestions } from '$lib/validators';

	interface Props {
		form: SuperValidated<QuizWithQuestions>;
		action: string;
		submitLabel: string;
	}

	let { form: initialForm, action, submitLabel }: Props = $props();

	// `superForm` consumes the initial SuperValidated snapshot once and manages
	// its own stores from there. The prop legitimately isn't re-read after mount
	// (the parent route remounts the component on quiz-id change via SvelteKit's
	// default [id] key), so the `state_referenced_locally` warning is a
	// false-positive here.
	// svelte-ignore state_referenced_locally
	const superform = superForm(initialForm, {
		// Required for nested arrays/objects — FormData encoding would flatten away
		// the answer-per-question structure. `superValidate(event, ...)` auto-parses
		// the JSON body on the server side.
		dataType: 'json',
		validators: valibotClient(quizWithQuestionsSchema),
		// Preserve unsaved edits on failure (cap breach, validation). v2's default
		// is `resetForm: true`, which only applies on success.
		resetForm: false,
		onUpdated({ form }) {
			if (form.message) {
				if (form.valid) toast.success(form.message);
				else toast.error(form.message);
			}
		}
	});

	const { form: formData, errors, enhance, submitting, message } = superform;

	// Top-level `questions` array. `values` is a Writable of the array (mutating
	// it via store assignment triggers schema re-validation); `errors` holds
	// array-level errors (minLength/maxLength); per-element errors sit under
	// `$errors.questions[i]` (including the `v.check` "exactly one correct" that
	// Valibot routes to the question-object path — lands as `string[]` because
	// the last path segment is numeric, not `_errors`).
	const { values: questions, errors: questionsErrors } = arrayProxy(superform, 'questions');

	function blankAnswer(isCorrect = false) {
		return { text: '', isCorrect };
	}
	function blankQuestion() {
		return {
			text: '',
			timeLimitSec: 20,
			points: 1000,
			answers: [blankAnswer(true), blankAnswer(false)]
		};
	}

	function addQuestion() {
		if ($questions.length >= 25) {
			toast.error('A quiz can have at most 25 questions');
			return;
		}
		$questions = [...$questions, blankQuestion()];
	}
	function removeQuestion(idx: number) {
		if ($questions.length <= 3) {
			toast.error('A quiz needs at least 3 questions');
			return;
		}
		$questions = $questions.filter((_, i) => i !== idx);
	}
	// Answer-level mutations rebuild the whole `questions` array with the target
	// question replaced — this routes through `$formData.questions = [...]` so Svelte's
	// store auto-subscription calls `.set()` and formsnap re-validates. Mutating a
	// captured nested reference (`q.answers = ...`) would skip the store contract.
	function replaceQuestionAnswers(
		qIdx: number,
		build: (
			current: (typeof $formData.questions)[number]['answers']
		) => (typeof $formData.questions)[number]['answers']
	) {
		const q = $formData.questions[qIdx];
		if (!q) return;
		$formData.questions = $formData.questions.map((question, i) =>
			i === qIdx ? { ...question, answers: build(q.answers) } : question
		);
	}
	function addAnswer(qIdx: number) {
		const q = $formData.questions[qIdx];
		if (!q) return;
		if (q.answers.length >= 6) {
			toast.error('A question can have at most 6 answers');
			return;
		}
		replaceQuestionAnswers(qIdx, (answers) => [...answers, blankAnswer(false)]);
	}
	function removeAnswer(qIdx: number, aIdx: number) {
		const q = $formData.questions[qIdx];
		if (!q) return;
		if (q.answers.length <= 2) {
			toast.error('A question needs at least 2 answers');
			return;
		}
		replaceQuestionAnswers(qIdx, (answers) => {
			const removed = answers[aIdx];
			const next = answers.filter((_, i) => i !== aIdx);
			// If we removed the only correct answer, promote the first remaining so
			// the `v.check` "exactly one correct" invariant keeps holding.
			if (removed?.isCorrect && !next.some((a) => a.isCorrect) && next[0]) {
				next[0] = { ...next[0], isCorrect: true };
			}
			return next;
		});
	}
	function setCorrect(qIdx: number, aIdx: number) {
		replaceQuestionAnswers(qIdx, (answers) =>
			answers.map((a, i) => ({ ...a, isCorrect: i === aIdx }))
		);
	}
</script>

<form method="POST" {action} use:enhance class="space-y-6">
	<!-- Basics -->
	<Card.Root>
		<Card.Header>
			<Card.Title>Basics</Card.Title>
			<Card.Description>A title players see in the lobby.</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<Form.Field form={superform} name="title">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>Title</Form.Label>
						<Input.Root
							{...props}
							type="text"
							placeholder="e.g. Capitals of Europe"
							maxlength={120}
							bind:value={$formData.title}
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>

			<Form.Field form={superform} name="description">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>Description (optional)</Form.Label>
						<Input.Root
							{...props}
							type="text"
							placeholder="Short one-liner"
							maxlength={500}
							bind:value={$formData.description}
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>
		</Card.Content>
	</Card.Root>

	<!-- Questions -->
	<div class="space-y-4">
		<div class="flex items-center justify-between">
			<div>
				<h2 class="text-foreground text-xl font-semibold tracking-tight">Questions</h2>
				<p class="text-muted-foreground text-sm">
					{$questions.length} of 25 · 3 minimum · 2–6 answers, one correct
				</p>
			</div>
			<Button.Root type="button" variant="outline" onclick={addQuestion}>
				<PlusIcon class="mr-1.5 size-3.5" />
				Add question
			</Button.Root>
		</div>

		{#if $questionsErrors}
			<p class="text-destructive text-sm" role="alert">{$questionsErrors}</p>
		{/if}

		{#each $questions as _question, qIdx (qIdx)}
			{@const question = $formData.questions[qIdx]}
			{#if question}
				{@const correctIdx = question.answers.findIndex((a) => a.isCorrect)}
				{@const questionLevelErrors = $errors.questions?.[qIdx]}
				{@const crossFieldErrors = Array.isArray(questionLevelErrors) ? questionLevelErrors : null}
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
						<Form.Field form={superform} name={`questions[${qIdx}].text`}>
							<Form.Control>
								{#snippet children({ props })}
									<Form.Label>Question text</Form.Label>
									<Input.Root
										{...props}
										type="text"
										placeholder="What's the question?"
										maxlength={500}
										bind:value={$formData.questions[qIdx]!.text}
									/>
								{/snippet}
							</Form.Control>
							<Form.FieldErrors />
						</Form.Field>

						<div class="grid gap-3 sm:grid-cols-2">
							<Form.Field form={superform} name={`questions[${qIdx}].timeLimitSec`}>
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label>Time limit (seconds)</Form.Label>
										<Input.Root
											{...props}
											type="number"
											min={5}
											max={120}
											bind:value={$formData.questions[qIdx]!.timeLimitSec}
										/>
									{/snippet}
								</Form.Control>
								<Form.FieldErrors />
							</Form.Field>

							<Form.Field form={superform} name={`questions[${qIdx}].points`}>
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label>Base points</Form.Label>
										<Input.Root
											{...props}
											type="number"
											min={100}
											max={5000}
											step={100}
											bind:value={$formData.questions[qIdx]!.points}
										/>
									{/snippet}
								</Form.Control>
								<Form.FieldErrors />
							</Form.Field>
						</div>

						<!-- Answers: a nested array. Each answer's text binds directly against
					     `$formData.questions[qIdx].answers[aIdx].text` so Svelte's store
					     auto-subscription calls `.set()` on the form store and formsnap re-validates.
					     The `v.check` "exactly one correct" invariant is encoded here via a RadioGroup
					     and enforced on the server by `questionWithAnswersSchema`. -->
						<Form.Fieldset form={superform} name={`questions[${qIdx}].answers`}>
							<Form.Legend>Answers</Form.Legend>
							<RadioGroup.Root
								value={String(correctIdx >= 0 ? correctIdx : 0)}
								onValueChange={(val) => setCorrect(qIdx, Number(val))}
								class="space-y-2"
							>
								{#each question.answers as _answer, aIdx (aIdx)}
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
										<Form.Field
											form={superform}
											name={`questions[${qIdx}].answers[${aIdx}].text`}
											class="flex-1 space-y-0"
										>
											<Form.Control>
												{#snippet children({ props })}
													<Input.Root
														{...props}
														type="text"
														placeholder={`Answer ${aIdx + 1}`}
														maxlength={200}
														bind:value={$formData.questions[qIdx]!.answers[aIdx]!.text}
													/>
												{/snippet}
											</Form.Control>
											<Form.FieldErrors class="mt-1" />
										</Form.Field>
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
							<!-- Array-level errors on the answers list (minLength "2", maxLength "6"). The
						     error path is `answers._errors`; Formsnap's extractor pulls either shape. -->
							<Form.FieldErrors />
						</Form.Fieldset>

						<!-- Cross-field "exactly one correct" error. Valibot's `v.check` on
					     `questionWithAnswersSchema` emits at path `['questions', qIdx]`, which
					     superforms routes to `$errors.questions[qIdx]` as a `string[]` (numeric
					     last segment → array slot, not `_errors`). -->
						{#if crossFieldErrors}
							{#each crossFieldErrors as err (err)}
								<p class="text-destructive text-sm font-medium" role="alert">{err}</p>
							{/each}
						{/if}

						<Button.Root type="button" variant="ghost" size="sm" onclick={() => addAnswer(qIdx)}>
							<PlusIcon class="mr-1.5 size-3.5" />
							Add answer
						</Button.Root>
					</Card.Content>
				</Card.Root>
			{/if}
		{/each}
	</div>

	{#if $message}
		<p class="text-destructive text-sm" role="alert">{$message}</p>
	{/if}

	<div class="flex flex-wrap items-center justify-end gap-3">
		<Button.Root href="/dashboard" variant="ghost">Cancel</Button.Root>
		<Form.Button
			size="lg"
			aria-disabled={$submitting}
			onclick={(e) => {
				if ($submitting) e.preventDefault();
			}}
		>
			{#if $submitting}
				<Loader2Icon class="mr-2 size-4 animate-spin" aria-hidden="true" />
			{/if}
			{submitLabel}
		</Form.Button>
	</div>
</form>
