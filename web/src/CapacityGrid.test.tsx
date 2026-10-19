import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CapacityResponse } from './api'
import { CapacityGrid } from './CapacityGrid'

const response: CapacityResponse = {
  from: '2026-01-05',
  to: '2026-01-11',
  weeks: ['2026-01-05'],
  people: [{ id: 4, name: 'Dee Okafor', weeklyHours: 40, allocated: [45], capacity: [40] }],
  total: 1,
  limit: 50,
  offset: 0,
}

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function openEditor() {
  render(<CapacityGrid from="2026-01-05" to="2026-01-11" />)
  fireEvent.click(await screen.findByTitle('Change weekly hours'))
  fireEvent.change(screen.getByLabelText('Weekly hours for Dee Okafor'), { target: { value: '48' } })
}

describe('CapacityGrid editing', () => {
  it('rolls back and offers a retry when a save fails', async () => {
    let rejectSave!: (err: Error) => void
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) =>
        init?.method === 'PATCH' ? new Promise((_, reject) => (rejectSave = reject)) : json(response),
      ),
    )
    await openEditor()
    fireEvent.click(screen.getByText('Save'))

    // Optimistic: the new capacity shows while the save is in flight.
    expect(screen.getByTitle(/45 of 48 h/)).toBeTruthy()

    await act(async () => rejectSave(new TypeError('network down')))

    expect(screen.getByTitle(/45 of 40 h — over by 5 h/)).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain("Couldn't save 48 h")
    expect(screen.getByText('Retry')).toBeTruthy()
  })

  it('refetches after a successful save and shows the server numbers', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return json({ id: 4, name: 'Dee Okafor', weeklyHours: 48 })
      const saved = fetchMock.mock.calls.some(([, i]) => i?.method === 'PATCH')
      return json(saved ? { ...response, people: [{ ...response.people[0], weeklyHours: 48, capacity: [48] }] } : response)
    })
    vi.stubGlobal('fetch', fetchMock)
    await openEditor()
    fireEvent.click(screen.getByText('Save'))

    expect(await screen.findByText(/48 h\/wk/)).toBeTruthy()
    await act(async () => {})
    const gets = fetchMock.mock.calls.filter(([, i]) => i?.method !== 'PATCH')
    expect(gets.length).toBeGreaterThanOrEqual(2)
    expect(screen.getByTitle(/45 of 48 h/)).toBeTruthy()
  })
})
