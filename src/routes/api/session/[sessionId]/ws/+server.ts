/**
 * WebSocket upgrade forwarder for the QuizSession Durable Object.
 *
 * The browser hits `GET /api/session/:sessionId/ws` with an `Upgrade: websocket`
 * header. We resolve the DO stub via `idFromName(sessionId)` (deterministic)
 * and forward the raw Request — the DO itself calls `new WebSocketPair()` +
 * `ctx.acceptWebSocket(server)` inside its `fetch` handler. Doing anything else
 * on this side (calling `new WebSocketPair()` here, proxying messages) would
 * defeat hibernation and charge a Worker invocation per message.
 *
 * Auth / role:
 *   - Participant sockets (default) authenticate via the HMAC participantToken
 *     flow implemented inside the DO (join → reply with token; reconnect →
 *     verify).
 *   - Host sockets pass `?role=host` on the URL. Their commands (`host-*` WS
 *     messages) are gated by the role attachment on the socket inside the DO.
 *     For now we trust the `role=host` param because this route also loads
 *     `locals.user` and can enforce `host_id = locals.user.id` as a cheap
 *     belt+suspenders — see below. The session-start server action mints the
 *     host socket URL server-side so the role query param is not
 *     attacker-surface for the host flow.
 */
import type { RequestHandler } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';

import { db } from '$lib/server/db/client';
import { quizSessions } from '$lib/server/db/schema';
import { guardAppError, throwAppError } from '$lib/server/errors';

export const GET: RequestHandler = async (event) =>
	guardAppError(async () => {
		const { request, params, platform, locals, url } = event;
		if (!platform) return throwAppError('INTERNAL_ERROR', 'Platform bindings missing');

		const sessionId = params.sessionId;
		if (!sessionId) return throwAppError('INVALID_INPUT', 'Missing sessionId');

		if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket')
			return throwAppError('INVALID_INPUT', 'WebSocket upgrade required');

		// Host-role belt+suspenders: if the caller asks for host, they MUST be
		// signed in AND own the session. Participants aren't signed in (Turnstile
		// at /join is their gate) so we don't verify anything for role=participant.
		const role = url.searchParams.get('role') === 'host' ? 'host' : 'participant';
		if (role === 'host') {
			const user = locals.user;
			if (!user) return throwAppError('UNAUTHENTICATED', 'Host must be signed in');
			const session = await db(platform.env.QUIZMO_DB)
				.select({ hostId: quizSessions.hostId })
				.from(quizSessions)
				.where(eq(quizSessions.id, sessionId))
				.get();
			if (!session) return throwAppError('NOT_FOUND', 'Session not found');
			if (session.hostId !== user.id)
				return throwAppError('FORBIDDEN', 'Only the host can open a host socket');
		}

		const id = platform.env.QUIZMO_SESSION.idFromName(sessionId);
		const stub = platform.env.QUIZMO_SESSION.get(id);
		return stub.fetch(request);
	});
