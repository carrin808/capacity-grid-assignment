import { useEffect, useState } from 'react'
import { CapacityGrid } from './CapacityGrid'
import { addDays, isDate, MAX_WEEKS, mondayOf, sundayOf, today, weeksBetween } from './dates'

// The default range covers the weeks the seed's hand-written cases fall in.
const DEFAULT_FROM = '2025-12-29'
const DEFAULT_TO = '2026-01-18'

type Range = { from: string; to: string } // Monday … Sunday

function initialRange(): Range {
  const qs = new URLSearchParams(window.location.search)
  const from = qs.get('from') ?? ''
  const to = qs.get('to') ?? ''
  if (isDate(from) && isDate(to) && from <= to && weeksBetween(from, to) <= MAX_WEEKS) {
    return { from: mondayOf(from), to: sundayOf(to) }
  }
  return { from: DEFAULT_FROM, to: DEFAULT_TO }
}

export function App() {
  const [range, setRange] = useState(initialRange)
  const [note, setNote] = useState<string | null>(null)

  // Keep the range in the URL so a manager can share or reload the view.
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search)
    qs.set('from', range.from)
    qs.set('to', range.to)
    window.history.replaceState(null, '', `?${qs}`)
  }, [range])

  const weeks = weeksBetween(range.from, range.to)

  function shift(days: number) {
    setNote(null)
    setRange((r) => ({ from: addDays(r.from, days), to: addDays(r.to, days) }))
  }

  function goToThisWeek() {
    setNote(null)
    const from = mondayOf(today())
    setRange({ from, to: addDays(from, weeks * 7 - 1) })
  }

  function setFrom(value: string) {
    if (!isDate(value)) return
    const from = mondayOf(value)
    let to = range.to < from ? sundayOf(from) : range.to
    if (weeksBetween(from, to) > MAX_WEEKS) {
      to = addDays(from, MAX_WEEKS * 7 - 1)
      setNote(`Showing at most ${MAX_WEEKS} weeks at a time, so the end moved to ${to}.`)
    } else setNote(null)
    setRange({ from, to })
  }

  function setTo(value: string) {
    if (!isDate(value)) return
    const to = sundayOf(value)
    let from = range.from > to ? mondayOf(to) : range.from
    if (weeksBetween(from, to) > MAX_WEEKS) {
      from = addDays(to, -(MAX_WEEKS * 7 - 1))
      setNote(`Showing at most ${MAX_WEEKS} weeks at a time, so the start moved to ${from}.`)
    } else setNote(null)
    setRange({ from, to })
  }

  return (
    <main>
      <h1>Team capacity</h1>
      <div className="controls">
        <button onClick={() => shift(-7)} aria-label="Previous week">
          ‹ Week
        </button>
        <button onClick={goToThisWeek}>This week</button>
        <button onClick={() => shift(7)} aria-label="Next week">
          Week ›
        </button>
        <label>
          From <input type="date" value={range.from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To <input type="date" value={range.to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <span className="range">
          {weeks} week{weeks === 1 ? '' : 's'}, Monday {range.from} to Sunday {range.to}
        </span>
      </div>
      {note && <p className="note">{note}</p>}
      <CapacityGrid from={range.from} to={range.to} />
    </main>
  )
}
