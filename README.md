# Group Meeting Scheduler

A web-based scheduling system for research group meetings. Static frontend on GitHub Pages, backed by Google Sheets via Google Apps Script. No build tools, no npm — just vanilla HTML/CSS/JS.

## Overview

This project solves the recurring problem of organizing weekly group meeting presentations: who presents when, handling conflicts, ensuring fairness, and managing last-minute changes. It was built for a PhD research group at CERN but is easily adaptable for any recurring seminar or meeting series.

## Features

- **6-month round-robin schedule** with automatic rotation across all group members
- **Holiday detection** — Geneva/Swiss holidays are excluded from the schedule
- **Buffer weeks** — unassigned weeks that absorb cancellations and rescheduling
- **Semester availability poll** — members submit availability before the schedule is generated
- **Volunteer to present** — claim any open slot, with no deadline restriction
- **Opt out** — cancel your assigned talk (6-day deadline, auto-moves you to a buffer week)
- **Swap dates** — exchange slots with another member (available anytime, even last-minute)
- **Random assignment** — credit-weighted random selection for empty slots
- **Fairness tracking** — Jain's Fairness Index with per-member credit visualization
- **Auto-cancellation** — empty slots are cancelled Saturday night if still unfilled
- **Schedule archive** — past semesters are preserved and viewable
- **Indico integration** — optional CERN Indico event links
- **Offline mode** — works without the backend using built-in defaults
- **Mobile-responsive** — works on phones and tablets

## Quick Start

1. Fork this repository
2. Follow [SETUP.md](SETUP.md) to create a Google Sheet and deploy the Apps Script backend
3. Fill in `APPS_SCRIPT_URL` and `SECRET` in `js/config.js`
4. Enable GitHub Pages on your fork (Settings > Pages > main branch)
5. Your site is live

The site works locally without a backend — open `index.html` in a browser to preview.

## Setup Guide

See [SETUP.md](SETUP.md) for detailed step-by-step instructions covering:
- Google Sheet creation and tab initialization
- Apps Script deployment
- Saturday auto-cancellation trigger setup
- GitHub Pages deployment
- Indico integration (optional)

## How It Works

### Scheduling Algorithm

1. **Semester dates**: All Mondays in the configured date range
2. **Holiday filtering**: Dates matching `CONFIG.HOLIDAYS` are marked as "Holiday — No Meeting"
3. **Buffer placement**: `CONFIG.BUFFER_WEEKS` unassigned weeks are spread evenly through the remaining dates
4. **Poll-aware generation**: If poll responses exist, the generator:
   - Honors preferred dates (first-come-first-served by submission time)
   - Never assigns someone to a date they marked unavailable
5. **Round-robin fill**: Remaining slots are filled in rotation, prioritizing members with the highest credits

### Credit-Based Fairness

The system tracks fairness using a credit mechanism:
- **Each week**: every active member who does _not_ present earns +1 credit
- **Presenting**: resets your credits to 0
- **Random assignment**: members with higher credits are weighted more heavily (more likely to be picked)
- **Jain's Fairness Index**: J = (sum of credits)^2 / (n * sum of credits^2). Target: J >= 0.90

### Deadlines and Rules

| Action | Deadline | Notes |
|--------|----------|-------|
| Volunteer | None | Sign up anytime, even last-minute. Reverses cancellations. |
| Opt out | 6 days before (Tuesday prior week) | After deadline: swap instead, or contact organizer. |
| Swap | None | Available anytime, including day-of for emergencies. |
| Auto-cancel | Saturday 11:59 PM CET | Empty slots are marked "Cancelled" by a Saturday trigger. |

### 6-Month Cycle

1. Before a new semester, the organizer opens the **Semester Poll**
2. Members submit their unavailable dates and optional preferred dates
3. The organizer clicks **Generate Schedule from Poll** in the Organizer Tools section
4. The system generates a schedule respecting all constraints, shows a preview
5. On confirmation, the current schedule is archived and the new one takes effect

## Configuration

All configuration lives in `js/config.js`:

| Setting | Description |
|---------|-------------|
| `APPS_SCRIPT_URL` | Google Apps Script Web App URL |
| `SECRET` | Shared secret (must match Script Properties) |
| `SEMESTER` | Label, start date, end date for the current 6-month cycle |
| `HOLIDAYS` | Array of `{date, label}` for Mondays that are holidays |
| `BUFFER_WEEKS` | Number of buffer weeks per semester (default: 2) |
| `OPT_OUT_DEADLINE_DAYS` | Days before meeting to opt out (default: 6) |
| `MEMBERS` | Array of member names in round-robin order |
| `INDICO_CATEGORY_ID` | CERN Indico category ID (optional) |

`DATES` is computed dynamically from `SEMESTER.start` and `SEMESTER.end` — no manual date list needed.

### Customizing for Your Group

1. **Members**: Edit the `MEMBERS` array in `config.js`
2. **Holidays**: Update `HOLIDAYS` with your local public holidays that fall on your meeting day
3. **Dates**: Update `SEMESTER.start` and `SEMESTER.end` — Mondays are computed automatically
4. **Buffer weeks**: Adjust `BUFFER_WEEKS` (0 to disable)
5. **Opt-out deadline**: Change `OPT_OUT_DEADLINE_DAYS`
6. **Meeting time/day**: Update `MEETING_TIME` and `MEETING_DAY` (display only)
7. **Default schedule**: Computed automatically from the above settings — no manual update needed

## For Group Members

### How to use the website

- **View the schedule**: The main page shows all weeks with presenter names, dates, and statuses
- **Volunteer**: Click "I Want to Present" — pick your name, a date, talk type, and topic
- **Can't present?**: Click "I Can't Present" — select your name and assigned date (must be 6+ days before)
- **Need to swap?**: Click "Swap Dates" — select both members and confirm
- **Fill the poll**: Click "Semester Poll" at the start of each semester — check off your unavailable dates

### Status meanings

| Badge | Meaning |
|-------|---------|
| **TBD** | Assigned but not yet confirmed |
| **Volunteered** | Member signed up voluntarily |
| **Confirmed** | Talk is confirmed |
| **Empty** | No presenter — needs a volunteer |
| **Buffer** | Unassigned buffer week — available for volunteers |
| **Holiday** | Public holiday — no meeting |
| **Cancelled** | Auto-cancelled (no speaker by Saturday deadline) |

## For Organizers

### Managing the schedule

1. **Start of semester**: Share the poll link. Ask everyone to fill out the Semester Poll.
2. **Generate schedule**: Open Organizer Tools > "Generate Schedule from Poll". Review the preview, then save.
3. **During semester**: Monitor the schedule. Use "Assign Random Speaker" for empty slots.
4. **Saturday trigger**: Runs automatically. Empty Monday slots get cancelled Saturday night.
5. **End of semester**: The schedule is automatically archived when you generate the next one.

### Google Sheet tabs

| Tab | Purpose |
|-----|---------|
| Schedule | Current semester's weekly schedule |
| Members | Member list with credits and presentation counts |
| OptOuts | Log of all opt-out requests |
| Log | Audit trail of all actions |
| PollResponses | Semester poll submissions (cleared after schedule generation) |
| Archive | Past semesters' schedules |

## Tech Stack

- **Frontend**: Vanilla HTML/CSS/JS, [Pico CSS](https://picocss.com/), [Alpine.js](https://alpinejs.dev/)
- **Backend**: Google Apps Script (Web App)
- **Database**: Google Sheets
- **Hosting**: GitHub Pages
- **CORS**: All POSTs use `Content-Type: text/plain` to avoid preflight requests

## FAQ

**Q: What happens if I can't present and the deadline has passed?**
A: Try to find someone to swap with using the Swap feature (no deadline). If that fails, contact the organizer directly.

**Q: Can two people present on the same date?**
A: Yes. Volunteering for a date that already has a presenter adds you as an additional presenter.

**Q: What are buffer weeks?**
A: Unassigned weeks spread through the semester. If you opt out and your slot becomes empty, you're automatically moved to the next buffer week. Buffers can also be claimed by volunteers.

**Q: How does the Saturday auto-cancellation work?**
A: A Google Apps Script trigger runs every Saturday at midnight. If a Monday slot has no presenter, it's marked "Cancelled". If someone volunteers after that (even Sunday or Monday morning), the cancellation is reversed automatically.

**Q: Do I need to redeploy after editing Apps Script code?**
A: Yes. Go to Deploy > New deployment in the Apps Script editor. Editing code without creating a new deployment does not update the live web app.

**Q: Can I use this for a non-Monday meeting?**
A: Yes. Change `MEETING_DAY`, `MEETING_TIME`, update `DATES` with your meeting day dates, and update `HOLIDAYS` accordingly. The Saturday trigger timing may need adjustment too.

## License

MIT
