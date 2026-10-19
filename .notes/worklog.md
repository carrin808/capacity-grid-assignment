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

## Web

- Range lives in App (and the URL, so a view can be shared/reloaded); always whole weeks.
  Prev/next shift by one week; From/To date pickers snap to Monday/Sunday and clamp to 26
  weeks with a visible note rather than a silent change. People paging survives range
  changes on purpose — a manager on page 3 moving a week forward stays on page 3.
- Date math is string/UTC-based. `new Date('2026-01-05')` is UTC midnight, which renders as
  Sunday in the Americas — the classic week-off-by-one.
- Loading: skeleton only on first load; afterwards the previous grid stays, dimmed, with a
  "Loading…" pill. Each fetch has an AbortController, so a slow response for an old range
  can't replace a newer one. Fetch errors keep the old grid with a banner + retry and say
  which range is still shown.
- Save strategy: optimistic overlay + reconciling refetch. Edits live in a Map laid over
  the last server response (`applyEdits`), not written into it. That makes rollback "stop
  applying it", and stops a fetch that was in flight during the save from clobbering the
  new value: a saved edit is only dropped once a fetch *started after* the save lands
  (`settleEdits`). The refetch keeps the server authoritative for per-week capacity.
- Failed save: numbers roll back, the row shows what failed, what was kept, Retry/Dismiss.
  Editing a row is disabled while its save is in flight (avoids out-of-order saves for one
  person instead of sequencing them).
- Over-allocation: red cell, bold number, "+N" delta, bar; summary count per page. Zero
  capacity with any allocation is "over" (Eli).
- Tests: status rules, edit overlay/settle, ISO-week + DST date math, and a component test
  for the failed-save rollback and the post-save refetch.

## Verification against the running API (port 18080 — 8080 was taken by another local project)

- Default range returns Ana 40/0/30, Bo 0/32/8, Cem 0/4/12 of 20, Dee 0/45/40, Eli 0/20/0 of 0 —
  matches the hand-computed numbers. Bad ranges, >26 weeks, bad limit → 400 with a message.
- PATCH: 200 returns stored person; -1 → 422; non-number, `{}`, unknown field → 400;
  unknown id → 404. Restored Cem to 20 afterwards.
- 26 weeks × 200 people: ~0.7s cold. Fine for now; see deferred.
- Noticed: allocations never exceed 40h/week for anyone but Dee, so the seed looks generated
  for full-timers. Part-timers (20/24/32h) are over in ~20–40% of their weeks across the
  whole history. Left as-is: it's what the data says, and exactly what the view is for.
- Names include RTL (Hebrew/Arabic), CJK, Greek, Cyrillic and long multi-part names; name cell
  uses dir="auto" and wraps. Sort is by name then id (DB collation); no locale-aware sort.

## Deferred

- Filter/sort "over-allocated first" server-side (needs the aggregate in the paging query).
- Virtualised rows instead of 50-row pages; keyset pagination.
- Holidays / time off / start-end dates in capacity (the per-week `capacity` array is where).
- Pre-aggregated weekly allocation (materialised per person-week) if 2y × thousands is hot.
- Concurrency: last write wins on weekly_hours; no version/ETag.
- No auth/authorisation on PATCH.

## Caught while looking at the running grid

- Page had a huge empty area below the grid and a second scrollbar. Cause: each cell's
  `.sr-only` label is `position: absolute` with no positioned ancestor, so 50 rows of them
  were laid out against the page, outside the scroll box. Fixed by making `.grid-scroll` the
  containing block. Also fitted the grid to its columns/viewport so only the grid scrolls.
- On Windows, Docker bind mounts don't forward file events, so Vite didn't hot-reload CSS
  changes; restarting the web container picked them up.
