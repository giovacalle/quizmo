import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';

const auth = {
	api: { getSession: vi.fn().mockResolvedValue(null) },
	handler: vi.fn().mockResolvedValue(new Response('better-auth'))
};

vi.mock('$lib/server/auth', () => ({ createAuth: () => auth }));

const { handle } = await import('./hooks.server');

function eventFor(path: string): RequestEvent {
	const url = new URL(`https://quizmo.giova.dev${path}`);
	return {
		url,
		request: new Request(url, { method: 'POST' }),
		platform: { env: {} },
		locals: {}
	} as unknown as RequestEvent;
}

describe('handle', () => {
	it('never exposes better-auth routes over HTTP, so OTP sends cannot skip /login', async () => {
		const resolve = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));

		const res = await handle({
			event: eventFor('/api/auth/email-otp/send-verification-otp'),
			resolve
		});

		expect(auth.handler).not.toHaveBeenCalled();
		expect(resolve).toHaveBeenCalledOnce();
		expect(res.status).toBe(404);
	});
});
