import type { PageServerLoad } from './$types';

/**
 * Landing-page load. We resolve the primary CTA href server-side so the first
 * paint already renders the correct destination — no auth-state flash when JS
 * hydrates.
 */
export const load: PageServerLoad = async ({ locals }) => {
	return {
		createQuizHref: locals.user ? '/dashboard' : '/login'
	};
};
