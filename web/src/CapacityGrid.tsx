import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { ApiError, fetchCapacity, updateWeeklyHours, type CapacityResponse, type PersonCapacity } from './api'
import { applyEdits, cellStatus, formatHours, overAllocatedCount, settleEdits, type Edit } from './capacity'
import { shortDate } from './dates'

type Props = {
  from: string
  to: string
}

const PAGE_SIZE = 50
const MAX_WEEKLY_HOURS = 168 // mirrors the API's bound

function errorMessage(err: unknown): string {
  return err instanceof ApiError || err instanceof Error ? err.message : 'Something went wrong.'
}

// CapacityGrid renders one row per person and one column per week, showing
// how allocated each person is and making over-allocation obvious.
//
// Data flow: the last good server response lives in `data`; weekly-hours edits
// live in `edits` and are laid over it (see applyEdits). A save applies
// optimistically, then refetches the visible page so the server has the last
// word. A failed save rolls back and stays visible on the row with a retry.
export function CapacityGrid({ from, to }: Props) {
  const [offset, setOffset] = useState(0)
  const [reloadKey, setReloadKey] = useState(0)
  const [data, setData] = useState<CapacityResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [edits, setEdits] = useState<Map<number, Edit>>(new Map())
  const [editing, setEditing] = useState<{ id: number; draft: string; invalid?: string } | null>(null)
  const fetchSeq = useRef(0)

  useEffect(() => {
    const ctrl = new AbortController()
    const fetchId = ++fetchSeq.current
    setLoading(true)
    fetchCapacity({ from, to, limit: PAGE_SIZE, offset }, ctrl.signal)
      .then((res) => {
        setData(res)
        setLoadError(null)
        setEdits((current) => settleEdits(current, fetchId))
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return
        setLoadError(errorMessage(err))
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })
    // Navigating again before this lands cancels it, so a slow response for an
    // old range can never replace a newer one.
    return () => ctrl.abort()
  }, [from, to, offset, reloadKey])

  const people = useMemo(() => (data ? applyEdits(data.people, edits) : []), [data, edits])
  const overCount = useMemo(() => overAllocatedCount({ people }), [people])

  async function save(person: PersonCapacity, hours: number) {
    const existing = edits.get(person.id)
    // Roll back to what the server last confirmed, not to a failed attempt.
    const previous = existing ? existing.previous : person.weeklyHours
    setEdits((m) => new Map(m).set(person.id, { status: 'saving', hours, previous }))
    try {
      const saved = await updateWeeklyHours(person.id, hours)
      setEdits((m) =>
        new Map(m).set(person.id, {
          status: 'saved',
          hours: saved.weeklyHours,
          previous,
          savedAtFetch: fetchSeq.current,
        }),
      )
      setReloadKey((k) => k + 1)
    } catch (err) {
      setEdits((m) => new Map(m).set(person.id, { status: 'failed', hours, previous, error: errorMessage(err) }))
    }
  }

  function dismiss(id: number) {
    setEdits((m) => {
      const next = new Map(m)
      next.delete(id)
      return next
    })
  }

  function submitEdit(e: FormEvent, person: PersonCapacity) {
    e.preventDefault()
    if (!editing) return
    const hours = Number(editing.draft)
    if (editing.draft.trim() === '' || !Number.isFinite(hours) || hours < 0 || hours > MAX_WEEKLY_HOURS) {
      setEditing({ ...editing, invalid: `Enter hours between 0 and ${MAX_WEEKLY_HOURS}.` })
      return
    }
    setEditing(null)
    if (hours !== person.weeklyHours) void save(person, hours)
  }

  function onEditKey(e: KeyboardEvent) {
    if (e.key === 'Escape') setEditing(null)
  }

  if (!data) {
    if (loadError) {
      return (
        <div className="notice error" role="alert">
          <p>Couldn't load capacity: {loadError}</p>
          <button onClick={() => setReloadKey((k) => k + 1)}>Try again</button>
        </div>
      )
    }
    return <GridSkeleton />
  }

  const first = data.total === 0 ? 0 : data.offset + 1
  const last = data.offset + data.people.length
  const showingOtherRange = data.from !== from || data.to !== to

  return (
    <section aria-busy={loading}>
      <div className="grid-bar">
        <p className="summary" aria-live="polite">
          {overCount > 0 ? (
            <strong className="over-text">
              {overCount} of {data.people.length} over-allocated
            </strong>
          ) : (
            <span>Nobody on this page is over-allocated</span>
          )}
          {loading && <span className="pill">Loading…</span>}
        </p>
        <Legend />
      </div>

      {loadError && (
        <div className="notice error" role="alert">
          <span>
            Couldn't refresh: {loadError}
            {showingOtherRange && ` Still showing ${data.from} to ${data.to}.`}
          </span>
          <button onClick={() => setReloadKey((k) => k + 1)}>Try again</button>
        </div>
      )}

      <div className={`grid-scroll${loading ? ' stale' : ''}`}>
        <table className="grid">
          <thead>
            <tr>
              <th scope="col" className="person-col">
                Person <span className="muted">· hours/week</span>
              </th>
              {data.weeks.map((w) => (
                <th scope="col" key={w} title={`Week of ${w}`}>
                  {shortDate(w)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.length === 0 && (
              <tr>
                <td colSpan={data.weeks.length + 1} className="muted">
                  No people on this page.
                </td>
              </tr>
            )}
            {people.map((p) => {
              const edit = edits.get(p.id)
              const isEditing = editing?.id === p.id
              return (
                <tr key={p.id}>
                  <th scope="row" className="person-col">
                    <div className="person-name" dir="auto">
                      {p.name}
                    </div>
                    {isEditing ? (
                      <form className="hours-form" onSubmit={(e) => submitEdit(e, p)}>
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={MAX_WEEKLY_HOURS}
                          step={0.5}
                          autoFocus
                          aria-label={`Weekly hours for ${p.name}`}
                          aria-invalid={!!editing.invalid}
                          value={editing.draft}
                          onChange={(e) => setEditing({ id: p.id, draft: e.target.value })}
                          onKeyDown={onEditKey}
                        />
                        <button type="submit">Save</button>
                        <button type="button" onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                        {editing.invalid && <div className="field-error">{editing.invalid}</div>}
                      </form>
                    ) : (
                      <button
                        className="hours-button"
                        disabled={edit?.status === 'saving'}
                        onClick={() => setEditing({ id: p.id, draft: String(p.weeklyHours) })}
                        title="Change weekly hours"
                      >
                        {formatHours(p.weeklyHours)} h/wk
                        {edit?.status === 'saving' ? <span className="muted"> · saving…</span> : <span aria-hidden> ✎</span>}
                      </button>
                    )}
                    {edit?.status === 'failed' && (
                      <div className="row-error" role="alert">
                        Couldn't save {formatHours(edit.hours)} h: {edit.error} Kept {formatHours(edit.previous)} h.
                        <button onClick={() => void save(p, edit.hours)}>Retry</button>
                        <button onClick={() => dismiss(p.id)}>Dismiss</button>
                      </div>
                    )}
                  </th>
                  {p.allocated.map((allocated, i) => (
                    <Cell key={data.weeks[i]} allocated={allocated} capacity={p.capacity[i]} pending={edit?.status === 'saving'} />
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <nav className="pager" aria-label="People pages">
        <button disabled={data.offset === 0 || loading} onClick={() => setOffset(Math.max(0, data.offset - PAGE_SIZE))}>
          ‹ Previous people
        </button>
        <span>
          {first}–{last} of {data.total}
        </span>
        <button disabled={last >= data.total || loading} onClick={() => setOffset(data.offset + PAGE_SIZE)}>
          Next people ›
        </button>
      </nav>
    </section>
  )
}

function Cell({ allocated, capacity, pending }: { allocated: number; capacity: number; pending: boolean }) {
  const status = cellStatus(allocated, capacity)
  const pct = capacity > 0 ? Math.min(allocated / capacity, 1) : allocated > 0 ? 1 : 0
  const label =
    status === 'over'
      ? `${formatHours(allocated)} of ${formatHours(capacity)} h — over by ${formatHours(allocated - capacity)} h`
      : `${formatHours(allocated)} of ${formatHours(capacity)} h`
  return (
    <td className={`cell ${status}${pending ? ' pending' : ''}`} title={label}>
      <span className="alloc">{formatHours(allocated)}</span>
      <span className="cap"> / {formatHours(capacity)}</span>
      {status === 'over' && <span className="delta"> +{formatHours(allocated - capacity)}</span>}
      <span className="bar" aria-hidden>
        <span style={{ width: `${pct * 100}%` }} />
      </span>
      <span className="sr-only">{label}</span>
    </td>
  )
}

function Legend() {
  return (
    <ul className="legend" aria-label="Legend">
      <li>
        <span className="swatch over" /> Over capacity
      </li>
      <li>
        <span className="swatch full" /> Fully booked
      </li>
      <li>
        <span className="swatch under" /> Has room
      </li>
      <li>
        <span className="swatch empty" /> Nothing allocated
      </li>
    </ul>
  )
}

function GridSkeleton() {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading capacity">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="skeleton-row" />
      ))}
    </div>
  )
}
