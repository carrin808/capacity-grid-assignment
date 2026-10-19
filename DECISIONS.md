# Decisions

Yours to write, not your AI's. Short is good — bullets are fine, and half a page is
plenty. We read this first.

## What did the spec not tell you?

- What hours_per_day means: I noticed the values looked like fractions, but each assignment is actually stored as 15 rows. When I sum those rows, they produce the real daily hours: 2, 4, 6, or 8. I decided to use the rows as they are rather than deduplicating them.

- Whether weekends count: I decided that only Monday–Friday count toward allocation because weekly capacity is based on a five-day work week.

- What happens with partial weeks: I made the server expand any selected range to complete Monday–Sunday weeks. This keeps weekly allocation comparable to the full weekly capacity.

- How the UI stays correct after saving: I show the new value immediately, then quietly reload the data from the server. I keep the edit separate until the server confirms it, so an older request can't overwrite a newer change, and if the save fails I restore the old value and show a Retry option.

- How it scales: I decided to page people 50 at a time, allow up to 200, and limit each request to 26 weeks. The API only reads assignments that overlap the requested range for the people being returned.

- What over-allocation means with zero capacity: I treat any assigned hours on someone with zero capacity as over-allocation. That avoids dividing by zero and makes the problem visible to the manager.



## What did you notice that looked wrong?

- The assignments initially looked like a broken export because every assignment is split into 15 fractional rows. After summing them, the hours made sense, so I worked with the data instead of changing the seed.

- Some assignments run through weekends, but I excluded Saturday and Sunday because they shouldn't count against a five-day weekly capacity.

- Eli Nakamura has zero weekly capacity but 20 assigned hours in the week of January 5. I left it as-is and showed it as 20 hours over capacity because that's exactly the kind of issue this view should highlight.

- I noticed part-timers are over capacity quite often because the allocations appear to be generated around full-time hours. I didn't change the data because the view should reflect what the actual data contains.

- January 1 is treated as a working day because there is no holiday calendar in the data. I left that behavior unchanged rather than inventing holiday rules.

- Dee has overlapping projects on January 7–9 that add up to 11 hours per day. I kept that because it's the deliberate over-allocation case, showing 45/40, or 5 hours over.



## What did the AI get wrong that you caught?

- When I opened the grid in the browser, I noticed a large empty area underneath it and a second scrollbar. I traced it to hidden accessibility text that had been positioned relative to the whole page instead of the table's scroll area. The tests didn't catch it, so I fixed it by anchoring the text inside the table container.


## What would you do differently with a week?

- I would add an "only over-allocated" filter and sort by the people who are most over capacity. Because the data is paginated, I'd implement this on the server.

- I would account for holidays, time off, and start/end dates when calculating weekly capacity. The API already returns weekly capacity, so I wouldn't need to change the response format.

- For larger scale, I'd precompute each person's weekly hours instead of recalculating them on every request, and I'd render only the rows currently visible.

- I'd add version checks for conflicting edits so the system can tell a manager when someone else changed the same value before them instead of silently using last-write-wins.

- I'd add permissions so managers can only edit people on their own teams.

- I'd add more tests, especially API tests against a real database for weekend and week-boundary behavior, plus a browser test covering the complete edit flow.


