export type PersonCapacity = {
  id: number
  name: string
  weeklyHours: number
  allocated: number[] // aligned with CapacityResponse.weeks
  capacity: number[] // aligned with CapacityResponse.weeks
}

export type CapacityResponse = {
  from: string // Monday of the first week
  to: string // Sunday of the last week
  weeks: string[] // Monday of each week
  people: PersonCapacity[]
  total: number
  limit: number
  offset: number
}

export type Person = {
  id: number
  name: string
  weeklyHours: number
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0)
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // not JSON — keep the generic message
    }
    throw new ApiError(message, res.status)
  }
  return (await res.json()) as T
}

export function fetchCapacity(
  params: { from: string; to: string; limit: number; offset: number },
  signal?: AbortSignal,
): Promise<CapacityResponse> {
  const qs = new URLSearchParams({
    from: params.from,
    to: params.to,
    limit: String(params.limit),
    offset: String(params.offset),
  })
  return request(`/api/capacity?${qs}`, { signal })
}

export function updateWeeklyHours(id: number, weeklyHours: number): Promise<Person> {
  return request(`/api/people/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weeklyHours }),
  })
}
