import type { CapacityResponse, PersonCapacity } from './api'

export type CellStatus = 'empty' | 'under' | 'full' | 'over'

// Allocations are sums of eighths of an hour; the epsilon only guards float noise.
const EPSILON = 0.001

export function cellStatus(allocated: number, capacity: number): CellStatus {
  if (allocated > capacity + EPSILON) return 'over' // includes any allocation on zero capacity
  if (allocated < EPSILON) return 'empty'
  if (allocated >= capacity - EPSILON) return 'full'
  return 'under'
}

export function formatHours(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1)
}

/** A weekly-hours edit the grid is tracking for one person. */
export type Edit =
  | { status: 'saving'; hours: number; previous: number }
  // Saved on the server, shown until a fetch started after the save replaces it.
  | { status: 'saved'; hours: number; previous: number; savedAtFetch: number }
  | { status: 'failed'; hours: number; previous: number; error: string }

/**
 * The rows the manager sees: server data with in-flight and just-saved edits
 * laid over it. Keeping edits separate means a slow fetch that lands mid-save
 * can't overwrite what the manager just typed, and a failed save rolls back by
 * simply not applying.
 *
 * Optimistically, capacity is the new weekly hours for every week. That is the
 * server's rule today; the reconciling refetch replaces it with the server's
 * numbers if the rule ever gets richer (holidays, time off).
 */
export function applyEdits(people: PersonCapacity[], edits: ReadonlyMap<number, Edit>): PersonCapacity[] {
  if (edits.size === 0) return people
  return people.map((p) => {
    const edit = edits.get(p.id)
    if (!edit || edit.status === 'failed') return p
    return { ...p, weeklyHours: edit.hours, capacity: p.capacity.map(() => edit.hours) }
  })
}

/** Drop saved edits that a fetch started after the save has superseded. */
export function settleEdits(edits: ReadonlyMap<number, Edit>, fetchId: number): Map<number, Edit> {
  const next = new Map(edits)
  for (const [id, edit] of edits) {
    if (edit.status === 'saved' && fetchId > edit.savedAtFetch) next.delete(id)
  }
  return next
}

export function overAllocatedCount(data: Pick<CapacityResponse, 'people'>): number {
  return data.people.filter((p) => p.allocated.some((a, i) => cellStatus(a, p.capacity[i]) === 'over')).length
}
