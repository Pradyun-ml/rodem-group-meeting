# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Group meeting scheduler for a PhD research group. Static frontend on GitHub Pages talks to a Google Sheets backend via Google Apps Script. No build tools, no npm — just vanilla HTML/CSS/JS.

## Architecture

**Frontend** (`index.html`, `js/`, `css/`): Alpine.js for reactivity, Pico CSS for styling. Single-page app with modals for volunteer/opt-out/swap/random-assign/poll actions, plus an archive section and organizer tools.

**Backend** (`apps-script/Code.gs`): Google Apps Script deployed as a Web App. `doGet` returns schedule/members/opt-outs/archive/poll/indico data as JSON. `doPost` dispatches actions with `LockService` for concurrency. Post-lock Slack notifications are sent after each successful action (never inside the lock window). Three time-driven triggers: `checkSaturdayCancellation` (Saturday midnight), `sendThursdayReminder` (Thursday 9 AM, channel announcement), `sendPresenterReminder` (Thursday 9 AM, DM 11 days ahead).

**Data flow**: Frontend → `API.post(action, payload)` → Apps Script → Google Sheets (6 tabs: Schedule, Members, OptOuts, Log, PollResponses, Archive).

**Offline fallback**: If `APPS_SCRIPT_URL` is empty or the backend is unreachable, the app runs from `CONFIG.DEFAULT_SCHEDULE` in memory. Forms apply changes locally.

## How It Works (Plain English)

Every Monday at 3 PM, one person from the 11-member group presents. This website decides who presents when and lets people make changes throughout the semester. The Google Sheet is the database; the website is the interface on top.

### Step 0: Before the semester — everyone fills in the poll

Each member clicks **"Semester Poll"** on the website and:
1. Selects their name
2. Checks boxes for Mondays they **cannot** present (e.g. "I'm at a conference Apr 13 and Apr 20")
3. Optionally picks ONE **preferred** date to present
4. Submits — their response is saved to the PollResponses sheet

Responses accumulate until the organizer generates the schedule. Submitting early matters because preferred dates are first-come-first-served.

### Step 1: The organizer generates the schedule

Open **Organizer Tools** at the bottom of the page → **"Generate Schedule from Poll"**. The algorithm:

1. **Remove holidays** — Easter Monday and Whit Monday become "No Meeting" weeks. 27 Mondays → 25 available.
2. **Place 2 buffer weeks** — Spare weeks at roughly 1/3 and 2/3 through the semester. These absorb cancellations later. 25 → **23 presentation weeks** for 11 people.
3. **Honour preferred dates (first come, first served)** — If Giovanni submitted first and asked for Jun 1, he gets it. Later requests for the same date are ignored.
4. **Fill remaining slots by round-robin** — Members who haven't presented recently (higher credits) go first. Each person gets ~2 presentations; some get 3 to fill all 23 weeks.
5. **Respect unavailability** — If a member marked a date as unavailable, the algorithm skips them for that date.

A preview table is shown before anything is saved.

### Step 2: Save the schedule

Click **"Save & Archive Current"**. This:
1. Archives the old semester to the Archive tab
2. Writes the new 27-week schedule as the live schedule
3. Clears poll responses (consumed by the algorithm)
4. Auto-creates Indico calendar events for each presentation week (if configured)

### Step 3: During the semester — handling changes

**3a. Volunteering** ("I Want to Present") — No deadline. Pick a date, fill in type/topic. If the slot has someone, you're added as co-presenter ("Frank & Giovanni"). If the slot was auto-cancelled, volunteering reverses it.

**3b. Opt-out** ("I Can't Present") — Deadline: 6 days before (Tuesday of the prior week). The system moves you to the next buffer week and auto-assigns a random replacement weighted by fairness. Example: Frank opts out of May 4 → moved to buffer Jun 1, Ivan auto-assigned as replacement.

**3c. Swap** ("Swap Dates") — No deadline. Two members trade their next upcoming dates. Both see a preview before confirming.

**3d. Emergency Cancel** (link at bottom of page) — No deadline, even day-of. Meeting marked "Cancelled" with no replacement. For genuine emergencies only. You're moved to a buffer week.

**3e. Random Assignment** ("Assign Random Speaker") — Organizer picks an empty slot. System selects a random member weighted by credits (higher = more likely). Recent presenters (last 2 weeks) and opt-outs are excluded. Organizer can re-roll or confirm.

### Step 4: Automatic weekly triggers

- **Thursday 9 AM**: Slack reminder to #physics-general with Monday's meeting details + personal DM to the presenter whose talk is 11 days away
- **Saturday midnight**: If Monday's slot is still empty → auto-marked "Cancelled", Slack notified, Indico event deleted. Volunteering after this reverses the cancellation.

### Fairness system (credits)

Each week: non-presenters get +1 credit, presenters reset to 0. Higher credits = haven't presented recently = higher priority in schedule generation and random assignment. **Jain's Fairness Index** (shown at the bottom of the page, click for details) targets >= 0.90 where 1.0 = perfectly fair.

### Full lifecycle summary

```
Before semester:  Members fill poll → organizer generates schedule → saves (archives old)
During semester:  Thu reminder → Sat auto-cancel → Mon meeting
                  Anytime: volunteer, swap, opt-out (6-day deadline),
                           emergency cancel (no deadline), random assign
```

## Critical: CORS Pattern

All POST requests **must** use `Content-Type: text/plain` (not `application/json`). Apps Script returns 302 redirects and cannot handle OPTIONS preflight. The body is still JSON — parsed server-side with `JSON.parse(e.postData.contents)`. All fetches use `redirect: 'follow'`.

## Development

No build step. Open `index.html` in a browser. Works without a backend configured.

## Deployment

- **Frontend**: Push to the GitHub Pages branch (configured in Settings > Pages) → auto-deploys from root
- **Backend**: Edit Code.gs in Apps Script → **Deploy > New deployment** (required for every code change)
- **Sheet setup**: Run `setupSheets()` or `resetAndSetupSheets()` from Apps Script editor
- **Triggers**: Saturday auto-cancel, Thursday channel reminder, Thursday presenter DM — all manually created in Apps Script Triggers (see SETUP.md steps 6, 10)

## Key Conventions

- Presenters stored as strings with ` & ` delimiter, parsed via `Scheduler.parsePresenters()`
- Dates are always `YYYY-MM-DD` strings
- Status values: `TBD`, `Volunteered`, `Confirmed`, `Empty`, `Holiday`, `Buffer`, `Cancelled`
- Holiday rows use the presenter field for the holiday label (e.g. "Easter Monday")
- Buffer rows have empty presenter field and status `Buffer`
- Credits: non-presenting members get +1/week (skipping Holiday/Buffer weeks); presenting resets to 0
- Jain's Fairness Index target >= 0.90
- Opt-out enforced at 6 days before (both client and server side); swaps have no deadline
- Volunteering has no deadline and reverses auto-cancellations
- `checkSaturdayCancellation()` marks empty Monday slots as Cancelled on Saturday night
- Schedule generation runs client-side in `Scheduler.generateSchedule()`, then saves via `archiveAndSave` action
- `js/config.js` contains the shared secret — committed to repo (low-sensitivity group tool)
- Slack/Indico credentials stored in Apps Script **Script Properties** (SLACK_WEBHOOK_URL, SLACK_BOT_TOKEN, INDICO_API_TOKEN, INDICO_USERNAME, INDICO_PASSWORD, INDICO_BASE_URL, INDICO_CATEGORY_ID, INDICO_ROOM_NAME, INDICO_DESCRIPTION)
- INDICO_API_TOKEN is used for read-only export API; INDICO_USERNAME/PASSWORD auto-login for web UI actions (create/delete/update events); session cached 30 min
- Members sheet has a `SlackUserID` column for DM targeting; empty = no DMs for that member
- Indico events fetched server-side with `CacheService` (1-hour TTL), included in `doGet` response
- All Slack/Indico calls are fire-and-forget: wrapped in try/catch, failures logged to Log sheet, never break core actions

## Theming

- 3-state dark/light/auto toggle: `darkMode` state in `js/app.js`, cycles dark → light → auto
- `data-theme` attribute on `<html>` drives all theme switching; Pico CSS respects it natively
- Flash prevention: inline `<script>` in `<head>` reads `localStorage('theme')` and sets `data-theme` before paint
- Default theme is **dark** (when no localStorage value)
- Dark-mode CSS variables are duplicated in two selectors: `[data-theme="dark"]` (explicit) and `@media (prefers-color-scheme: dark) { [data-theme="auto"] }` (OS-following) — keep both in sync when changing colors
- New CSS variables for visual layer: `--dot-color`, `--bg-gradient-start/end`, `--card-bg`, `--card-border`, `--card-shadow`, `--row-hover-bg` (all have light + dark variants)
- Status badge pulse on current week uses `--pulse-color` CSS variable per status class

## Branches

- `slack-indico-integration-v2` — main working branch with all backend integrations
- `UI-improvements` — branched from `slack-indico-integration-v2`, adds theming and visual polish
- `main` — older, simpler version (no poll, archive, organizer tools, emergency cancel, Slack/Indico)
- GitHub Pages deployment branch is configured in repo Settings > Pages

## File Roles

- `js/config.js` — configuration: URLs, secret, semester, holidays, buffer count, deadline, members, presentation types. `DATES` computed dynamically from `SEMESTER.start`/`end`. Default schedule generated at runtime by `Scheduler.generateDefaultSchedule()`
- `js/api.js` — HTTP layer (GET/POST to Apps Script)
- `js/app.js` — Alpine.js `meetingApp` component: state, form logic, local fallbacks, archive, poll, schedule generation, theme toggle
- `js/scheduler.js` — pure functions: Jain's index, credit computation, weighted random, date utils, schedule generation algorithm
- `apps-script/Code.gs` — server-side: HTTP handlers, sheet CRUD, buffer auto-assignment, Slack notifications, Indico server-side fetch, time-driven triggers, setup helpers
