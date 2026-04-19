import { redirect } from '@sveltejs/kit';

import type { LayoutServerLoad } from './$types';

/**
 * Dashboard guard. Every nested route under `/dashboard` requires an authenticated
 * host — this single load function is the whole gate (the `handle` hook in
 * `hooks.server.ts` already populates `locals.user` from better-auth).
 */
export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) throw redirect(303, '/login');
	return { user: locals.user };
};
