import { DurableObject } from 'cloudflare:workers';

/**
 * Placeholder class so the wrangler migrations entry + binding resolve.
 * Real state machine (start, join, submitAnswer, reveal, advance, end, alarm,
 * WebSocket hibernation, storage write-through) is DO placeholder — real class pending.
 */
export class QuizSession extends DurableObject<Env> {
	override async fetch(_request: Request): Promise<Response> {
		return new Response('QuizSession DO — not yet implemented ', { status: 501 });
	}
}
