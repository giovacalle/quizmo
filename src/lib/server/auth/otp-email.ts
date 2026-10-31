import { AppError } from '$lib/server/errors';

export type OtpEmailPayload = {
	email: string;
	otp: string;
	type: string;
};

/**
 * Delivers a better-auth OTP through the Cloudflare Email Sending binding
 * (`EMAIL` in wrangler.jsonc). Binding failures throw an `Error` with a `.code`
 * such as `E_RATE_LIMIT_EXCEEDED` or `E_RECIPIENT_SUPPRESSED`; we log it for ops
 * visibility and surface a generic AppError — the client just sees "Could not
 * send code".
 */
export async function sendOtpEmail(
	mailer: SendEmail,
	from: string,
	{ email, otp, type }: OtpEmailPayload
): Promise<void> {
	// Only the "sign-in" flow is wired. If a plugin emits a different type
	// (email-verification / forget-password), we still send the code but keep
	// the subject generic.
	const subject = type === 'sign-in' ? 'Your Quizmo sign-in code' : 'Your Quizmo verification code';
	try {
		await mailer.send({
			// Display name so the inbox preview shows "Quizmo" instead of the bare
			// "noreply@..." address.
			from: { email: from, name: 'Quizmo' },
			to: email.trim().toLowerCase(),
			subject,
			text: renderPlainText(otp),
			html: renderHtml(otp)
		});
	} catch (e) {
		console.error('[email-error]', e);
		throw new AppError('INTERNAL_ERROR', 'Could not send code');
	}
}

function renderPlainText(otp: string): string {
	return [
		'Your Quizmo sign-in code:',
		'',
		otp,
		'',
		'This code expires in 10 minutes and can only be used once.',
		'If you did not request this code, you can safely ignore this email.'
	].join('\n');
}

function renderHtml(otp: string): string {
	// Inline styles only — email clients strip <style> blocks unpredictably. Tokens
	// kept simple (neutral grays + indigo accent) so it renders across clients.
	return `<!doctype html>
<html>
	<body style="font-family: ui-sans-serif, system-ui, sans-serif; background: #f3f4f6; margin: 0; padding: 24px;">
		<table role="presentation" cellpadding="0" cellspacing="0" style="max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 32px; border: 1px solid #e5e7eb;">
			<tr>
				<td>
					<h1 style="margin: 0 0 12px; font-size: 20px; color: #111827;">Your Quizmo sign-in code</h1>
					<p style="margin: 0 0 24px; color: #4b5563; line-height: 1.5;">Paste this code on the sign-in page. It expires in 10 minutes and can only be used once.</p>
					<div style="font-size: 28px; font-weight: 700; letter-spacing: 0.25em; color: #4f46e5; padding: 16px 0; text-align: center; background: #eef2ff; border-radius: 8px;">${otp}</div>
					<p style="margin: 24px 0 0; color: #6b7280; font-size: 12px;">If you did not request this code, you can safely ignore this email.</p>
				</td>
			</tr>
		</table>
	</body>
</html>`;
}
