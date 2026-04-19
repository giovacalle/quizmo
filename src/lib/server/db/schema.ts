import { relations, sql } from 'drizzle-orm';
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Quiz host. `email` is stored lowercase; the UNIQUE index is over `lower(email)` so
 * casing differences collapse at the DB layer even if the app-side normalization is
 * skipped. `users` is referenced by quizzes (owner) and quiz_sessions (host).
 */
export const users = sqliteTable(
	'users',
	{
		id: text('id').primaryKey(),
		email: text('email').notNull(),
		name: text('name'),
		createdAt: integer('created_at').notNull(),
		quizCountLifetime: integer('quiz_count_lifetime').notNull().default(0)
	},
	(t) => [uniqueIndex('users_email_lower_unique').on(sql`lower(${t.email})`)]
);

/**
 * A quiz template owned by a host. `status` tracks lifecycle:
 *   draft     - being edited, not yet runnable
 *   active    - runnable (counts toward the ≤3 active cap)
 *   archived  - excluded from lifetime cap (see Decisions → archive semantics)
 * `last_active_at` updates on every session start — the nightly cron archives quizzes
 * untouched for > 30 days.
 */
export const quizzes = sqliteTable('quizzes', {
	id: text('id').primaryKey(),
	ownerId: text('owner_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	title: text('title').notNull(),
	description: text('description'),
	status: text('status', { enum: ['draft', 'active', 'archived'] })
		.notNull()
		.default('draft'),
	createdAt: integer('created_at').notNull(),
	lastActiveAt: integer('last_active_at').notNull()
});

/**
 * Question belonging to a quiz. `order` is the 0-based index within the quiz; uniqueness
 * per-quiz is enforced at the app layer + by a unique index so reorder operations stay
 * deterministic. `time_limit_sec` bounds checked in validators (5..120).
 */
export const questions = sqliteTable(
	'questions',
	{
		id: text('id').primaryKey(),
		quizId: text('quiz_id')
			.notNull()
			.references(() => quizzes.id, { onDelete: 'cascade' }),
		order: integer('order').notNull(),
		text: text('text').notNull(),
		timeLimitSec: integer('time_limit_sec').notNull().default(20),
		points: integer('points').notNull().default(1000),
		createdAt: integer('created_at').notNull()
	},
	(t) => [uniqueIndex('questions_quiz_order_unique').on(t.quizId, t.order)]
);

/**
 * One of 2-6 answers per question. `is_correct` is a 0/1 integer boolean (SQLite
 * convention). App validators enforce exactly-one-correct per question.
 */
export const answers = sqliteTable(
	'answers',
	{
		id: text('id').primaryKey(),
		questionId: text('question_id')
			.notNull()
			.references(() => questions.id, { onDelete: 'cascade' }),
		order: integer('order').notNull(),
		text: text('text').notNull(),
		isCorrect: integer('is_correct', { mode: 'boolean' }).notNull().default(false)
	},
	(t) => [uniqueIndex('answers_question_order_unique').on(t.questionId, t.order)]
);

/**
 * Live quiz instance. Named `quiz_sessions` (not `sessions`) to avoid colliding with
 * better-auth's own "session" concept . `code` is the 6-char [A-Z0-9] join code —
 * D1 is the source of truth, KV `code:{CODE}` is a read-through cache.
 */
export const quizSessions = sqliteTable('quiz_sessions', {
	id: text('id').primaryKey(),
	quizId: text('quiz_id')
		.notNull()
		.references(() => quizzes.id, { onDelete: 'cascade' }),
	hostId: text('host_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	code: text('code').notNull().unique(),
	status: text('status', { enum: ['lobby', 'active', 'revealing', 'ended', 'archived'] })
		.notNull()
		.default('lobby'),
	startedAt: integer('started_at'),
	endedAt: integer('ended_at'),
	createdAt: integer('created_at').notNull()
});

/**
 * Participant in a live session. `id` is composite-safe: `${sessionId}:${participantId}`
 * so `INSERT OR REPLACE` from the DO stays idempotent across alarm-driven retries.
 */
export const participants = sqliteTable('participants', {
	id: text('id').primaryKey(),
	sessionId: text('session_id')
		.notNull()
		.references(() => quizSessions.id, { onDelete: 'cascade' }),
	nickname: text('nickname').notNull(),
	score: integer('score').notNull().default(0),
	joinedAt: integer('joined_at').notNull()
});

export const usersRelations = relations(users, ({ many }) => ({
	quizzes: many(quizzes),
	hostedSessions: many(quizSessions)
}));

export const quizzesRelations = relations(quizzes, ({ one, many }) => ({
	owner: one(users, { fields: [quizzes.ownerId], references: [users.id] }),
	questions: many(questions),
	sessions: many(quizSessions)
}));

export const questionsRelations = relations(questions, ({ one, many }) => ({
	quiz: one(quizzes, { fields: [questions.quizId], references: [quizzes.id] }),
	answers: many(answers)
}));

export const answersRelations = relations(answers, ({ one }) => ({
	question: one(questions, { fields: [answers.questionId], references: [questions.id] })
}));

export const quizSessionsRelations = relations(quizSessions, ({ one, many }) => ({
	quiz: one(quizzes, { fields: [quizSessions.quizId], references: [quizzes.id] }),
	host: one(users, { fields: [quizSessions.hostId], references: [users.id] }),
	participants: many(participants)
}));

export const participantsRelations = relations(participants, ({ one }) => ({
	session: one(quizSessions, {
		fields: [participants.sessionId],
		references: [quizSessions.id]
	})
}));
