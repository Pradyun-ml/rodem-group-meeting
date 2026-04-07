# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Group meeting scheduler for a PhD research group. Static frontend on GitHub Pages talks to a Google Sheets backend via Google Apps Script. No build tools, no npm — just vanilla HTML/CSS/JS.

## Architecture

**Frontend** (`index.html`, `js/`, `css/`): Alpine.js for reactivity, Pico CSS for styling. Single-page app with modals for volunteer/opt-out/swap/random-assign/poll actions, plus an archive section and organizer tools.

**Backend** (`apps-script/Code.gs`): Google Apps Script deployed as a Web App. `doGet` returns schedule/members/opt-outs/archive/poll/indico data as JSON. `doPost` dispatches actions with `LockService` for concurrency. Post-lock Slack notifications are sent after each successful action (never inside the lock window). Three time-driven triggers: `checkSaturdayCancellation` (Saturday), `sendMondayAnnouncement` (Monday), `sendDailyPresenterReminder` (daily).

**Data flow**: Frontend → `API.post(action, payload)` → Apps Script → Google Sheets (6 tabs: Schedule, Members, OptOuts, Log, PollResponses, Archive).

**Offline fallback**: If `APPS_SCRIPT_URL` is empty or the backend is unreachable, the app runs from `CONFIG.DEFAULT_SCHEDULE` in memory. Forms apply changes locally.

## Critical: CORS Pattern

All POST requests **must** use `Content-Type: text/plain` (not `application/json`). Apps Script returns 302 redirects and cannot handle OPTIONS preflight. The body is still JSON — parsed server-side with `JSON.parse(e.postData.contents)`. All fetches use `redirect: 'follow'`.

## Development

No build step. Open `index.html` in a browser. Works without a backend configured.

## Deployment

- **Frontend**: Push to `main` → GitHub Pages auto-deploys from root
- **Backend**: Edit Code.gs in Apps Script → **Deploy > New deployment** (required for every code change)
- **Sheet setup**: Run `setupSheets()` or `resetAndSetupSheets()` from Apps Script editor
- **Triggers**: Saturday auto-cancel, Monday announcement, daily reminders — all manually created in Apps Script Triggers (see SETUP.md steps 6, 10)

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
- Slack/Indico credentials stored in Apps Script **Script Properties** (SLACK_WEBHOOK_URL, SLACK_BOT_TOKEN, INDICO_API_TOKEN, INDICO_SESSION, INDICO_BASE_URL, INDICO_CATEGORY_ID)
- INDICO_API_TOKEN is used for read-only export API; INDICO_SESSION (session cookie) is used for web UI actions (create/delete/update events)
- Members sheet has a `SlackUserID` column for DM targeting; empty = no DMs for that member
- Indico events fetched server-side with `CacheService` (1-hour TTL), included in `doGet` response
- All Slack/Indico calls are fire-and-forget: wrapped in try/catch, failures logged to Log sheet, never break core actions

## File Roles

- `js/config.js` — configuration: URLs, secret, semester, holidays, buffer count, deadline, members, presentation types. `DATES` computed dynamically from `SEMESTER.start`/`end`. Default schedule generated at runtime by `Scheduler.generateDefaultSchedule()`
- `js/api.js` — HTTP layer (GET/POST to Apps Script)
- `js/app.js` — Alpine.js `meetingApp` component: state, form logic, local fallbacks, archive, poll, schedule generation
- `js/scheduler.js` — pure functions: Jain's index, credit computation, weighted random, date utils, schedule generation algorithm
- `apps-script/Code.gs` — server-side: HTTP handlers, sheet CRUD, buffer auto-assignment, Slack notifications, Indico server-side fetch, time-driven triggers, setup helpers
