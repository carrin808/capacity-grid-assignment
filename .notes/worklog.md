# Worklog

Running notes on how this got built — decisions, assumptions, dead ends, and anything
left unfinished. Append as you go; a line or two per entry is right.

---

## Data findings (before writing code)

- `hours_per_day` values are 0.125–1.0, which first reads as "fraction of a day". It isn't:
  every logical assignment is stored as 15 identical rows (same person/project/dates),
  14 at x and one at 2x, summing to 16x = 2/4/6/8 h/day. Checked: 8413 groups × 15 = all
  126195 rows. Decision: SUM rows as-is. Deduping (DISTINCT) or treating values as
  fractions both make nobody look over-allocated.
- Many assignments end on Sat/Sun (Ana: Mon–Sun at 8h/day). Counting calendar days gives
  her 56h on a 40h week. Decision: only Mon–Fri count. No holiday calendar (Jan 1 counts).
- Eli Nakamura has `weekly_hours = 0` but 20h allocated in the week of 2026-01-05.
  Must render as over-allocated without dividing by zero.
- Planted cases in the default range, verified by hand in psql:
  Ana 40/0/30, Bo 32/8 (Fri–Mon assignment splits across weeks), Cem 4/12 of 20,
  Dee 45/40 (two overlapping projects = 11h/day on Jan 7–9), Eli 20 of 0.

## API

- Range is snapped to whole ISO weeks (Mon–Sun) server-side; partial weeks would make
  allocation vs. weekly capacity incomparable. Response echoes the snapped range.
- Scale (thousands of people, 2y history): people are paged (`limit`/`offset`, default 50,
  max 200) and the range is capped at 26 weeks. Query only expands assignments that
  overlap the range and belong to the current page, clipped to the range before
  generate_series. Offset paging is fine at this size; keyset if rosters grow.
- Response: `weeks[]` plus per-person `allocated[]`/`capacity[]` aligned to it. Capacity is
  per week (today = weekly_hours) so holidays/time-off can land there later without a
  shape change.
- PATCH returns the stored person; 422 for out-of-range hours (0–168), 404 for unknown id.
  Errors are JSON `{error}`; 500s log the cause and return a generic message.
