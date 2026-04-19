import { createInsertSchema, createSelectSchema } from 'drizzle-valibot';
import * as v from 'valibot';

import { answers, participants, questions, quizSessions, quizzes, users } from './schema';

// -- Base drizzle-valibot schemas ---------------------------------------------
// These mirror the DB columns. Refinements below layer business rules that the
// schema types can't encode (length bounds, cross-field checks, normalizations).

export const userInsertBaseSchema = createInsertSchema(users);
export const userSelectSchema = createSelectSchema(users);
export const quizInsertBaseSchema = createInsertSchema(quizzes);
export const quizSelectSchema = createSelectSchema(quizzes);
export const questionInsertBaseSchema = createInsertSchema(questions);
export const questionSelectSchema = createSelectSchema(questions);
export const answerInsertBaseSchema = createInsertSchema(answers);
export const answerSelectSchema = createSelectSchema(answers);
export const quizSessionInsertBaseSchema = createInsertSchema(quizSessions);
export const quizSessionSelectSchema = createSelectSchema(quizSessions);
export const participantInsertBaseSchema = createInsertSchema(participants);
export const participantSelectSchema = createSelectSchema(participants);

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
 * deferred (see future hardening).
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
 * form  via SvelteKit form actions's Valibot adapter.
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
 * is verified server-side before rate-limit checks (see auth/rate-limit).
 */
export const loginEmailSchema = v.object({
	email: emailSchema,
	turnstileToken: v.pipe(v.string(), v.minLength(1, 'Turnstile token required'))
});

/** OTP code submitted in the second step of the login flow. */
export const otpCodeSchema = v.pipe(
	v.string(),
	v.trim(),
	v.regex(/^\d{6}$/, 'Code must be 6 digits')
);

/** Join flow payload: code + nickname + Turnstile. */
export const joinSchema = v.object({
	code: joinCodeSchema,
	nickname: nicknameSchema,
	turnstileToken: v.pipe(v.string(), v.minLength(1, 'Turnstile token required'))
});
