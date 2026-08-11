# Project tracker

A lightweight oversight tool for tracking multiple projects run by team leads —
key stages, meeting notes, todos, and alerts, without duplicating the lead's
own detailed project plan.

## Stack
Node.js, Express, better-sqlite3, EJS. Built to deploy on Railway the same
way as the other PTS Canada apps (connect the GitHub repo, set the PORT
env var if needed — Railway sets it automatically).

## Local development
```
npm install
npm start
```
Visit http://localhost:3000

## Data model
- **projects** — name, outcome, lead, start/end date, status tag, cadence, color, archived flag
- **stages** — key milestones per project, with a target date and status (pending / current / done / blocked)
- **notes** — meeting notes per project, dated, optionally posted to the timeline with a tone (chokepoint / warning / all good)
- **todos** — simple per-project todo list
- **alerts** — dated reminders per project

## How the timeline works
- Stages render as circles on the track, positioned by target date, colored by status.
- Notes only appear on the timeline if "post on timeline" was checked when the note
  was created — everything else stays in the full meeting log.
- Notes within a few percent of the track width of each other cluster into a single
  marker showing a count; hovering (or tabbing to) the cluster spreads it into
  individual diamonds, each with its own note bubble on hover.
- Clicking anywhere on the track (not on a marker) toggles the full chronological
  meeting log open below, including notes that were never posted to the timeline.
