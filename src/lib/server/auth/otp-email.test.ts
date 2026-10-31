import { describe, expect, it, vi } from 'vitest';

import { AppError } from '$lib/server/errors';

import { sendOtpEmail } from './otp-email';

const FROM = 'noreply@emails.giova.dev';

function fakeMailer(send: SendEmail['send']): SendEmail {
	return { send } as SendEmail;
}

describe('sendOtpEmail', () => {
	it('sends the code from the Quizmo sender to the lowercased recipient', async () => {
		const send = vi.fn().mockResolvedValue({ messageId: 'm1' });

		await sendOtpEmail(fakeMailer(send), FROM, {
			email: ' Host@Example.com ',
			otp: '123456',
			type: 'sign-in'
		});

		expect(send).toHaveBeenCalledOnce();
		const message = send.mock.calls[0]?.[0];
		expect(message).toMatchObject({
			from: { email: FROM, name: 'Quizmo' },
			to: 'host@example.com',
			subject: 'Your Quizmo sign-in code'
		});
		expect(message.text).toContain('123456');
		expect(message.html).toContain('123456');
	});

	it('uses a generic subject for non sign-in flows', async () => {
		const send = vi.fn().mockResolvedValue({ messageId: 'm1' });

		await sendOtpEmail(fakeMailer(send), FROM, {
			email: 'a@b.co',
			otp: '000000',
			type: 'email-verification'
		});

		expect(send.mock.calls[0]?.[0].subject).toBe('Your Quizmo verification code');
	});

	it('maps a binding failure to AppError INTERNAL_ERROR', async () => {
		const failure = Object.assign(new Error('rate limited'), { code: 'E_RATE_LIMIT_EXCEEDED' });
		const send = vi.fn().mockRejectedValue(failure);
		vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = sendOtpEmail(fakeMailer(send), FROM, {
			email: 'a@b.co',
			otp: '1',
			type: 'sign-in'
		});

		await expect(result).rejects.toBeInstanceOf(AppError);
		await expect(result).rejects.toMatchObject({
			code: 'INTERNAL_ERROR',
			message: 'Could not send code'
		});
	});
});
