import * as v from 'valibot';

/**
 * Shared Valibot schemas used on BOTH server and client.
 *
 * Lives outside `$lib/server/` so SvelteKit doesn't reject imports from
 * browser-bound code (client-side validation via `valibotClient(schema)` and
 * superforms' `$errors` rendering both need the schema value at runtime).
 *
 * Drizzle-valibot derived schemas (if needed) stay in `$lib/server/db/` — this
 * module is pure Valibot with no DB imports.
 */

// -- Field-level refinements --------------------------------------------------

/**
 * Email normalizer: parses any string-like input, trims, lowercases. Callers pass the
 * parsed output into DB ops so `users.email` (unique on `lower(email)`) stays in sync.
 */
export const emailSchema = v.pipe(
	v.string(),
	v.trim(),
	v.email('Enter a valid email'),
	v.transform((s) => s.toLowerCase())
);

/**
 * Nickname for live participants: trimmed, 1-20 visible chars. Profanity filter is
 * deferred.
 */
export const nicknameSchema = v.pipe(
	v.string(),
	v.trim(),
	v.minLength(1, 'Nickname is required'),
	v.maxLength(20, 'Nickname must be 20 characters or fewer')
);

/**
 * 6-char uppercase alphanumeric join code. Lowercase letters and shorter/longer inputs
 * are rejected. Separate from `quizCodeInputSchema` which coerces to uppercase for UX.
 */
export const joinCodeSchema = v.pipe(
	v.string(),
	v.regex(/^[A-Z0-9]{6}$/, 'Code must be 6 uppercase letters or digits')
);

/** OTP code submitted in the second step of the login flow. */
export const otpCodeSchema = v.pipe(
	v.string(),
	v.trim(),
	v.regex(/^\d{6}$/, 'Code must be 6 digits')
);

// -- Quiz-authoring refinements -----------------------------------------------

const titleSchema = v.pipe(
	v.string(),
	v.trim(),
	v.minLength(1, 'Title is required'),
	v.maxLength(120, 'Title must be 120 characters or fewer')
);

const descriptionSchema = v.pipe(
	v.string(),
	v.trim(),
	v.maxLength(500, 'Description must be 500 characters or fewer')
);

/** Quiz metadata only (no questions yet). Used for edit-in-place flows. */
export const quizInsertSchema = v.object({
	title: titleSchema,
	description: v.optional(descriptionSchema)
});
export type QuizInsert = v.InferOutput<typeof quizInsertSchema>;

/**
 * Answer row shape for a new question. `isCorrect` flags one-and-only-one within a
 * question (enforced at the question level via `questionWithAnswersSchema`).
 */
const answerInputSchema = v.object({
	text: v.pipe(
		v.string(),
		v.trim(),
		v.minLength(1, 'Answer text is required'),
		v.maxLength(200, 'Answer must be 200 characters or fewer')
	),
	isCorrect: v.boolean()
});

/**
 * A single question with its answer list. 2-6 answers, EXACTLY one marked correct.
 * The "exactly-one" check is a post-parse refinement since Valibot's built-ins don't
 * cover cross-field cardinality constraints.
 */
export const questionWithAnswersSchema = v.pipe(
	v.object({
		text: v.pipe(
			v.string(),
			v.trim(),
			v.minLength(1, 'Question text is required'),
			v.maxLength(500, 'Question must be 500 characters or fewer')
		),
		timeLimitSec: v.pipe(
			v.number(),
			v.integer(),
			v.minValue(5, 'Time limit must be at least 5 seconds'),
			v.maxValue(120, 'Time limit must be 120 seconds or fewer')
		),
		points: v.pipe(
			v.number(),
			v.integer(),
			v.minValue(100, 'Points must be at least 100'),
			v.maxValue(5000, 'Points must be 5000 or fewer')
		),
		answers: v.pipe(
			v.array(answerInputSchema),
			v.minLength(2, 'A question needs at least 2 answers'),
			v.maxLength(6, 'A question can have at most 6 answers')
		)
	}),
	v.check(
		(q) => q.answers.filter((a) => a.isCorrect).length === 1,
		'Each question must have exactly one correct answer'
	)
);
export type QuestionWithAnswers = v.InferOutput<typeof questionWithAnswersSchema>;

/**
 * Full quiz payload for create/edit: metadata + 3-25 questions. Used by the dashboard
 * form action to validate the submitted JSON payload.
 */
export const quizWithQuestionsSchema = v.object({
	title: titleSchema,
	description: v.optional(descriptionSchema),
	questions: v.pipe(
		v.array(questionWithAnswersSchema),
		v.minLength(3, 'A quiz needs at least 3 questions'),
		v.maxLength(25, 'A quiz can have at most 25 questions')
	)
});
export type QuizWithQuestions = v.InferOutput<typeof quizWithQuestionsSchema>;

// -- Domain-level input schemas -----------------------------------------------

/**
 * Login form payload. The email is normalized via `emailSchema`; the Turnstile token
 * is verified server-side before rate-limit checks (see `auth/rate-limit`).
 */
export const loginEmailSchema = v.object({
	email: emailSchema,
	turnstileToken: v.pipe(v.string(), v.minLength(1, 'Turnstile token required'))
});

/** Join flow payload: code + nickname + Turnstile. */
export const joinSchema = v.object({
	code: joinCodeSchema,
	nickname: nicknameSchema,
	turnstileToken: v.pipe(v.string(), v.minLength(1, 'Turnstile token required'))
});

/**
 * Two-step login wizard payload. `step` is the discriminant:
 *   - `send`   — email + Turnstile token; the server issues the OTP.
 *   - `verify` — email (echoed from step 1) + 6-digit code; the server signs the user in.
 *
 * A single `v.variant` lets one `<form>` + one superForm instance cover both steps;
 * the runtime branch on `form.data.step` mirrors the UI branch on `$formData.step`.
 */
export const loginWizardSchema = v.variant('step', [
	v.object({
		step: v.literal('send'),
		email: emailSchema,
		turnstileToken: v.pipe(v.string(), v.minLength(1, 'Please complete the verification'))
	}),
	v.object({
		step: v.literal('verify'),
		email: emailSchema,
		code: otpCodeSchema
	})
]);
export type LoginWizardInput = v.InferInput<typeof loginWizardSchema>;
export type LoginWizardOutput = v.InferOutput<typeof loginWizardSchema>;
