package main

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"time"
)

const (
	dateLayout = "2006-01-02"
	// maxWeeks bounds one request. A two-year range for a few thousand people is
	// a few hundred thousand cells; the grid pages through people and weeks instead.
	maxWeeks        = 26
	defaultPageSize = 50
	maxPageSize     = 200
)

type capacityResponse struct {
	From   string           `json:"from"`  // Monday of the first week
	To     string           `json:"to"`    // Sunday of the last week
	Weeks  []string         `json:"weeks"` // Monday of each week, ascending
	People []personCapacity `json:"people"`
	Total  int              `json:"total"` // people in the roster, for paging
	Limit  int              `json:"limit"`
	Offset int              `json:"offset"`
}

type personCapacity struct {
	ID          int       `json:"id"`
	Name        string    `json:"name"`
	WeeklyHours float64   `json:"weeklyHours"`
	Allocated   []float64 `json:"allocated"` // aligned with Weeks
	Capacity    []float64 `json:"capacity"`  // aligned with Weeks
}

// capacityQuery returns one row per (person, week) for a page of people.
//
// Allocation rules (see .notes/worklog.md):
//   - assignment rows are summed as-is; the seed stores each logical assignment
//     as several rows that add up to its daily hours.
//   - only Monday–Friday count; many assignments run through the weekend.
//   - assignments are clipped to the requested range before expanding to days,
//     and only assignments overlapping the range are read.
const capacityQuery = `
WITH page AS (
  SELECT id, name, weekly_hours
  FROM people
  ORDER BY name, id
  LIMIT $3 OFFSET $4
),
weeks AS (
  SELECT generate_series($1::date, $2::date, interval '1 week')::date AS week_start
),
alloc AS (
  SELECT a.person_id,
         date_trunc('week', d)::date AS week_start,
         sum(a.hours_per_day)        AS hours
  FROM assignments a
  JOIN page p ON p.id = a.person_id
  CROSS JOIN LATERAL generate_series(
    greatest(a.start_date, $1::date),
    least(a.end_date, $2::date),
    interval '1 day'
  ) AS d
  WHERE a.start_date <= $2::date
    AND a.end_date   >= $1::date
    AND extract(isodow FROM d) < 6
  GROUP BY 1, 2
)
SELECT p.id, p.name, p.weekly_hours::float8, w.week_start, coalesce(al.hours, 0)::float8
FROM page p
CROSS JOIN weeks w
LEFT JOIN alloc al ON al.person_id = p.id AND al.week_start = w.week_start
ORDER BY p.name, p.id, w.week_start`

// handleCapacity serves GET /api/capacity?from=YYYY-MM-DD&to=YYYY-MM-DD[&limit=&offset=]
//
// The range is widened to whole ISO weeks (Monday–Sunday) so every column is a
// full week and capacity per week is comparable with allocation per week.
func (s *server) handleCapacity(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	from, to, err := parseRange(q.Get("from"), q.Get("to"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	limit, err := parseIntParam(q.Get("limit"), defaultPageSize, 1, maxPageSize)
	if err != nil {
		writeError(w, http.StatusBadRequest, "limit: "+err.Error())
		return
	}
	offset, err := parseIntParam(q.Get("offset"), 0, 0, 1<<31-1)
	if err != nil {
		writeError(w, http.StatusBadRequest, "offset: "+err.Error())
		return
	}

	ctx := r.Context()
	resp := capacityResponse{
		From:   from.Format(dateLayout),
		To:     to.Format(dateLayout),
		Weeks:  []string{},
		People: []personCapacity{},
		Limit:  limit,
		Offset: offset,
	}
	for d := from; !d.After(to); d = d.AddDate(0, 0, 7) {
		resp.Weeks = append(resp.Weeks, d.Format(dateLayout))
	}

	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM people`).Scan(&resp.Total); err != nil {
		internalError(w, "count people", err)
		return
	}

	rows, err := s.db.Query(ctx, capacityQuery, from, to, limit, offset)
	if err != nil {
		internalError(w, "capacity query", err)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var (
			id                 int
			name               string
			weeklyHours, hours float64
			weekStart          time.Time
		)
		if err := rows.Scan(&id, &name, &weeklyHours, &weekStart, &hours); err != nil {
			internalError(w, "scan capacity", err)
			return
		}
		n := len(resp.People)
		if n == 0 || resp.People[n-1].ID != id {
			resp.People = append(resp.People, personCapacity{
				ID:          id,
				Name:        name,
				WeeklyHours: weeklyHours,
				Allocated:   make([]float64, 0, len(resp.Weeks)),
				Capacity:    make([]float64, 0, len(resp.Weeks)),
			})
			n++
		}
		p := &resp.People[n-1]
		p.Allocated = append(p.Allocated, hours)
		// Capacity is the contracted week for now. Holidays, time off and
		// start/end dates would land here, which is why it is per week.
		p.Capacity = append(p.Capacity, weeklyHours)
	}
	if err := rows.Err(); err != nil {
		internalError(w, "read capacity", err)
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

// parseRange parses from/to and snaps them to the Monday and Sunday of their weeks.
func parseRange(rawFrom, rawTo string) (time.Time, time.Time, error) {
	if rawFrom == "" || rawTo == "" {
		return time.Time{}, time.Time{}, errors.New("from and to are required (YYYY-MM-DD)")
	}
	from, err := time.Parse(dateLayout, rawFrom)
	if err != nil {
		return time.Time{}, time.Time{}, errors.New("from must be YYYY-MM-DD")
	}
	to, err := time.Parse(dateLayout, rawTo)
	if err != nil {
		return time.Time{}, time.Time{}, errors.New("to must be YYYY-MM-DD")
	}
	if to.Before(from) {
		return time.Time{}, time.Time{}, errors.New("to must not be before from")
	}
	from = weekStart(from)
	to = weekStart(to).AddDate(0, 0, 6)
	if weeks := int(to.Sub(from).Hours()/24+1) / 7; weeks > maxWeeks {
		return time.Time{}, time.Time{}, errors.New("range is longer than " + strconv.Itoa(maxWeeks) + " weeks")
	}
	return from, to, nil
}

// weekStart returns the Monday of t's ISO week. t is a UTC date.
func weekStart(t time.Time) time.Time {
	offset := (int(t.Weekday()) + 6) % 7 // Monday=0 … Sunday=6
	return t.AddDate(0, 0, -offset)
}

func parseIntParam(raw string, def, min, max int) (int, error) {
	if raw == "" {
		return def, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < min || n > max {
		return 0, errors.New("must be an integer between " + strconv.Itoa(min) + " and " + strconv.Itoa(max))
	}
	return n, nil
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// internalError logs the cause and returns a generic message; SQL errors are
// not something to show a manager.
func internalError(w http.ResponseWriter, what string, err error) {
	log.Printf("%s: %v", what, err)
	writeError(w, http.StatusInternalServerError, "something went wrong on our side")
}
