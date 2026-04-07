# Setup Guide

## 1. Create the Google Sheet

1. Go to [Google Sheets](https://sheets.google.com) and create a new spreadsheet
2. Name it "Group Meeting Schedule" (or whatever you prefer)

## 2. Set Up Google Apps Script

1. In your spreadsheet, go to **Extensions > Apps Script**
2. Delete any existing code in `Code.gs`
3. Copy the entire contents of `apps-script/Code.gs` and paste it in
4. Save the project (Ctrl+S)

## 3. Initialize Sheet Tabs

1. In the Apps Script editor, select `setupSheets` from the function dropdown
2. Click **Run**
3. Grant the required permissions when prompted
4. This creates six tabs with headers and pre-filled data

If `setupSheets` doesn't populate correctly (e.g. tabs were already partially created), use `resetAndSetupSheets` instead — this clears everything and starts fresh.

### Tab: Schedule (27 weeks, March 30 – September 28, 2026)
| Week | Date | Presenter | Type | Topic | Abstract | Status |
|------|------|-----------|------|-------|----------|--------|
| 1 | 2026-03-30 | Andreas | | | | TBD |
| 2 | 2026-04-06 | Easter Monday | | | | Holiday |
| 3 | 2026-04-13 | Frank | | | | TBD |
| 4 | 2026-04-20 | Giovanni | | | | TBD |
| 5 | 2026-04-27 | Guillaume | | | | TBD |
| 6 | 2026-05-04 | Ivan | | | | TBD |
| 7 | 2026-05-11 | Jona | | | | TBD |
| 8 | 2026-05-18 | Matej | | | | TBD |
| 9 | 2026-05-25 | Whit Monday | | | | Holiday |
| 10 | 2026-06-01 | | | | | Buffer |
| 11 | 2026-06-08 | Pradyun | | | | TBD |
| 12 | 2026-06-15 | Stephen | | | | TBD |
| 13 | 2026-06-22 | Theresa | | | | TBD |
| 14 | 2026-06-29 | Vincent | | | | TBD |
| 15 | 2026-07-06 | Andreas | | | | TBD |
| 16 | 2026-07-13 | Frank | | | | TBD |
| 17 | 2026-07-20 | Giovanni | | | | TBD |
| 18 | 2026-07-27 | Guillaume | | | | TBD |
| 19 | 2026-08-03 | | | | | Buffer |
| 20 | 2026-08-10 | Ivan | | | | TBD |
| 21 | 2026-08-17 | Jona | | | | TBD |
| 22 | 2026-08-24 | Matej | | | | TBD |
| 23 | 2026-08-31 | Pradyun | | | | TBD |
| 24 | 2026-09-07 | Stephen | | | | TBD |
| 25 | 2026-09-14 | Theresa | | | | TBD |
| 26 | 2026-09-21 | Vincent | | | | TBD |
| 27 | 2026-09-28 | Andreas | | | | TBD |

### Tab: Members
| Name | Email | Credits | LastPresented | TotalPresentations | Active | SlackUserID |
|------|-------|---------|---------------|-------------------|--------|-------------|
| Andreas | | 0 | | 0 | Yes | |
| Frank | | 0 | | 0 | Yes | |
| Giovanni | | 0 | | 0 | Yes | |
| Guillaume | | 0 | | 0 | Yes | |
| Ivan | | 0 | | 0 | Yes | |
| Jona | | 0 | | 0 | Yes | |
| Matej | | 0 | | 0 | Yes | |
| Pradyun | | 0 | | 0 | Yes | |
| Stephen | | 0 | | 0 | Yes | |
| Theresa | | 0 | | 0 | Yes | |
| Vincent | | 0 | | 0 | Yes | |

### Tab: OptOuts
| Timestamp | Name | Date | Reason |
|-----------|------|------|--------|

### Tab: Log
| Timestamp | Action | Details |
|-----------|--------|---------|

### Tab: PollResponses
| Timestamp | Name | UnavailableDates | PreferredDate |
|-----------|------|------------------|---------------|

### Tab: Archive
| Semester | Week | Date | Presenter | Type | Topic | Abstract | Status |
|----------|------|------|-----------|------|-------|----------|--------|

## 4. Set the Shared Secret

1. In Apps Script, go to **Project Settings** (gear icon)
2. Scroll to **Script Properties**
3. Click **Add script property**
4. Key: `SECRET`, Value: choose a random string (e.g. `my-secret-key-2026`)
5. Save

Do **not** include quotes around the key or value — the UI handles strings directly.

## 5. Deploy as Web App

1. Click **Deploy > New deployment**
2. Click the gear icon next to "Select type" and choose **Web app**
3. Description: "Group Meeting v1"
4. Execute as: **Me**
5. Who has access: **Anyone**
6. Click **Deploy**
7. Copy the **Web app URL**

**Important:** Every time you edit the Apps Script code, you must create a **new deployment version** for changes to take effect.

## 6. Set Up the Saturday Auto-Cancellation Trigger

This trigger runs every Saturday at midnight and automatically cancels any Monday meeting that has no speaker.

1. In the Apps Script editor, click the clock icon (**Triggers**) in the left sidebar
2. Click **+ Add Trigger**
3. Configure:
   - Function: `checkSaturdayCancellation`
   - Deployment: Head
   - Event source: **Time-driven**
   - Type of time based trigger: **Week timer**
   - Day of week: **Saturday**
   - Time of day: **Midnight to 1am**
4. Click **Save**

If a slot is empty by Saturday night, it will be marked as "Cancelled". If someone volunteers after that (even on Sunday or Monday morning), the cancellation is automatically reversed.

## 7. Configure the Website

1. Open `js/config.js`
2. Set `APPS_SCRIPT_URL` to your Web App URL from step 5
3. Set `SECRET` to the same secret you set in step 4

```javascript
const CONFIG = {
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec',
  SECRET: 'my-secret-key-2026',
  // ...
};
```

## 8. Deploy to GitHub Pages

1. Create a GitHub repository
2. Push all files
3. Go to repository **Settings > Pages**
4. Source: **Deploy from a branch**
5. Branch: **main**, folder: **/ (root)**
6. Save — your site will be live at `https://yourusername.github.io/repo-name/`

## 9. Optional: Indico Integration (Server-Side)

If your group uses Indico for event management, the backend fetches events server-side (no frontend config needed).

1. Create an API token at your Indico instance (Profile → API tokens, read scope)
2. In Apps Script **Project Settings > Script Properties**, add:
   - `INDICO_API_TOKEN`: your API token
   - `INDICO_BASE_URL`: your Indico instance URL (e.g. `https://partphys-indico.unige.ch`)
   - `INDICO_CATEGORY_ID`: category ID from the URL (e.g. `19`)
3. Create a **new deployment** for changes to take effect

Events from the next 90 days are fetched server-side, cached for 1 hour, and included in the API response. Matching dates show `[Indico]` links automatically. If Indico is unreachable, links simply don't appear.

### Automatic Event Creation

Indico events are auto-created/updated/deleted when the schedule changes:
- **Volunteer**, **Random Assign**: creates a new Indico event (or updates chairperson if one exists)
- **Opt-Out** (with auto-assign): updates the event's chairperson to the replacement
- **Swap**: updates chairpersons on both events
- **Emergency Cancel**, **Saturday Auto-Cancel**: deletes the Indico event
- **New Semester**: bulk-creates events for all scheduled dates

To enable, add two additional Script Properties:
- `INDICO_ROOM_NAME`: room name (e.g. `AEM 026`)
- `INDICO_DESCRIPTION`: fixed event description (e.g. Zoom info)

If auto-creation fails, a warning is posted to Slack — create the event manually. To test, run `testIndicoCreate()` from the Apps Script editor.

## 10. Optional: Slack Integration

### Channel Notifications (Incoming Webhook)

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new Slack App for your workspace
2. Enable **Incoming Webhooks** and create a webhook for your channel (e.g. `#physics-general`)
3. In Apps Script **Project Settings > Script Properties**, add:
   - `SLACK_WEBHOOK_URL`: the webhook URL

Channel notifications are sent for:
- Thursday midweek reminders about the upcoming Monday meeting (meeting details + Indico link)
- Schedule changes (volunteer, swap, random assignment)
- Saturday auto-cancellations (no speaker by Saturday night)
- Emergency cancellations

### Personal DM Reminders (Bot Token)

1. In your Slack App, go to **OAuth & Permissions**
2. Add the bot scope: `chat:write`
3. Install the app to your workspace
4. Copy the **Bot User OAuth Token**
5. In Apps Script **Project Settings > Script Properties**, add:
   - `SLACK_BOT_TOKEN`: the bot token (starts with `xoxb-`)
6. In the Google Sheet **Members** tab, fill in the **SlackUserID** column for each member
   - To find a Slack User ID: open the member's profile in Slack → click **⋮** → **Copy member ID**
   - If upgrading an existing sheet, run `addSlackUserIdColumn()` from the Apps Script editor to add the column

A single DM reminder is sent to the presenter 11 days before their scheduled date (on Thursday).

### Set Up Notification Triggers

1. In the Apps Script editor, click the clock icon (**Triggers**) in the left sidebar
2. Create two triggers:

**Thursday Channel Reminder:**
- Function: `sendThursdayReminder`
- Deployment: **Head**
- Event source: **Time-driven**
- Type: **Week timer**
- Day of week: **Thursday**
- Time of day: **9am to 10am**

**Thursday Presenter Reminder:**
- Function: `sendPresenterReminder`
- Deployment: **Head**
- Event source: **Time-driven**
- Type: **Week timer**
- Day of week: **Thursday**
- Time of day: **9am to 10am**

3. Click **Save** for each

**Important:** Set the project timezone to **Europe/Zurich** in Apps Script **Project Settings** so triggers fire at the correct local time.

## Troubleshooting

- **CORS errors**: Ensure all POST requests use `Content-Type: text/plain`, not `application/json`
- **302 redirects**: The `redirect: 'follow'` option in fetch handles these automatically
- **Stale data**: After editing Apps Script, create a new deployment — editing code alone doesn't update the live web app
- **Permission errors**: Re-authorize the script if Google prompts you
- **Schedule not loading**: Check browser console. The site works offline with local defaults if the backend is not configured
- **Saturday trigger not firing**: Check Triggers in Apps Script — the trigger must be set up manually (step 6)
- **Slack notifications not sending**: Verify Script Properties are set correctly (no quotes around values). Check the Log sheet for `notificationError` entries
- **No Indico links**: Check INDICO_API_TOKEN, INDICO_BASE_URL, and INDICO_CATEGORY_ID in Script Properties. Events are cached for 1 hour
- **DMs not received**: Ensure the member's SlackUserID is filled in the Members sheet and the bot has `chat:write` scope
