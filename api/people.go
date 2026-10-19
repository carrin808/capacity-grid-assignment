package main

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"
)

// maxWeeklyHours is a sanity bound, not a policy: 168 is every hour in a week.
const maxWeeklyHours = 168

type person struct {
	ID          int     `json:"id"`
	Name        string  `json:"name"`
	WeeklyHours float64 `json:"weeklyHours"`
}

type updatePersonRequest struct {
	WeeklyHours *float64 `json:"weeklyHours"`
}

// handleUpdatePerson serves PATCH /api/people/{id} with {"weeklyHours": 32}.
//
// It returns the stored person. The grid applies weeklyHours optimistically and
// then refetches the visible range, so the server stays the source of truth for
// per-week capacity rather than the client re-deriving it.
func (s *server) handleUpdatePerson(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid person id")
		return
	}

	var req updatePersonRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "body must be JSON like {\"weeklyHours\": 32}")
		return
	}
	if req.WeeklyHours == nil {
		writeError(w, http.StatusBadRequest, "weeklyHours is required")
		return
	}
	hours := *req.WeeklyHours
	if math.IsNaN(hours) || hours < 0 || hours > maxWeeklyHours {
		writeError(w, http.StatusUnprocessableEntity, "weeklyHours must be between 0 and "+strconv.Itoa(maxWeeklyHours))
		return
	}

	var p person
	err = s.db.QueryRow(r.Context(),
		`UPDATE people SET weekly_hours = $2 WHERE id = $1
		 RETURNING id, name, weekly_hours::float8`,
		id, hours,
	).Scan(&p.ID, &p.Name, &p.WeeklyHours)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "person not found")
		return
	}
	if err != nil {
		internalError(w, "update person", err)
		return
	}

	writeJSON(w, http.StatusOK, p)
}
