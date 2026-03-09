# Group Meeting Scheduler

A scheduling system for PhD research group meetings. GitHub Pages frontend with a Google Sheets backend via Google Apps Script.

## Features

- **Schedule table** with 16-week round-robin rotation (March 16 – June 29, 2026)
- **Volunteer to present** — pick a date, type, and topic
- **Opt out** — can't make your assigned date? Mark it and free the slot
- **Swap dates** — exchange assigned dates with another member
- **Random assignment** — credit-weighted random speaker selection for empty slots
- **Fairness tracking** — Jain's Fairness Index with per-member credit visualization
- **Indico integration** — optional CERN Indico event links
- Color-coded statuses, current week highlighting, mobile-responsive

## Tech Stack

- Vanilla HTML/CSS/JS — no build tools
- [Pico CSS](https://picocss.com/) for styling
- [Alpine.js](https://alpinejs.dev/) for reactivity
- Google Sheets as database
- Google Apps Script as API

## Quick Start

1. Clone this repo
2. Follow [SETUP.md](SETUP.md) to configure the Google Sheets backend
3. Fill in `js/config.js` with your Apps Script URL and secret
4. Push to GitHub and enable Pages

The site works locally without the backend — it uses a built-in default schedule.

## File Structure

```
index.html              Main page
css/style.css           Custom styles
js/config.js            Configuration (URLs, members, schedule)
js/api.js               API communication layer
js/app.js               Alpine.js application logic
js/scheduler.js         Scheduling algorithms and fairness math
apps-script/Code.gs     Google Apps Script backend
SETUP.md                Detailed setup instructions
```

## Members

Andreas, Frank, Giovanni, Guillaume, Ivan, Jona, Matej, Pradyun, Stephen, Theresa, Vincent

## Schedule (Spring 2026)

| Wk | Date | Presenter |
|----|------|-----------|
| 1 | Mar 16 | Andreas |
| 2 | Mar 23 | Frank |
| 3 | Mar 30 | Giovanni |
| 4 | Apr 6 | Guillaume |
| 5 | Apr 13 | Ivan |
| 6 | Apr 20 | Jona |
| 7 | Apr 27 | Matej |
| 8 | May 4 | Pradyun |
| 9 | May 11 | Stephen |
| 10 | May 18 | Theresa |
| 11 | May 25 | Vincent |
| 12 | Jun 1 | Andreas |
| 13 | Jun 8 | Frank |
| 14 | Jun 15 | Giovanni |
| 15 | Jun 22 | Guillaume |
| 16 | Jun 29 | Ivan |
