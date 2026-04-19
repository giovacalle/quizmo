import type { LayoutServerLoad } from './$types';

/**
 * Root layout server load. Exposes `locals.user` to every page as `data.user` so
 * client-side code (e.g. `AuthContext`, the landing CTA) can branch on auth state
 * without re-parsing cookies. `TURNSTILE_SITE_KEY` is also surfaced here because
 * the `/login` page needs it to render the widget and `$env/static/public` isn't
 * populated when the site key is held in `platform.env`.
 */
export const load: LayoutServerLoad = async ({ locals, platform }) => {
	const env = platform?.env as { TURNSTILE_SITE_KEY?: string } | undefined;
	return {
		user: locals.user,
		turnstileSiteKey: env?.TURNSTILE_SITE_KEY ?? ''
	};
};
