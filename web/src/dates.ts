// Calendar dates as YYYY-MM-DD strings. All arithmetic happens in UTC so a
// manager west of Greenwich doesn't see every week shifted back a day
// (new Date('2026-01-05') is midnight UTC, which is Sunday evening in the US).

const DAY_MS = 24 * 60 * 60 * 1000

export const MAX_WEEKS = 26 // mirrors the API's cap

function parse(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function format(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && format(parse(value)) === value
}

export function addDays(date: string, days: number): string {
  return format(parse(date) + days * DAY_MS)
}

/** Monday of the ISO week containing date. */
export function mondayOf(date: string): string {
  const dow = new Date(parse(date)).getUTCDay() // 0 = Sunday
  return addDays(date, -((dow + 6) % 7))
}

/** Sunday of the ISO week containing date. */
export function sundayOf(date: string): string {
  return addDays(mondayOf(date), 6)
}

/** Whole weeks between the Monday of from and the Sunday of to. */
export function weeksBetween(from: string, to: string): number {
  return Math.round((parse(sundayOf(to)) - parse(mondayOf(from)) + DAY_MS) / (7 * DAY_MS))
}

/** Today's date in the viewer's own calendar, not UTC. */
export function today(): string {
  const now = new Date()
  return format(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
}

const shortFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** "29 Dec" — for column headers. */
export function shortDate(date: string): string {
  return shortFmt.format(new Date(parse(date)))
}
