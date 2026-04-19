<script lang="ts">
	import { toast } from 'svelte-sonner';

	import * as Button from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
</script>

<div class="bg-background text-foreground min-h-screen px-6 py-12">
	<div class="mx-auto max-w-2xl space-y-6">
		<header class="space-y-2">
			<h1 class="text-3xl font-semibold">Quizmo</h1>
			<p class="text-muted-foreground">Host live quizzes in seconds.</p>
		</header>

		<Card.Root>
			<Card.Header>
				<Card.Title>Design tokens preview</Card.Title>
				<Card.Description>
					Semantic tokens resolving via Tailwind v4 and shadcn-svelte primitives.
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				<p class="text-muted-foreground text-sm">
					This card renders via the Card primitive namespace. Muted text keeps a WCAG-AA contrast
					in both light and dark surfaces.
				</p>
				<div class="flex flex-wrap gap-2">
					<Button.Root onclick={() => toast.success('Tokens are wired correctly')}>
						Test toast
					</Button.Root>
					<Button.Root variant="outline">Outline</Button.Root>
					<Button.Root variant="secondary">Secondary</Button.Root>
					<Button.Root variant="ghost">Ghost</Button.Root>
					<Button.Root variant="destructive">Destructive</Button.Root>
				</div>
			</Card.Content>
		</Card.Root>
	</div>
</div>
