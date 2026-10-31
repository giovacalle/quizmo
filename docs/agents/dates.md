# Date Handling Standards

## Library: `@internationalized/date`

This is the **sole** date/time library for Quizmo. Do NOT add `date-fns`, `dayjs`, `moment`, `luxon`, or any other.

### Why

1. **Cloudflare Workers compatible** — pure JS, zero Node dependencies.
2. **Smallest bundle** (~2.8 kB for Gregorian-only usage).
3. **Zero locale bloat** — uses native `Intl.DateTimeFormat`; no locale files to ship.
4. **Bits-ui / shadcn-svelte ready** — if Calendar / DatePicker / DateField primitives get added later, they'll expect `DateValue` types from this library.
5. **Future-proof** — modeled after the TC39 Temporal proposal.

### Core types

| Type               | Use case                 | Example                                     |
| ------------------ | ------------------------ | ------------------------------------------- |
| `CalendarDate`     | Date without time        | `new CalendarDate(2026, 4, 19)`             |
| `CalendarDateTime` | Date + time, no timezone | `new CalendarDateTime(2026, 4, 19, 12, 30)` |
| `ZonedDateTime`    | Date + time + timezone   | Full TZ-aware datetime                      |
| `DateFormatter`    | Locale-aware formatting  | Wraps `Intl.DateTimeFormat`                 |

> **Month indexing is 1-based** (January = 1), unlike native JS `Date` (January = 0). Don't mix the two conventions.

## Storage — epoch milliseconds

D1 stores dates as **`INTEGER` columns holding epoch milliseconds**. Drizzle's schema defines them as `integer({ mode: 'timestamp_ms' })` or similar (see `src/lib/server/db/schema.ts` for the exact column modes).

For plain timestamp arithmetic, `Date.now()` is fine:

```typescript
// In a server handler or DO
const now = Date.now();
const sevenDaysLater = now + 7 * 24 * 60 * 60 * 1000;
```

For anything beyond simple arithmetic (calendar math, DST-safe shifts, weekday lookups), use `@internationalized/date` — pure JS, works on the Worker.

## Conversion helpers

Quizmo doesn't currently have a dedicated date utils module. When conversion helpers are needed (e.g., bridging a `CalendarDate` from a DatePicker to a D1 timestamp), either inline the conversion at the boundary or factor out into `src/lib/utils/date.ts`:

```typescript
// src/lib/utils/date.ts — create this if/when needed
import { CalendarDate, getLocalTimeZone, today } from '@internationalized/date';

export function timestampToCalendarDate(ms: number): CalendarDate {
	const d = new Date(ms);
	// Months in @internationalized/date are 1-based, JS Date is 0-based.
	return new CalendarDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function calendarDateToTimestamp(cd: CalendarDate): number {
	// Date.UTC also takes 0-based month — convert back.
	return Date.UTC(cd.year, cd.month - 1, cd.day);
}

export function getToday(): CalendarDate {
	return today(getLocalTimeZone());
}
```

**Don't create this file preemptively** — keep the codebase lean until a real need lands.

## Display formatting

Always use `DateFormatter` for user-facing dates. Quizmo is **EN-only**, so the locale is always `'en-US'`:

```typescript
import { DateFormatter } from '@internationalized/date';

const formatter = new DateFormatter('en-US', { dateStyle: 'long' });
const label = formatter.format(new Date(timestamp));
// "April 19, 2026"

const shortFormatter = new DateFormatter('en-US', { dateStyle: 'short', timeStyle: 'short' });
const shortLabel = shortFormatter.format(new Date(timestamp));
// "4/19/26, 2:30 PM"
```

## Date picker integration (future)

When we add a DatePicker primitive (`bunx shadcn-svelte@latest add date-picker`), bind to `CalendarDate` values on the component and convert at the edges:

```svelte
<script lang="ts">
	import type { CalendarDate } from '@internationalized/date';

	import { calendarDateToTimestamp, timestampToCalendarDate } from '$lib/utils/date';

	let { initialMs } = $props<{ initialMs?: number }>();

	let dateValue = $state<CalendarDate | undefined>(
		initialMs ? timestampToCalendarDate(initialMs) : undefined
	);

	// When the form submits:
	const payloadMs = dateValue ? calendarDateToTimestamp(dateValue) : undefined;
</script>
```

## Forbidden patterns

| ❌ Forbidden                                                                      | ✅ Use instead                                      |
| --------------------------------------------------------------------------------- | --------------------------------------------------- |
| `import dayjs from 'dayjs'`                                                       | `@internationalized/date`                           |
| `import { format } from 'date-fns'`                                               | `DateFormatter`                                     |
| `moment(...)`                                                                     | `@internationalized/date`                           |
| `luxon`, `day`, `spacetime`, etc.                                                 | `@internationalized/date`                           |
| `new Date().toLocaleDateString('it-IT')`                                          | `new DateFormatter('en-US', {...}).format(date)`    |
| Hardcoded format strings (`DD/MM/YYYY`)                                           | `DateFormatter` with a style option                 |
| Mixing 0-based (JS `Date`) and 1-based (`CalendarDate`) months without conversion | Convert explicitly at the boundary, one-line helper |
