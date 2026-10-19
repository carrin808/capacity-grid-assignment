import { describe, expect, it } from 'vitest'
import type { PersonCapacity } from './api'
import { applyEdits, cellStatus, settleEdits, type Edit } from './capacity'
import { addDays, mondayOf, sundayOf, weeksBetween } from './dates'

const dee: PersonCapacity = { id: 4, name: 'Dee Okafor', weeklyHours: 40, allocated: [0, 45, 40], capacity: [40, 40, 40] }

describe('cellStatus', () => {
  it('flags allocation over capacity', () => {
    expect(cellStatus(45, 40)).toBe('over')
    expect(cellStatus(40, 40)).toBe('full')
    expect(cellStatus(30, 40)).toBe('under')
    expect(cellStatus(0, 40)).toBe('empty')
  })

  it('treats any allocation on zero capacity as over, and none as empty', () => {
    expect(cellStatus(20, 0)).toBe('over')
    expect(cellStatus(0, 0)).toBe('empty')
  })
})

describe('applyEdits', () => {
  it('lays a saving edit over capacity for every week', () => {
    const edits = new Map<number, Edit>([[4, { status: 'saving', hours: 48, previous: 40 }]])
    const [row] = applyEdits([dee], edits)
    expect(row.weeklyHours).toBe(48)
    expect(row.capacity).toEqual([48, 48, 48])
    expect(row.allocated).toEqual(dee.allocated)
  })

  it('shows server numbers again when a save failed', () => {
    const edits = new Map<number, Edit>([[4, { status: 'failed', hours: 48, previous: 40, error: 'boom' }]])
    expect(applyEdits([dee], edits)[0]).toBe(dee)
  })
})

describe('settleEdits', () => {
  it('keeps a saved edit until a fetch started after the save lands', () => {
    const edits = new Map<number, Edit>([[4, { status: 'saved', hours: 48, previous: 40, savedAtFetch: 3 }]])
    expect(settleEdits(edits, 3).has(4)).toBe(true) // in flight before the save finished: may be stale
    expect(settleEdits(edits, 4).has(4)).toBe(false)
  })

  it('never drops saving or failed edits', () => {
    const edits = new Map<number, Edit>([
      [1, { status: 'saving', hours: 1, previous: 0 }],
      [2, { status: 'failed', hours: 1, previous: 0, error: 'x' }],
    ])
    expect(settleEdits(edits, 99).size).toBe(2)
  })
})

describe('dates', () => {
  it('snaps to ISO weeks across a year boundary', () => {
    expect(mondayOf('2026-01-01')).toBe('2025-12-29') // Thursday
    expect(mondayOf('2026-01-04')).toBe('2025-12-29') // Sunday belongs to the previous Monday
    expect(sundayOf('2025-12-29')).toBe('2026-01-04')
    expect(weeksBetween('2025-12-29', '2026-01-16')).toBe(3)
  })

  it('does not drift across DST changes', () => {
    expect(addDays('2026-03-23', 7)).toBe('2026-03-30')
    expect(addDays('2026-10-26', -7)).toBe('2026-10-19')
  })
})
