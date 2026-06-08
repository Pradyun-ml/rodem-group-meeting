/**
 * Group Meeting Scheduler — Google Apps Script Backend
 *
 * Deploy as Web App:
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * After deploying, copy the Web App URL into js/config.js
 * Set the shared secret in Script Properties (key: SECRET)
 *
 * Sheet tabs: Schedule, Members, OptOuts, Log, PollResponses, Archive
 *
 * Script Properties (Project Settings > Script Properties):
 *   SECRET              — shared auth secret (must match config.js)
 *   SLACK_WEBHOOK_URL   — Slack incoming webhook for #physics-general (optional)
 *   SLACK_BOT_TOKEN     — Slack bot token with chat:write scope (optional)
 *   INDICO_API_TOKEN    — Indico personal API token with read scope (optional)
 *   INDICO_USERNAME     — Indico login username for web UI auth (event create/delete/update)
 *   INDICO_PASSWORD     — Indico login password
 *   INDICO_BASE_URL     — Indico instance URL (default: https://partphys-indico.unige.ch)
 *   INDICO_CATEGORY_ID  — Indico category ID (default: 19)
 *   INDICO_ROOM_NAME    — Room name for auto-created events (default: AEM 026)
 *   INDICO_DESCRIPTION  — Fixed description for auto-created events (e.g. Zoom info)
 */

// ============================================================
// Configuration
// ============================================================

var OPT_OUT_DEADLINE_DAYS = 6;

function getSecret() {
  return PropertiesService.getScriptProperties().getProperty('SECRET') || '';
}

function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getSlackWebhookUrl() {
  return PropertiesService.getScriptProperties().getProperty('SLACK_WEBHOOK_URL') || '';
}

function getSlackBotToken() {
  return PropertiesService.getScriptProperties().getProperty('SLACK_BOT_TOKEN') || '';
}

function getIndicoApiToken() {
  return PropertiesService.getScriptProperties().getProperty('INDICO_API_TOKEN') || '';
}

function getIndicoUsername() {
  return PropertiesService.getScriptProperties().getProperty('INDICO_USERNAME') || '';
}

function getIndicoPassword() {
  return PropertiesService.getScriptProperties().getProperty('INDICO_PASSWORD') || '';
}

/**
 * Extract indico_session cookie from response headers.
 * Checks both getHeaders() and getAllHeaders() for Set-Cookie.
 * Returns the session value or ''.
 */
function extractSessionCookie(response) {
  // Try getAllHeaders first (handles multiple Set-Cookie headers)
  var allHeaders = response.getAllHeaders();
  if (allHeaders && allHeaders['Set-Cookie']) {
    var cookies = allHeaders['Set-Cookie'];
    if (typeof cookies === 'string') cookies = [cookies];
    for (var i = 0; i < cookies.length; i++) {
      var m = cookies[i].match(/indico_session=([^;]+)/);
      if (m) return m[1];
    }
  }
  // Fallback to single header
  var setCookie = response.getHeaders()['Set-Cookie'] || '';
  var match = setCookie.match(/indico_session=([^;]+)/);
  return match ? match[1] : '';
}

/**
 * Log in to Indico via the local account login form.
 * Indico v2.3.5 accepts the all-zeros CSRF token for unauthenticated login.
 * The key hidden field is _provider=indico.
 * Returns the indico_session cookie value or '' on failure.
 */
function indicoLogin() {
  var baseUrl = getIndicoBaseUrl();
  var username = getIndicoUsername();
  var password = getIndicoPassword();
  if (!username || !password) return '';

  try {
    var loginPayload = 'csrf_token=00000000-0000-0000-0000-000000000000'
      + '&_provider=indico'
      + '&identifier=' + encodeURIComponent(username)
      + '&password=' + encodeURIComponent(password);

    var loginRes = UrlFetchApp.fetch(baseUrl + '/login/', {
      method: 'post',
      contentType: 'application/x-www-form-urlencoded',
      payload: loginPayload,
      muteHttpExceptions: true,
      followRedirects: false
    });

    var session = extractSessionCookie(loginRes);
    if (session) return session;

    logAction(getSpreadsheet(), 'indicoError', 'Login failed — HTTP ' + loginRes.getResponseCode() + ', no session cookie');
    return '';
  } catch (e) {
    logAction(getSpreadsheet(), 'indicoError', 'indicoLogin failed: ' + e.message);
    return '';
  }
}

/**
 * Get a valid Indico session, using a cached session or logging in fresh.
 * Sessions are cached for 30 minutes to avoid excessive logins.
 * Returns the session cookie value or '' if login is not configured/fails.
 */
function getIndicoSession() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('indicoSession');
  if (cached) return cached;

  var session = indicoLogin();
  if (session) {
    // Cache for 30 minutes (1800 seconds)
    cache.put('indicoSession', session, 1800);
  }
  return session;
}

function getIndicoBaseUrl() {
  return PropertiesService.getScriptProperties().getProperty('INDICO_BASE_URL') || 'https://partphys-indico.unige.ch';
}

function getIndicoCategoryId() {
  return PropertiesService.getScriptProperties().getProperty('INDICO_CATEGORY_ID') || '19';
}

function getIndicoRoomName() {
  return PropertiesService.getScriptProperties().getProperty('INDICO_ROOM_NAME') || 'AEM 026';
}

function getIndicoDescription() {
  return PropertiesService.getScriptProperties().getProperty('INDICO_DESCRIPTION') || '';
}

// ============================================================
// Slack Messaging
// ============================================================

/**
 * Post a message to #physics-general via incoming webhook.
 * Never throws — errors are logged silently.
 */
function sendSlackWebhook(text) {
  var url = getSlackWebhookUrl();
  if (!url) return;
  try {
    UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ text: text }),
      muteHttpExceptions: true
    });
  } catch (e) {
    try { logAction(getSpreadsheet(), 'slackError', 'Webhook failed: ' + e.message); } catch (ignored) {}
  }
}

/**
 * Send a DM to a member via Slack chat.postMessage API.
 * Requires SLACK_BOT_TOKEN with chat:write scope.
 * Never throws — errors are logged silently.
 */
function sendSlackDM(slackUserId, text) {
  var token = getSlackBotToken();
  if (!token || !slackUserId) return;
  try {
    var res = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify({ channel: slackUserId, text: text }),
      muteHttpExceptions: true
    });
    var json = JSON.parse(res.getContentText());
    if (!json.ok) {
      logAction(getSpreadsheet(), 'slackError', 'DM to ' + slackUserId + ' failed: ' + (json.error || 'unknown'));
    }
  } catch (e) {
    try { logAction(getSpreadsheet(), 'slackError', 'DM failed: ' + e.message); } catch (ignored) {}
  }
}

/**
 * Look up a member's Slack User ID from the Members sheet.
 * Returns empty string if not found or column doesn't exist.
 */
function lookupSlackUserId(ss, memberName) {
  var sheet = ss.getSheetByName('Members');
  if (!sheet) return '';
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var nameCol = headers.indexOf('Name');
  var slackCol = headers.indexOf('SlackUserID');
  if (nameCol === -1 || slackCol === -1) return '';
  for (var i = 1; i < data.length; i++) {
    if ((data[i][nameCol] || '').toString() === memberName) {
      return (data[i][slackCol] || '').toString().trim();
    }
  }
  return '';
}

/**
 * Format a YYYY-MM-DD date string for Slack messages.
 * Returns e.g. "Monday, March 30, 2026"
 */
function formatDateForSlack(dateStr) {
  var d = new Date(dateStr + 'T12:00:00');
  return Utilities.formatDate(d, 'Europe/Zurich', 'EEEE, MMMM d, yyyy');
}

// ============================================================
// Notification Composers
// ============================================================

/**
 * Post the Monday morning meeting announcement to #physics-general.
 */
function notifyChannelAnnouncement(dateStr, presenter, type, topic, status, indicoUrl) {
  var formattedDate = formatDateForSlack(dateStr);
  var text;

  if (status === 'Cancelled' || (status === 'Empty' && !presenter)) {
    text = '\u274c *RODEM HEP Weekly \u2014 ' + formattedDate + '* \u2014 Meeting cancelled this week';
  } else if ((status === 'Buffer' && !presenter) || (!presenter && status !== 'Holiday')) {
    text = '\ud83d\udcc5 *RODEM HEP Weekly \u2014 ' + formattedDate + '* \u2014 No speaker scheduled. Volunteers welcome on the website!';
  } else if (status === 'Holiday') {
    return; // no announcement for holidays
  } else {
    text = '\ud83d\udcc5 *RODEM HEP Weekly \u2014 ' + formattedDate + '*';
    text += '\n\ud83d\udc64 Speaker: ' + presenter;
    if (topic) {
      text += '\n\ud83d\udcdd Topic: ' + topic;
      if (type) text += ' (' + type + ')';
    }
    if (indicoUrl) {
      text += '\n\ud83d\udd17 Indico: ' + indicoUrl;
    }
  }

  sendSlackWebhook(text);
}

/**
 * Send a personal reminder DM to a presenter.
 */
function notifyPresenterReminder(ss, memberName, dateStr, daysAway, topic) {
  var slackId = lookupSlackUserId(ss, memberName);
  if (!slackId) return;

  var formattedDate = formatDateForSlack(dateStr);
  var topicStr = topic ? topic : 'TBD \u2014 please update on the website';

  var deadlineDate = new Date(dateStr + 'T12:00:00');
  deadlineDate.setDate(deadlineDate.getDate() - OPT_OUT_DEADLINE_DAYS);
  var deadlineStr = Utilities.formatDate(deadlineDate, 'Europe/Zurich', 'EEEE, MMMM d');

  var text = '\ud83d\udc4b Hi ' + memberName + '! Friendly reminder: you\'re scheduled to present at the RODEM HEP Weekly on *' + formattedDate + '* at *3:00 PM CET* (' + daysAway + ' days from now).';
  text += '\nTopic: ' + topicStr;
  text += '\nIf you can\'t make it, please opt out or find a swap on the website by *' + deadlineStr + '*.';

  sendSlackDM(slackId, text);
}

/**
 * Post a schedule change notification to #physics-general.
 */
function notifyChannelReassignment(dateStr, newPresenter, description) {
  var formattedDate = formatDateForSlack(dateStr);
  var text = '\ud83d\udd04 *Schedule Update \u2014 ' + formattedDate + '*\n' + description;
  if (newPresenter) {
    text += '\n\ud83d\udc64 New speaker: ' + newPresenter;
  }
  sendSlackWebhook(text);
}

/**
 * Send a DM to a member who has been assigned to present.
 */
function notifyPresenterAssignment(ss, memberName, dateStr, reason) {
  var slackId = lookupSlackUserId(ss, memberName);
  if (!slackId) return;

  var formattedDate = formatDateForSlack(dateStr);
  var text = '\ud83d\udce2 You\'ve been ' + reason + ' for the RODEM HEP Weekly on *' + formattedDate + '*. Please update your topic on the website.';

  sendSlackDM(slackId, text);
}

// ============================================================
// Indico Integration (Server-Side)
// ============================================================

/**
 * Fetch upcoming events from the Indico category.
 * Results are cached for 1 hour to reduce API load.
 * Returns [{date, url, title}] or [] on failure.
 */
function fetchIndicoEvents() {
  try {
    var cache = CacheService.getScriptCache();
    var cached = cache.get('indicoEvents');
    if (cached) {
      return JSON.parse(cached);
    }

    var token = getIndicoApiToken();
    if (!token) return [];

    var baseUrl = getIndicoBaseUrl();
    var categoryId = getIndicoCategoryId();
    var url = baseUrl + '/export/categ/' + categoryId + '.json?from=today&to=%2B180d&ak=' + token;

    var res;
    try {
      res = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        validateHttpsCertificates: false
      });
    } catch (e) {
      // Network error (Indico down) — cache empty result for 5 min to avoid hammering
      try { logAction(getSpreadsheet(), 'indicoError', 'fetchIndicoEvents failed: ' + e.message); } catch (ignored) {}
      cache.put('indicoEvents', '[]', 180);
      return [];
    }

    var code = res.getResponseCode();
    if (code !== 200) {
      logAction(getSpreadsheet(), 'indicoError', 'Indico API returned HTTP ' + code);
      cache.put('indicoEvents', '[]', 180);
      return [];
    }

    var json = JSON.parse(res.getContentText());
    var results = json.results || [];
    var events = results.map(function(r) {
      var dateStr = '';
      if (r.startDate && r.startDate.date) {
        dateStr = r.startDate.date;
      }
      return {
        date: dateStr,
        url: r.url || '',
        title: r.title || ''
      };
    }).filter(function(e) { return e.date; });

    cache.put('indicoEvents', JSON.stringify(events), 3600);
    return events;
  } catch (e) {
    try { logAction(getSpreadsheet(), 'indicoError', 'fetchIndicoEvents failed: ' + e.message); } catch (ignored) {}
    try { CacheService.getScriptCache().put('indicoEvents', '[]', 300); } catch (ignored) {}
    return [];
  }
}

/**
 * Find the Indico event URL for a specific date.
 * Returns the URL string or empty string.
 */
function findIndicoUrlForDate(dateStr) {
  var events = fetchIndicoEvents();
  for (var i = 0; i < events.length; i++) {
    if (events[i].date === dateStr) return events[i].url;
  }
  return '';
}

// ============================================================
// Indico Event Creation / Deletion (Phase 1)
// ============================================================

/**
 * Clear the Indico events cache so the next read fetches fresh data.
 */
function clearIndicoCache() {
  try { CacheService.getScriptCache().remove('indicoEvents'); } catch (e) {}
}

/**
 * Safety check: returns true only if dateStr (YYYY-MM-DD) falls on a Monday.
 * All Indico write operations MUST call this to avoid modifying non-meeting events.
 */
function isMonday(dateStr) {
  var d = new Date(dateStr + 'T00:00:00');
  return d.getDay() === 1;
}

/**
 * Extract event ID from an Indico URL like https://host/event/123/
 */
function extractIndicoEventId(url) {
  var match = url.match(/\/event\/(\d+)/);
  return match ? match[1] : '';
}

/**
 * Log an Indico failure and post a Slack warning.
 * Never throws.
 */
function indicoFailureNotification(action, dateStr, errorMsg) {
  try {
    var msg = '\u26a0\ufe0f Indico auto-' + action + ' failed for ' + dateStr + ': ' + errorMsg + '. Please handle manually.';
    logAction(getSpreadsheet(), 'indicoError', msg);
    sendSlackWebhook(msg);
  } catch (e) {}
}

/**
 * Convert YYYY-MM-DD to DD/MM/YYYY for Indico v2.3.5 form fields.
 */
function formatDateDDMMYYYY(dateStr) {
  var parts = dateStr.split('-');
  return parts[2] + '/' + parts[1] + '/' + parts[0];
}

/**
 * Fetch a CSRF token from the Indico event creation page.
 * Uses session cookie auth. Response may be JSON (AJAX) or HTML.
 * Returns the token string or '' if not found.
 */
function fetchIndicoCsrfToken(baseUrl, categoryId, session) {
  try {
    var res = UrlFetchApp.fetch(baseUrl + '/event/create/meeting?category_id=' + categoryId, {
      method: 'get',
      headers: {
        'Cookie': 'indico_session=' + session
      },
      muteHttpExceptions: true,
      followRedirects: true
    });

    var body = res.getContentText();

    // Try JSON response first (Indico returns JSON for AJAX-style requests)
    try {
      var json = JSON.parse(body);
      if (json.csrf_token) return json.csrf_token;
      // Some Indico versions nest it in the HTML field
      if (json.html) {
        var htmlMatch = json.html.match(/name="event-creation-csrf_token"\s+[^>]*value="([^"]+)"/);
        if (htmlMatch) return htmlMatch[1];
        htmlMatch = json.html.match(/value="([^"]+)"\s+[^>]*name="event-creation-csrf_token"/);
        if (htmlMatch) return htmlMatch[1];
      }
    } catch (e) {}

    // Fallback: HTML response — extract from meta tag or form field
    var match = body.match(/name="csrf-token"[^>]*content="([^"]+)"/);
    if (match && match[1] !== '00000000-0000-0000-0000-000000000000') return match[1];
    match = body.match(/name="event-creation-csrf_token"\s+[^>]*value="([^"]+)"/);
    if (match) return match[1];
    match = body.match(/value="([^"]+)"\s+[^>]*name="event-creation-csrf_token"/);
    if (match) return match[1];

    return '';
  } catch (e) {
    logAction(getSpreadsheet(), 'indicoError', 'CSRF token fetch failed: ' + e.message);
    return '';
  }
}

/**
 * Fetch a CSRF token from the Indico event management page.
 * Used for delete and update operations on existing events.
 * Returns the token string or '' if not found.
 */
function fetchIndicoManageCsrfToken(baseUrl, path, session) {
  try {
    var res = UrlFetchApp.fetch(baseUrl + path, {
      method: 'get',
      headers: {
        'Cookie': 'indico_session=' + session
      },
      muteHttpExceptions: true,
      followRedirects: true
    });

    var body = res.getContentText();

    // Try JSON response first
    try {
      var json = JSON.parse(body);
      if (json.csrf_token) return json.csrf_token;
    } catch (e) {}

    // Fallback: HTML — meta tag or form field
    var match = body.match(/name="csrf-token"[^>]*content="([^"]+)"/);
    if (match && match[1] !== '00000000-0000-0000-0000-000000000000') return match[1];
    match = body.match(/name="csrf_token"\s+[^>]*value="([^"]+)"/);
    if (match) return match[1];
    match = body.match(/value="([^"]+)"\s+[^>]*name="csrf_token"/);
    if (match) return match[1];

    return '';
  } catch (e) {
    logAction(getSpreadsheet(), 'indicoError', 'Manage CSRF token fetch failed: ' + e.message);
    return '';
  }
}

/**
 * Create an Indico meeting event via form POST (v2.3.5 compatible).
 * If an event already exists for this date, updates the chairperson instead.
 * Returns the new event URL or '' on failure. Never throws.
 */
function createIndicoEvent(dateStr, presenterName) {
  if (!isMonday(dateStr)) { logAction(getSpreadsheet(), 'indicoError', 'Refused to create event for non-Monday: ' + dateStr); return ''; }
  var session = getIndicoSession();
  if (!session) return '';

  // If event already exists, set contribution instead
  var existing = findIndicoUrlForDate(dateStr);
  if (existing) {
    setIndicoContribution(dateStr, presenterName);
    return existing;
  }

  try {
    var baseUrl = getIndicoBaseUrl();
    var categoryId = getIndicoCategoryId();
    var catId = parseInt(categoryId, 10);

    // Step 1: Fetch CSRF token from the create-meeting form page
    var csrfToken = fetchIndicoCsrfToken(baseUrl, categoryId, session);

    // Step 2: Build URL-encoded payload with duplicate keys for start_dt/end_dt
    var ddmmyyyy = formatDateDDMMYYYY(dateStr);

    var roomName = getIndicoRoomName();
    var locationData = {address: '', inheriting: false};
    if (roomName) locationData.room_name = roomName;

    var description = getIndicoDescription();

    var payload = 'event-creation-csrf_token=' + encodeURIComponent(csrfToken)
      + '&event-creation-create_booking=false'
      + '&event-creation-category=' + encodeURIComponent(JSON.stringify({id: catId, title: 'General'}))
      + '&event-creation-title=' + encodeURIComponent('RODEM HEP Weekly')
      + '&event-creation-description=' + encodeURIComponent(description)
      + '&event-creation-start_dt=' + encodeURIComponent(ddmmyyyy)
      + '&event-creation-start_dt=' + encodeURIComponent('15:00')
      + '&event-creation-end_dt=' + encodeURIComponent(ddmmyyyy)
      + '&event-creation-end_dt=' + encodeURIComponent('16:20')
      + '&event-creation-timezone=' + encodeURIComponent('Europe/Zurich')
      + '&event-creation-location_data=' + encodeURIComponent(JSON.stringify(locationData))
      + '&event-creation-protection_mode=inheriting';

    var res = UrlFetchApp.fetch(baseUrl + '/event/create/meeting', {
      method: 'post',
      contentType: 'application/x-www-form-urlencoded',
      headers: {
        'Cookie': 'indico_session=' + session,
        'X-Requested-With': 'XMLHttpRequest'
      },
      payload: payload,
      muteHttpExceptions: true,
      followRedirects: false
    });

    var code = res.getResponseCode();
    var body = res.getContentText();

    clearIndicoCache();

    logAction(getSpreadsheet(), 'indicoCreate', 'Created event for ' + dateStr + ' (HTTP ' + code + ')');

    // Try to extract URL from JSON response
    var createdUrl = '';
    try {
      var json = JSON.parse(body);
      // Response is e.g. {"redirect":"/event/2091/manage/","success":true}
      var rawUrl = json.url || json.redirect || '';
      if (rawUrl) {
        // Strip /manage/ suffix to get the public event URL
        rawUrl = rawUrl.replace(/\/manage\/?$/, '/');
        // Prepend base URL if relative
        if (rawUrl.charAt(0) === '/') rawUrl = baseUrl + rawUrl;
        createdUrl = rawUrl;
      }
    } catch (e) {}

    // Check redirect location header
    if (!createdUrl) {
      var resHeaders = res.getHeaders();
      if (resHeaders && resHeaders['Location']) {
        var loc = resHeaders['Location'];
        if (loc.charAt(0) === '/') loc = baseUrl + loc;
        createdUrl = loc.replace(/\/manage\/?$/, '/');
      }
    }

    // Fallback: look up the newly created event from the category
    if (!createdUrl) {
      createdUrl = findIndicoUrlForDate(dateStr) || '';
    }

    // Add contribution with presenter name on the newly created event
    if (createdUrl && presenterName) {
      try {
        var newEventId = extractIndicoEventId(createdUrl);
        if (newEventId) addIndicoContributionToEvent(baseUrl, newEventId, dateStr, presenterName, session);
      } catch (e) { indicoFailureNotification('update', dateStr, e.message); }
    }

    return createdUrl;
  } catch (e) {
    indicoFailureNotification('create', dateStr, e.message);
    return '';
  }
}

/**
 * Delete an Indico event for a given date.
 * No-op if no event exists. Never throws.
 */
function deleteIndicoEvent(dateStr) {
  if (!isMonday(dateStr)) { logAction(getSpreadsheet(), 'indicoError', 'Refused to delete event for non-Monday: ' + dateStr); return; }
  var session = getIndicoSession();
  if (!session) return;

  var url = findIndicoUrlForDate(dateStr);
  if (!url) return;

  var eventId = extractIndicoEventId(url);
  if (!eventId) return;

  try {
    var baseUrl = getIndicoBaseUrl();

    // Fetch CSRF token from the delete confirmation page
    var csrfToken = fetchIndicoManageCsrfToken(baseUrl, '/event/' + eventId + '/manage/delete', session);

    var payload = 'csrf_token=' + encodeURIComponent(csrfToken)
      + '&confirm_delete=true';

    UrlFetchApp.fetch(baseUrl + '/event/' + eventId + '/manage/delete', {
      method: 'post',
      contentType: 'application/x-www-form-urlencoded',
      headers: {
        'Cookie': 'indico_session=' + session,
        'X-Requested-With': 'XMLHttpRequest'
      },
      payload: payload,
      muteHttpExceptions: true,
      followRedirects: false
    });

    clearIndicoCache();
    logAction(getSpreadsheet(), 'indicoDelete', 'Deleted event for ' + dateStr + ' (event ' + eventId + ')');
  } catch (e) {
    indicoFailureNotification('delete', dateStr, e.message);
  }
}

/**
 * Add a contribution to an Indico event's timetable.
 * Low-level: requires eventId, dateStr (YYYY-MM-DD), and active session.
 * Returns true on success.
 */
function addIndicoContributionToEvent(baseUrl, eventId, dateStr, presenterName, session) {
  // Indico timetable expects day as YYYY/MM/DD query param
  var dayParam = dateStr.replace(/-/g, '/');

  var csrfToken = fetchIndicoManageCsrfToken(baseUrl, '/event/' + eventId + '/manage/timetable/', session);

  var roomName = getIndicoRoomName();
  var locationData = {address: '', inheriting: true};
  if (roomName) locationData.room_name = roomName;

  var personLinkData = JSON.stringify([{
    firstName: '',
    familyName: presenterName,
    email: '',
    affiliation: '',
    phone: '',
    title: '',
    name: presenterName,
    displayOrder: 0,
    isSpeaker: true,
    isSubmitter: true,
    authorType: 0
  }]);

  var payload = 'csrf_token=' + encodeURIComponent(csrfToken)
    + '&title=' + encodeURIComponent(presenterName)
    + '&description='
    + '&time=' + encodeURIComponent('15:00')
    + '&duration=' + encodeURIComponent('20')
    + '&duration=' + encodeURIComponent('minutes')
    + '&person_link_data=' + encodeURIComponent(personLinkData)
    + '&location_data=' + encodeURIComponent(JSON.stringify(locationData))
    + '&references=' + encodeURIComponent('[]')
    + '&board_number='
    + '&code=';

  var res = UrlFetchApp.fetch(baseUrl + '/event/' + eventId + '/manage/timetable/add-contribution?day=' + encodeURIComponent(dayParam), {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    headers: {
      'Cookie': 'indico_session=' + session,
      'X-Requested-With': 'XMLHttpRequest'
    },
    payload: payload,
    muteHttpExceptions: true,
    followRedirects: false
  });

  return res.getResponseCode() >= 200 && res.getResponseCode() < 400;
}

/**
 * Remove all timetable contributions from an Indico event.
 * Fetches the event via the export API to get contribution IDs, then deletes each.
 */
function clearIndicoContributions(baseUrl, eventId, session) {
  var token = getIndicoApiToken();
  if (!token) return;

  try {
    var res = UrlFetchApp.fetch(baseUrl + '/export/event/' + eventId + '.json?detail=contributions&ak=' + token, {
      muteHttpExceptions: true
    });

    if (res.getResponseCode() !== 200) return;

    var json = JSON.parse(res.getContentText());
    var results = json.results || [];
    if (results.length === 0) return;

    var contribs = results[0].contributions || [];
    for (var i = 0; i < contribs.length; i++) {
      var contribId = contribs[i].id;
      if (!contribId) continue;

      var csrfToken = fetchIndicoManageCsrfToken(baseUrl, '/event/' + eventId + '/manage/contributions/' + contribId + '/', session);

      UrlFetchApp.fetch(baseUrl + '/event/' + eventId + '/manage/contributions/' + contribId + '/', {
        method: 'delete',
        headers: {
          'Cookie': 'indico_session=' + session,
          'X-CSRF-Token': csrfToken,
          'X-Requested-With': 'XMLHttpRequest'
        },
        muteHttpExceptions: true,
        followRedirects: false
      });

      Utilities.sleep(300);
    }
  } catch (e) {
    // Best-effort: if clearing fails, we still add the new contribution
  }
}

/**
 * Set the contribution on an Indico event for a given date.
 * Clears existing contributions first (for swaps/replacements), then adds new one.
 * If no event exists, creates one instead. Never throws.
 */
function setIndicoContribution(dateStr, presenterName) {
  if (!isMonday(dateStr)) { logAction(getSpreadsheet(), 'indicoError', 'Refused to set contribution for non-Monday: ' + dateStr); return; }
  var session = getIndicoSession();
  if (!session) return;

  var url = findIndicoUrlForDate(dateStr);
  if (!url) {
    createIndicoEvent(dateStr, presenterName);
    return;
  }

  var eventId = extractIndicoEventId(url);
  if (!eventId) return;

  try {
    var baseUrl = getIndicoBaseUrl();

    clearIndicoContributions(baseUrl, eventId, session);
    addIndicoContributionToEvent(baseUrl, eventId, dateStr, presenterName, session);

    clearIndicoCache();
    logAction(getSpreadsheet(), 'indicoUpdate', 'Set contribution for ' + dateStr + ' to ' + presenterName);
  } catch (e) {
    indicoFailureNotification('update', dateStr, e.message);
  }
}

/**
 * Bulk-create Indico events for a new semester schedule.
 * Skips holidays, buffers, and dates with existing events.
 * Never throws.
 */
function bulkCreateIndicoEvents(scheduleRows) {
  var session = getIndicoSession();
  if (!session) return;

  var created = 0;
  var total = 0;

  for (var i = 0; i < scheduleRows.length; i++) {
    var entry = scheduleRows[i];
    var status = entry.status || '';
    var presenter = entry.presenter || '';
    var date = entry.date || '';

    if (!date || !presenter || status === 'Holiday' || status === 'Buffer') continue;
    total++;

    // Skip if event already exists
    if (findIndicoUrlForDate(date)) continue;

    try {
      createIndicoEvent(date, presenter);
      created++;
    } catch (e) {
      indicoFailureNotification('bulk-create', date, e.message);
    }

    // Rate limiting
    Utilities.sleep(500);
  }

  logAction(getSpreadsheet(), 'indicoBulkCreate', 'Created ' + created + '/' + total + ' Indico events for semester');
}

/**
 * Test function — run manually from Apps Script editor to verify Indico event creation.
 * Creates a test event for a date far in the future, then logs the result.
 */
function testIndicoLogin() {
  var baseUrl = getIndicoBaseUrl();
  Logger.log('=== Indico Login Test ===');
  Logger.log('Username: ' + (getIndicoUsername() || '(not set)'));
  Logger.log('Password: ' + (getIndicoPassword() ? 'set' : '(not set)'));

  // POST directly with all-zeros CSRF + _provider=indico
  var loginPayload = 'csrf_token=00000000-0000-0000-0000-000000000000'
    + '&_provider=indico'
    + '&identifier=' + encodeURIComponent(getIndicoUsername())
    + '&password=' + encodeURIComponent(getIndicoPassword());

  var loginRes = UrlFetchApp.fetch(baseUrl + '/login/', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: loginPayload,
    muteHttpExceptions: true,
    followRedirects: false
  });

  Logger.log('POST /login/ HTTP ' + loginRes.getResponseCode());
  Logger.log('Location: ' + (loginRes.getHeaders()['Location'] || '(none)'));
  Logger.log('Set-Cookie: ' + JSON.stringify(loginRes.getAllHeaders()['Set-Cookie']));

  var session = extractSessionCookie(loginRes);
  if (session) {
    Logger.log('Session: ' + session.substring(0, 20) + '... (' + session.length + ' chars)');
    Logger.log('SUCCESS');

    // Verify the session works
    var categoryId = getIndicoCategoryId();
    var csrfToken = fetchIndicoCsrfToken(baseUrl, categoryId, session);
    Logger.log('Create page CSRF: ' + (csrfToken ? csrfToken.substring(0, 20) + '...' : 'EMPTY'));
  } else {
    Logger.log('FAILED — no session cookie');
    Logger.log('Response body (first 2000): ' + loginRes.getContentText().substring(0, 2000));
  }
}

/**
 * One-off utility: add contributions to all existing Indico events
 * from the current Schedule sheet. Run manually from Apps Script editor.
 * Does not modify the schedule — only updates Indico event timetables.
 */
function backfillIndicoContributions() {
  var ss = getSpreadsheet();
  var schedule = readSchedule(ss);
  var updated = 0;
  var skipped = 0;

  for (var i = 0; i < schedule.length; i++) {
    var entry = schedule[i];
    if (!entry.presenter || entry.status === 'Holiday' || entry.status === 'Buffer') {
      skipped++;
      continue;
    }

    try {
      setIndicoContribution(entry.date, entry.presenter);
      updated++;
      Logger.log('Added contribution for ' + entry.date + ': ' + entry.presenter);
    } catch (e) {
      Logger.log('Failed for ' + entry.date + ': ' + e.message);
    }

    // Rate limiting — extra time since each call fetches event, clears, and adds
    Utilities.sleep(1000);
  }

  Logger.log('Done. Updated: ' + updated + ', Skipped: ' + skipped);
  logAction(ss, 'backfillContributions', 'Added contributions to ' + updated + ' Indico events');
}

/**
 * Update the description on an existing Indico event.
 * Uses the event settings form at /event/{id}/manage/.
 */
function updateIndicoDescription(dateStr, description) {
  if (!isMonday(dateStr)) { logAction(getSpreadsheet(), 'indicoError', 'Refused to update description for non-Monday: ' + dateStr); return; }
  var session = getIndicoSession();
  if (!session) return;

  var url = findIndicoUrlForDate(dateStr);
  if (!url) return;

  var eventId = extractIndicoEventId(url);
  if (!eventId) return;

  try {
    var baseUrl = getIndicoBaseUrl();
    var csrfToken = fetchIndicoManageCsrfToken(baseUrl, '/event/' + eventId + '/manage/', session);

    var payload = 'csrf_token=' + encodeURIComponent(csrfToken)
      + '&title=' + encodeURIComponent('RODEM HEP Weekly')
      + '&description=' + encodeURIComponent(description)
      + '&url_shortcut=';

    UrlFetchApp.fetch(baseUrl + '/event/' + eventId + '/manage/settings/data', {
      method: 'post',
      contentType: 'application/x-www-form-urlencoded',
      headers: {
        'Cookie': 'indico_session=' + session,
        'X-Requested-With': 'XMLHttpRequest'
      },
      payload: payload,
      muteHttpExceptions: true,
      followRedirects: false
    });

    logAction(getSpreadsheet(), 'indicoUpdate', 'Updated description for ' + dateStr);
  } catch (e) {
    indicoFailureNotification('update', dateStr, e.message);
  }
}

/**
 * One-off utility: set the description on all existing Indico events.
 * Uses the INDICO_DESCRIPTION Script Property. Run manually from Apps Script editor.
 * Iterates over Indico events directly (not the schedule) to include past events.
 */
function backfillIndicoDescriptions() {
  var description = getIndicoDescription();
  if (!description) {
    Logger.log('No INDICO_DESCRIPTION set in Script Properties. Aborting.');
    return;
  }

  var session = getIndicoSession();
  if (!session) { Logger.log('No session'); return; }

  var baseUrl = getIndicoBaseUrl();
  clearIndicoCache();
  var events = fetchIndicoEvents();
  Logger.log('Found ' + events.length + ' Indico events');

  var updated = 0;

  for (var i = 0; i < events.length; i++) {
    if (!isMonday(events[i].date)) {
      Logger.log('Skipping non-Monday: ' + events[i].date);
      continue;
    }
    var eventId = extractIndicoEventId(events[i].url);
    if (!eventId) continue;

    try {
      var csrfToken = fetchIndicoManageCsrfToken(baseUrl, '/event/' + eventId + '/manage/', session);

      var payload = 'csrf_token=' + encodeURIComponent(csrfToken)
        + '&title=' + encodeURIComponent('RODEM HEP Weekly')
        + '&description=' + encodeURIComponent(description)
        + '&url_shortcut=';

      UrlFetchApp.fetch(baseUrl + '/event/' + eventId + '/manage/settings/data', {
        method: 'post',
        contentType: 'application/x-www-form-urlencoded',
        headers: {
          'Cookie': 'indico_session=' + session,
          'X-Requested-With': 'XMLHttpRequest'
        },
        payload: payload,
        muteHttpExceptions: true,
        followRedirects: false
      });

      updated++;
      Logger.log('Updated description for ' + events[i].date + ' (event ' + eventId + ')');
    } catch (e) {
      Logger.log('Failed for ' + events[i].date + ': ' + e.message);
    }

    Utilities.sleep(1000);
  }

  Logger.log('Done. Updated: ' + updated + ' of ' + events.length + ' events');
  logAction(getSpreadsheet(), 'backfillDescriptions', 'Updated descriptions on ' + updated + ' Indico events');
}

function testIndicoCreate() {
  Logger.log('=== Indico Create Test ===');

  var session = getIndicoSession();
  if (!session) {
    Logger.log('No session — run testIndicoLogin() first to debug');
    return;
  }
  Logger.log('Session: OK');

  var url = createIndicoEvent('2026-12-28', 'Test Person');
  Logger.log('Created event URL: ' + (url || '(empty)'));
  Logger.log('Check your Indico category for a "RODEM HEP Weekly" event on 2026-12-28');
}

// ============================================================
// HTTP Handlers
// ============================================================

function doGet(e) {
  var secret = (e.parameter && e.parameter.secret) || '';
  if (secret !== getSecret()) {
    return jsonResponse({ success: false, error: 'Unauthorized' });
  }

  var ss = getSpreadsheet();
  var schedule = readSchedule(ss);
  var members = readMembers(ss);
  var optOuts = readOptOuts(ss);
  var archive = readArchive(ss);
  var pollResponses = readPollResponses(ss);
  var indicoEvents = fetchIndicoEvents();

  return jsonResponse({
    success: true,
    schedule: schedule,
    members: members,
    optOuts: optOuts,
    archive: archive,
    pollResponses: pollResponses,
    indicoEvents: indicoEvents
  });
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ success: false, error: 'Invalid JSON body' });
  }

  if (body.secret !== getSecret()) {
    return jsonResponse({ success: false, error: 'Unauthorized' });
  }

  var action = body.action;
  var lock = LockService.getScriptLock();

  try {
    lock.waitLock(10000);
  } catch (err) {
    return jsonResponse({ success: false, error: 'Could not acquire lock. Try again.' });
  }

  var result;
  try {
    switch (action) {
      case 'volunteer':
        result = handleVolunteer(body);
        break;
      case 'optOut':
        result = handleOptOut(body);
        break;
      case 'swap':
        result = handleSwap(body);
        break;
      case 'assignRandom':
        result = handleAssignRandom(body);
        break;
      case 'assignToDate':
        result = handleAssignToDate(body);
        break;
      case 'updateCredits':
        result = handleUpdateCredits(body);
        break;
      case 'emergencyCancel':
        result = handleEmergencyCancel(body);
        break;
      case 'submitPoll':
        result = handleSubmitPoll(body);
        break;
      case 'archiveAndSave':
        result = handleArchiveAndSave(body);
        break;
      default:
        result = { success: false, error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { success: false, error: err.message };
  } finally {
    lock.releaseLock();
  }

  // --- Slack notifications (post-lock, errors never affect result) ---
  if (result && result.success) {
    try {
      var ss = getSpreadsheet();
      switch (action) {
        case 'volunteer':
          notifyChannelReassignment(body.date, body.name, body.name + ' volunteered');
          notifyPresenterAssignment(ss, body.name, body.date, 'signed up to present');
          break;
        case 'optOut':
          if (result.autoAssigned) {
            notifyChannelReassignment(body.date, result.autoAssigned,
              body.name + ' opted out \u2192 ' + result.autoAssigned + ' auto-assigned');
            notifyPresenterAssignment(ss, result.autoAssigned, body.date,
              'auto-assigned as replacement for ' + body.name);
          }
          break;
        case 'swap':
          notifyChannelReassignment(body.date1, body.member2,
            'Swap: ' + body.member1 + ' \u2194 ' + body.member2);
          notifyPresenterAssignment(ss, body.member1, body.date2, 'swapped to present');
          notifyPresenterAssignment(ss, body.member2, body.date1, 'swapped to present');
          break;
        case 'assignRandom':
          notifyChannelReassignment(body.date, body.name, body.name + ' randomly assigned');
          notifyPresenterAssignment(ss, body.name, body.date, 'randomly assigned to present');
          break;
        case 'assignToDate':
          notifyChannelReassignment(body.date, body.name, body.name + ' assigned by organizer');
          notifyPresenterAssignment(ss, body.name, body.date, 'assigned to present');
          break;
        case 'emergencyCancel':
          notifyChannelReassignment(body.date, null,
            body.name + ' emergency-cancelled; meeting cancelled');
          break;
      }
    } catch (notifyErr) {
      try { logAction(getSpreadsheet(), 'notificationError', notifyErr.message); } catch (ignored) {}
    }
  }

  return jsonResponse(result);
}

// ============================================================
// Action Handlers
// ============================================================

function handleVolunteer(body) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('Schedule');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var dateCol = headers.indexOf('Date');
  var presCol = headers.indexOf('Presenter');
  var typeCol = headers.indexOf('Type');
  var topicCol = headers.indexOf('Topic');
  var abstractCol = headers.indexOf('Abstract');
  var statusCol = headers.indexOf('Status');

  var targetDate = body.date;
  var rowIndex = findRowByDate(data, dateCol, targetDate);

  if (rowIndex === -1) {
    return { success: false, error: 'Date not found in schedule: ' + targetDate };
  }

  var currentPresenter = data[rowIndex - 1][presCol] || '';
  var currentStatus = (data[rowIndex - 1][statusCol] || '').toString();
  var reversedCancellation = (currentStatus === 'Cancelled');

  // Add as additional presenter if slot already has someone (and isn't empty/cancelled/buffer)
  var newPresenter;
  if (currentPresenter && currentStatus !== 'Empty' && currentStatus !== 'Cancelled' && currentStatus !== 'Buffer') {
    newPresenter = currentPresenter + ' & ' + body.name;
  } else {
    newPresenter = body.name;
  }

  sheet.getRange(rowIndex, presCol + 1).setValue(newPresenter);
  sheet.getRange(rowIndex, typeCol + 1).setValue(body.type || '');
  sheet.getRange(rowIndex, topicCol + 1).setValue(body.topic || '');
  sheet.getRange(rowIndex, abstractCol + 1).setValue(body.abstract || '');
  sheet.getRange(rowIndex, statusCol + 1).setValue('Volunteered');

  var logMsg = body.name + ' volunteered for ' + targetDate + ': ' + (body.topic || '');
  if (reversedCancellation) {
    logMsg += ' (reversed auto-cancellation)';
  }
  logAction(ss, 'volunteer', logMsg);

  // Auto-create/update Indico event
  try { createIndicoEvent(targetDate, body.name); }
  catch (e) { indicoFailureNotification('create', targetDate, e.message); }

  return { success: true, reversedCancellation: reversedCancellation };
}

function handleOptOut(body) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('Schedule');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var dateCol = headers.indexOf('Date');
  var presCol = headers.indexOf('Presenter');
  var statusCol = headers.indexOf('Status');

  var targetDate = body.date;

  // Enforce 6-day deadline
  var meetingDate = new Date(targetDate + 'T00:00:00');
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var daysUntil = Math.round((meetingDate - today) / 86400000);
  if (daysUntil < OPT_OUT_DEADLINE_DAYS) {
    return { success: false, error: 'Opt-out deadline has passed (' + OPT_OUT_DEADLINE_DAYS + ' days before). Try swapping instead, or contact Pradyun.' };
  }

  var rowIndex = findRowByDate(data, dateCol, targetDate);
  if (rowIndex === -1) {
    return { success: false, error: 'Date not found in schedule: ' + targetDate };
  }

  var currentPresenter = (data[rowIndex - 1][presCol] || '').toString();
  var presenters = currentPresenter.split(/[,&]/).map(function(s) { return s.trim(); }).filter(Boolean);
  var remaining = presenters.filter(function(p) { return p !== body.name; });

  if (remaining.length > 0) {
    sheet.getRange(rowIndex, presCol + 1).setValue(remaining.join(' & '));
  } else {
    sheet.getRange(rowIndex, presCol + 1).setValue('');
    sheet.getRange(rowIndex, statusCol + 1).setValue('Empty');
  }

  // Log opt-out
  var optOutSheet = ss.getSheetByName('OptOuts');
  optOutSheet.appendRow([new Date(), body.name, targetDate, body.reason || '']);

  // Try to move the member to the next available buffer week
  var movedToBuffer = null;
  if (remaining.length === 0) {
    movedToBuffer = moveToNextBuffer(ss, sheet, data, headers, targetDate, body.name);
  }

  // Auto-assign a random replacement speaker
  var autoAssigned = null;
  if (remaining.length === 0) {
    var picked = pickRandomSpeakerForDate(ss, data, headers, targetDate, [body.name]);
    if (picked) {
      sheet.getRange(rowIndex, presCol + 1).setValue(picked);
      sheet.getRange(rowIndex, statusCol + 1).setValue('TBD');
      autoAssigned = picked;
      logAction(ss, 'autoAssignRandom', picked + ' auto-assigned to ' + targetDate + ' (replacing ' + body.name + ')');
    }
  }

  var logMsg = body.name + ' opted out of ' + targetDate;
  if (body.reason) logMsg += ': ' + body.reason;
  if (movedToBuffer) logMsg += ' (moved to buffer: ' + movedToBuffer + ')';
  if (autoAssigned) logMsg += ' (auto-assigned: ' + autoAssigned + ')';
  logAction(ss, 'optOut', logMsg);

  // Auto-update/delete Indico event
  try {
    if (autoAssigned) {
      setIndicoContribution(targetDate, autoAssigned);
    } else if (remaining.length === 0) {
      deleteIndicoEvent(targetDate);
    }
  } catch (e) { indicoFailureNotification('update', targetDate, e.message); }

  return { success: true, movedToBuffer: movedToBuffer, autoAssigned: autoAssigned };
}

/**
 * Find the next buffer week after the given date and assign the member to it.
 * Returns the buffer date string if successful, null otherwise.
 */
function moveToNextBuffer(ss, sheet, data, headers, afterDate, memberName) {
  var dateCol = headers.indexOf('Date');
  var presCol = headers.indexOf('Presenter');
  var statusCol = headers.indexOf('Status');

  for (var i = 1; i < data.length; i++) {
    var cellDate = formatSheetDate(data[i][dateCol]);
    var cellStatus = (data[i][statusCol] || '').toString();
    var cellPresenter = (data[i][presCol] || '').toString();

    if (cellDate > afterDate && cellStatus === 'Buffer' && !cellPresenter) {
      var bufferRow = i + 1;
      sheet.getRange(bufferRow, presCol + 1).setValue(memberName);
      sheet.getRange(bufferRow, statusCol + 1).setValue('TBD');
      logAction(ss, 'bufferAssign', memberName + ' moved to buffer week ' + cellDate + ' (opted out of ' + afterDate + ')');
      return cellDate;
    }
  }
  return null;
}

function handleEmergencyCancel(body) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('Schedule');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var dateCol = headers.indexOf('Date');
  var presCol = headers.indexOf('Presenter');
  var statusCol = headers.indexOf('Status');

  var targetDate = body.date;

  var rowIndex = findRowByDate(data, dateCol, targetDate);
  if (rowIndex === -1) {
    return { success: false, error: 'Date not found in schedule: ' + targetDate };
  }

  var currentPresenter = (data[rowIndex - 1][presCol] || '').toString();
  var presenters = currentPresenter.split(/[,&]/).map(function(s) { return s.trim(); }).filter(Boolean);
  var remaining = presenters.filter(function(p) { return p !== body.name; });

  if (remaining.length > 0) {
    sheet.getRange(rowIndex, presCol + 1).setValue(remaining.join(' & '));
  } else {
    sheet.getRange(rowIndex, presCol + 1).setValue('');
    sheet.getRange(rowIndex, statusCol + 1).setValue('Cancelled');
  }

  // Log in OptOuts tab
  var optOutSheet = ss.getSheetByName('OptOuts');
  optOutSheet.appendRow([new Date(), body.name, targetDate, '(emergency) ' + (body.reason || '')]);

  // Try to move the member to the next available buffer week
  var movedToBuffer = null;
  if (remaining.length === 0) {
    movedToBuffer = moveToNextBuffer(ss, sheet, data, headers, targetDate, body.name);
  }

  var logMsg = body.name + ' emergency-cancelled ' + targetDate;
  if (body.reason) logMsg += ': ' + body.reason;
  if (movedToBuffer) logMsg += ' (moved to buffer: ' + movedToBuffer + ')';
  logAction(ss, 'emergencyCancel', logMsg);

  // Auto-delete Indico event
  if (remaining.length === 0) {
    try { deleteIndicoEvent(targetDate); }
    catch (e) { indicoFailureNotification('delete', targetDate, e.message); }
  }

  return { success: true, movedToBuffer: movedToBuffer };
}

function handleSwap(body) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('Schedule');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var dateCol = headers.indexOf('Date');
  var presCol = headers.indexOf('Presenter');
  var typeCol = headers.indexOf('Type');
  var topicCol = headers.indexOf('Topic');
  var abstractCol = headers.indexOf('Abstract');

  var row1 = findRowByDate(data, dateCol, body.date1);
  var row2 = findRowByDate(data, dateCol, body.date2);

  if (row1 === -1 || row2 === -1) {
    return { success: false, error: 'One or both dates not found.' };
  }

  var pres1 = (data[row1 - 1][presCol] || '').toString();
  var pres2 = (data[row2 - 1][presCol] || '').toString();

  var newPres1 = replaceMemberInList(pres1, body.member1, body.member2);
  var newPres2 = replaceMemberInList(pres2, body.member2, body.member1);

  sheet.getRange(row1, presCol + 1).setValue(newPres1);
  sheet.getRange(row2, presCol + 1).setValue(newPres2);

  var type1 = (data[row1 - 1][typeCol] || '').toString();
  var type2 = (data[row2 - 1][typeCol] || '').toString();
  var topic1 = (data[row1 - 1][topicCol] || '').toString();
  var topic2 = (data[row2 - 1][topicCol] || '').toString();
  var abstract1 = (data[row1 - 1][abstractCol] || '').toString();
  var abstract2 = (data[row2 - 1][abstractCol] || '').toString();

  sheet.getRange(row1, typeCol + 1).setValue(type2);
  sheet.getRange(row1, topicCol + 1).setValue(topic2);
  sheet.getRange(row1, abstractCol + 1).setValue(abstract2);
  sheet.getRange(row2, typeCol + 1).setValue(type1);
  sheet.getRange(row2, topicCol + 1).setValue(topic1);
  sheet.getRange(row2, abstractCol + 1).setValue(abstract1);

  logAction(ss, 'swap', body.member1 + ' (' + body.date1 + ') <-> ' + body.member2 + ' (' + body.date2 + ')');

  // Auto-update Indico events for both dates
  try {
    setIndicoContribution(body.date1, body.member2);
    setIndicoContribution(body.date2, body.member1);
  } catch (e) { indicoFailureNotification('update', body.date1 + '/' + body.date2, e.message); }

  return { success: true };
}

function handleAssignRandom(body) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('Schedule');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var dateCol = headers.indexOf('Date');
  var presCol = headers.indexOf('Presenter');
  var statusCol = headers.indexOf('Status');

  var targetDate = body.date;
  var rowIndex = findRowByDate(data, dateCol, targetDate);

  if (rowIndex === -1) {
    return { success: false, error: 'Date not found.' };
  }

  var currentPresenter = (data[rowIndex - 1][presCol] || '').toString();
  var currentStatus = (data[rowIndex - 1][statusCol] || '').toString();

  var newPresenter;
  if (currentPresenter && currentStatus !== 'Empty' && currentStatus !== 'Buffer' && currentStatus !== 'Cancelled') {
    newPresenter = currentPresenter + ' & ' + body.name;
  } else {
    newPresenter = body.name;
  }

  sheet.getRange(rowIndex, presCol + 1).setValue(newPresenter);
  sheet.getRange(rowIndex, statusCol + 1).setValue('TBD');

  logAction(ss, 'assignRandom', body.name + ' randomly assigned to ' + targetDate);

  // Auto-create/update Indico event
  try { createIndicoEvent(targetDate, body.name); }
  catch (e) { indicoFailureNotification('create', targetDate, e.message); }

  return { success: true };
}

function handleAssignToDate(body) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('Schedule');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var dateCol = headers.indexOf('Date');
  var presCol = headers.indexOf('Presenter');
  var typeCol = headers.indexOf('Type');
  var topicCol = headers.indexOf('Topic');
  var statusCol = headers.indexOf('Status');

  var targetDate = body.date;
  var rowIndex = findRowByDate(data, dateCol, targetDate);

  if (rowIndex === -1) {
    return { success: false, error: 'Date not found.' };
  }

  var currentPresenter = (data[rowIndex - 1][presCol] || '').toString();
  var currentStatus = (data[rowIndex - 1][statusCol] || '').toString();

  var newPresenter;
  if (currentPresenter && currentStatus !== 'Empty' && currentStatus !== 'Buffer' && currentStatus !== 'Cancelled') {
    newPresenter = currentPresenter + ' & ' + body.name;
  } else {
    newPresenter = body.name;
  }

  sheet.getRange(rowIndex, presCol + 1).setValue(newPresenter);
  sheet.getRange(rowIndex, statusCol + 1).setValue('Confirmed');
  if (body.type) sheet.getRange(rowIndex, typeCol + 1).setValue(body.type);
  if (body.topic) sheet.getRange(rowIndex, topicCol + 1).setValue(body.topic);

  logAction(ss, 'assignToDate', body.name + ' assigned to ' + targetDate + (body.type ? ' (' + body.type + ')' : ''));

  try { createIndicoEvent(targetDate, body.name); }
  catch (e) { indicoFailureNotification('create', targetDate, e.message); }

  return { success: true };
}

function handleUpdateCredits(body) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('Members');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var nameCol = headers.indexOf('Name');
  var creditsCol = headers.indexOf('Credits');

  var credits = body.credits || {};

  for (var i = 1; i < data.length; i++) {
    var memberName = data[i][nameCol];
    if (credits.hasOwnProperty(memberName)) {
      sheet.getRange(i + 1, creditsCol + 1).setValue(credits[memberName]);
    }
  }

  logAction(ss, 'updateCredits', 'Credits updated');

  return { success: true };
}

function handleSubmitPoll(body) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('PollResponses');

  sheet.appendRow([
    new Date(),
    body.name || '',
    body.unavailableDates || '',
    body.preferredDate || ''
  ]);

  logAction(ss, 'submitPoll', body.name + ' submitted availability poll');

  return { success: true };
}

function handleArchiveAndSave(body) {
  var ss = getSpreadsheet();
  var semesterLabel = body.semesterLabel || 'Unknown';
  var newSchedule = body.newSchedule || [];

  // Step 1: archive current schedule
  var schedSheet = ss.getSheetByName('Schedule');
  var schedData = schedSheet.getDataRange().getValues();
  var archiveSheet = ss.getSheetByName('Archive');

  for (var i = 1; i < schedData.length; i++) {
    var row = schedData[i];
    var dateVal = row[1]; // Date column
    if (dateVal instanceof Date) {
      dateVal = formatSheetDate(dateVal);
    }
    archiveSheet.appendRow([
      semesterLabel,
      row[0],  // Week
      dateVal,
      row[2],  // Presenter
      row[3],  // Type
      row[4],  // Topic
      row[5],  // Abstract
      row[6]   // Status
    ]);
  }

  // Step 2: clear current schedule and write new one
  schedSheet.clearContents();
  schedSheet.appendRow(['Week', 'Date', 'Presenter', 'Type', 'Topic', 'Abstract', 'Status']);

  if (newSchedule.length > 0) {
    var rows = newSchedule.map(function(entry) {
      return [
        entry.week || '',
        entry.date || '',
        entry.presenter || '',
        entry.type || '',
        entry.topic || '',
        entry.abstract || '',
        entry.status || 'TBD'
      ];
    });
    schedSheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }

  // Step 3: clear poll responses (consumed)
  var pollSheet = ss.getSheetByName('PollResponses');
  pollSheet.clearContents();
  pollSheet.appendRow(['Timestamp', 'Name', 'UnavailableDates', 'PreferredDate']);

  logAction(ss, 'archiveAndSave', 'Archived ' + semesterLabel + ', saved new schedule (' + newSchedule.length + ' weeks)');

  // Bulk-create Indico events for the new semester
  try { bulkCreateIndicoEvents(newSchedule); }
  catch (e) { indicoFailureNotification('bulk-create', 'semester', e.message); }

  return { success: true };
}

// ============================================================
// Time-Driven Triggers
// ============================================================

/**
 * Saturday auto-cancellation trigger.
 * Run as a time-driven trigger every Saturday at midnight CET.
 * Checks the coming Monday — if a slot is empty, marks it as 'Cancelled'.
 *
 * To set up:
 *   1. In Apps Script, go to Triggers (clock icon)
 *   2. Add trigger: checkSaturdayCancellation, Time-driven, Week timer, Every Saturday, Midnight to 1am
 */
function checkSaturdayCancellation() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('Schedule');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var dateCol = headers.indexOf('Date');
  var presCol = headers.indexOf('Presenter');
  var statusCol = headers.indexOf('Status');

  // Find the coming Monday (Saturday + 2 days)
  var today = new Date();
  var monday = new Date(today);
  monday.setDate(monday.getDate() + 2);
  var mondayStr = formatSheetDate(monday);

  for (var i = 1; i < data.length; i++) {
    var cellDate = formatSheetDate(data[i][dateCol]);
    if (cellDate === mondayStr) {
      var presenter = (data[i][presCol] || '').toString().trim();
      var status = (data[i][statusCol] || '').toString().trim();

      // Cancel if empty (no presenter, or status is Empty/Buffer with no presenter)
      if (!presenter || status === 'Empty') {
        var rowIndex = i + 1;
        sheet.getRange(rowIndex, statusCol + 1).setValue('Cancelled');
        logAction(ss, 'autoCancellation', 'Meeting on ' + mondayStr + ' auto-cancelled (no speaker by Saturday deadline)');

        // Notify Slack
        try {
          notifyChannelAnnouncement(mondayStr, '', '', '', 'Cancelled', '');
        } catch (e) { /* logged inside notifyChannelAnnouncement */ }

        // Auto-delete Indico event
        try { deleteIndicoEvent(mondayStr); }
        catch (e) { /* logged inside deleteIndicoEvent */ }
      }
      break;
    }
  }
}

/**
 * Thursday midweek reminder trigger.
 * Posts the upcoming Monday's meeting details to #physics-general.
 *
 * To set up:
 *   1. In Apps Script, go to Triggers (clock icon)
 *   2. Add trigger: sendThursdayReminder, Time-driven, Week timer, Every Thursday, 9am to 10am
 */
function sendThursdayReminder() {
  try {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('Schedule');
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var dateCol = headers.indexOf('Date');
    var presCol = headers.indexOf('Presenter');
    var typeCol = headers.indexOf('Type');
    var topicCol = headers.indexOf('Topic');
    var statusCol = headers.indexOf('Status');

    // Compute next Monday from today
    var today = new Date();
    var dow = today.getDay(); // 0=Sun, 1=Mon, ..., 4=Thu
    var daysUntilMonday = (8 - dow) % 7;
    if (daysUntilMonday === 0) daysUntilMonday = 7; // if today is Monday, target next Monday
    var nextMonday = new Date(today);
    nextMonday.setDate(today.getDate() + daysUntilMonday);
    var mondayStr = formatSheetDate(nextMonday);

    for (var i = 1; i < data.length; i++) {
      var cellDate = formatSheetDate(data[i][dateCol]);
      if (cellDate === mondayStr) {
        var presenter = (data[i][presCol] || '').toString().trim();
        var type = (data[i][typeCol] || '').toString().trim();
        var topic = (data[i][topicCol] || '').toString().trim();
        var status = (data[i][statusCol] || '').toString().trim();

        var indicoUrl = findIndicoUrlForDate(mondayStr);
        notifyChannelAnnouncement(mondayStr, presenter, type, topic, status, indicoUrl);
        logAction(ss, 'thursdayReminder', 'Announced upcoming meeting for ' + mondayStr + ': ' + (presenter || status));
        break;
      }
    }
  } catch (e) {
    try { logAction(getSpreadsheet(), 'triggerError', 'sendThursdayReminder failed: ' + e.message); } catch (ignored) {}
  }
}

/**
 * Thursday presenter reminder trigger.
 * Sends a single DM to presenters whose talk is 11 days away (Thursday → next-next Monday).
 *
 * To set up:
 *   1. In Apps Script, go to Triggers (clock icon)
 *   2. Add trigger: sendPresenterReminder, Time-driven, Week timer, Every Thursday, 9am to 10am
 */
function sendPresenterReminder() {
  try {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName('Schedule');
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var dateCol = headers.indexOf('Date');
    var presCol = headers.indexOf('Presenter');
    var topicCol = headers.indexOf('Topic');
    var statusCol = headers.indexOf('Status');

    var today = new Date();
    today.setHours(0, 0, 0, 0);

    // Thursday + 11 days = Monday (the talk day, ~11 days notice)
    var targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() + 11);
    var targetStr = formatSheetDate(targetDate);

    for (var i = 1; i < data.length; i++) {
      var cellDate = formatSheetDate(data[i][dateCol]);
      if (cellDate === targetStr) {
        var presenter = (data[i][presCol] || '').toString().trim();
        var topic = (data[i][topicCol] || '').toString().trim();
        var status = (data[i][statusCol] || '').toString().trim();

        // Only remind for active assignments
        if (presenter && status !== 'Holiday' && status !== 'Buffer' && status !== 'Cancelled' && status !== 'Empty') {
          var names = presenter.split(/[,&]/).map(function(s) { return s.trim(); }).filter(Boolean);
          for (var n = 0; n < names.length; n++) {
            notifyPresenterReminder(ss, names[n], targetStr, 11, topic);
          }
          logAction(ss, 'presenterReminder', 'Sent reminder for ' + targetStr + ' (11 days away) to: ' + presenter);
        }
        break;
      }
    }
  } catch (e) {
    try { logAction(getSpreadsheet(), 'triggerError', 'sendPresenterReminder failed: ' + e.message); } catch (ignored) {}
  }
}

// ============================================================
// Data Readers
// ============================================================

function readSchedule(ss) {
  var sheet = ss.getSheetByName('Schedule');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var result = [];

  for (var i = 1; i < data.length; i++) {
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      var key = headers[j].toString().toLowerCase();
      var val = data[i][j];
      if (val instanceof Date) {
        val = formatSheetDate(val);
      }
      row[key] = val;
    }
    result.push(row);
  }

  return result;
}

function readMembers(ss) {
  var sheet = ss.getSheetByName('Members');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var result = [];

  for (var i = 1; i < data.length; i++) {
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      var key = headers[j].toString().toLowerCase().replace(/\s+/g, '');
      row[key] = data[i][j];
    }
    result.push(row);
  }

  return result;
}

function readOptOuts(ss) {
  var sheet = ss.getSheetByName('OptOuts');
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  var result = [];

  for (var i = 1; i < data.length; i++) {
    result.push({
      timestamp: data[i][0],
      name: data[i][1],
      date: formatSheetDate(data[i][2]),
      reason: data[i][3] || ''
    });
  }

  return result;
}

function readArchive(ss) {
  var sheet = ss.getSheetByName('Archive');
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  var result = [];

  for (var i = 1; i < data.length; i++) {
    result.push({
      semester: data[i][0] || '',
      week: data[i][1],
      date: formatSheetDate(data[i][2]),
      presenter: data[i][3] || '',
      type: data[i][4] || '',
      topic: data[i][5] || '',
      abstract: data[i][6] || '',
      status: data[i][7] || 'TBD'
    });
  }

  return result;
}

function readPollResponses(ss) {
  var sheet = ss.getSheetByName('PollResponses');
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  var result = [];

  for (var i = 1; i < data.length; i++) {
    result.push({
      timestamp: data[i][0],
      name: data[i][1] || '',
      unavailableDates: data[i][2] || '',
      preferredDate: formatSheetDate(data[i][3])
    });
  }

  return result;
}

// ============================================================
// Utilities
// ============================================================

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function logAction(ss, action, details) {
  var logSheet = ss.getSheetByName('Log');
  logSheet.appendRow([new Date(), action, details]);
}

function formatSheetDate(val) {
  if (val instanceof Date) {
    var y = val.getFullYear();
    var m = ('0' + (val.getMonth() + 1)).slice(-2);
    var d = ('0' + val.getDate()).slice(-2);
    return y + '-' + m + '-' + d;
  }
  return (val || '').toString().trim().substring(0, 10);
}

function replaceMemberInList(presenterStr, oldName, newName) {
  var parts = presenterStr.split(/[,&]/).map(function(s) { return s.trim(); }).filter(Boolean);
  var idx = parts.indexOf(oldName);
  if (idx >= 0) {
    parts[idx] = newName;
  }
  return parts.join(' & ');
}

/**
 * Pick a random speaker for a date, weighted by credits.
 * Excludes opt-outs, recent presenters, and explicitly excluded names.
 */
function pickRandomSpeakerForDate(ss, scheduleData, headers, targetDate, excludeNames) {
  var membSheet = ss.getSheetByName('Members');
  var membData = membSheet.getDataRange().getValues();
  var membHeaders = membData[0];
  var mNameCol = membHeaders.indexOf('Name');
  var mCreditsCol = membHeaders.indexOf('Credits');
  var mActiveCol = membHeaders.indexOf('Active');

  var members = [];
  var credits = {};
  for (var i = 1; i < membData.length; i++) {
    var name = (membData[i][mNameCol] || '').toString();
    var active = (membData[i][mActiveCol] || '').toString();
    if (name && active === 'Yes') {
      members.push(name);
      credits[name] = Number(membData[i][mCreditsCol]) || 0;
    }
  }

  // Read opt-outs for this date
  var optSheet = ss.getSheetByName('OptOuts');
  var optData = optSheet.getDataRange().getValues();
  var optedOut = [];
  for (var i = 1; i < optData.length; i++) {
    var optDate = formatSheetDate(optData[i][2]);
    if (optDate === targetDate) {
      optedOut.push((optData[i][1] || '').toString());
    }
  }

  // Find recent presenters (2 weeks back)
  var dateCol = headers.indexOf('Date');
  var presCol = headers.indexOf('Presenter');
  var statusCol = headers.indexOf('Status');

  var dateIndex = -1;
  for (var i = 1; i < scheduleData.length; i++) {
    if (formatSheetDate(scheduleData[i][dateCol]) === targetDate) {
      dateIndex = i;
      break;
    }
  }

  var recentPresenters = [];
  if (dateIndex > 0) {
    for (var i = Math.max(1, dateIndex - 2); i < dateIndex; i++) {
      var st = (scheduleData[i][statusCol] || '').toString();
      if (st !== 'Holiday' && st !== 'Buffer') {
        var pres = (scheduleData[i][presCol] || '').toString();
        var parts = pres.split(/[,&]/).map(function(s) { return s.trim(); }).filter(Boolean);
        recentPresenters = recentPresenters.concat(parts);
      }
    }
  }

  // Build eligible list
  var allExcluded = (excludeNames || []).concat(optedOut).concat(recentPresenters);
  var eligible = members.filter(function(m) {
    return allExcluded.indexOf(m) === -1;
  });

  if (eligible.length === 0) return null;

  // Weighted random pick
  var weights = eligible.map(function(m) { return Math.max(1, credits[m] || 0); });
  var totalWeight = weights.reduce(function(a, b) { return a + b; }, 0);

  var rand = Math.random() * totalWeight;
  for (var i = 0; i < eligible.length; i++) {
    rand -= weights[i];
    if (rand <= 0) return eligible[i];
  }
  return eligible[eligible.length - 1];
}

/**
 * Find a schedule row by date. Returns 1-indexed row number for Sheets, or -1.
 */
function findRowByDate(data, dateCol, targetDate) {
  for (var i = 1; i < data.length; i++) {
    var cellDate = formatSheetDate(data[i][dateCol]);
    if (cellDate === targetDate) {
      return i + 1;
    }
  }
  return -1;
}

// ============================================================
// Setup helpers
// ============================================================

function setupSheets() {
  _doSetup(false);
}

function resetAndSetupSheets() {
  _doSetup(true);
}

/**
 * Add SlackUserID column to an existing Members sheet.
 * Safe to run multiple times (idempotent).
 */
function addSlackUserIdColumn() {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('Members');
  if (!sheet) return;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (headers.indexOf('SlackUserID') !== -1) return; // already exists
  var nextCol = headers.length + 1;
  sheet.getRange(1, nextCol).setValue('SlackUserID');
  logAction(ss, 'setup', 'Added SlackUserID column to Members sheet');
}

function _doSetup(forceReset) {
  var ss = getSpreadsheet();

  // --- Schedule tab ---
  var schedSheet = _getOrCreateSheet(ss, 'Schedule');
  if (forceReset || schedSheet.getLastRow() <= 1) {
    schedSheet.clearContents();
    schedSheet.appendRow(['Week', 'Date', 'Presenter', 'Type', 'Topic', 'Abstract', 'Status']);
    var schedData = [
      [1,  '2026-03-30', 'Andreas',       '', '', '', 'TBD'],
      [2,  '2026-04-06', 'Easter Monday', '', '', '', 'Holiday'],
      [3,  '2026-04-13', 'Frank',          '', '', '', 'TBD'],
      [4,  '2026-04-20', 'Giovanni',      '', '', '', 'TBD'],
      [5,  '2026-04-27', 'Guillaume',     '', '', '', 'TBD'],
      [6,  '2026-05-04', 'Ivan',          '', '', '', 'TBD'],
      [7,  '2026-05-11', 'Jona',          '', '', '', 'TBD'],
      [8,  '2026-05-18', 'Matej',         '', '', '', 'TBD'],
      [9,  '2026-05-25', 'Whit Monday',   '', '', '', 'Holiday'],
      [10, '2026-06-01', '',              '', '', '', 'Buffer'],
      [11, '2026-06-08', 'Pradyun',       '', '', '', 'TBD'],
      [12, '2026-06-15', 'Stephen',       '', '', '', 'TBD'],
      [13, '2026-06-22', 'Theresa',       '', '', '', 'TBD'],
      [14, '2026-06-29', 'Vincent',       '', '', '', 'TBD'],
      [15, '2026-07-06', 'Andreas',       '', '', '', 'TBD'],
      [16, '2026-07-13', 'Frank',          '', '', '', 'TBD'],
      [17, '2026-07-20', 'Giovanni',      '', '', '', 'TBD'],
      [18, '2026-07-27', 'Guillaume',     '', '', '', 'TBD'],
      [19, '2026-08-03', '',              '', '', '', 'Buffer'],
      [20, '2026-08-10', 'Ivan',          '', '', '', 'TBD'],
      [21, '2026-08-17', 'Jona',          '', '', '', 'TBD'],
      [22, '2026-08-24', 'Matej',         '', '', '', 'TBD'],
      [23, '2026-08-31', 'Pradyun',       '', '', '', 'TBD'],
      [24, '2026-09-07', 'Stephen',       '', '', '', 'TBD'],
      [25, '2026-09-14', 'Theresa',       '', '', '', 'TBD'],
      [26, '2026-09-21', 'Vincent',       '', '', '', 'TBD'],
      [27, '2026-09-28', 'Andreas',       '', '', '', 'TBD']
    ];
    schedSheet.getRange(2, 1, schedData.length, schedData[0].length).setValues(schedData);
  }

  // --- Members tab ---
  var membSheet = _getOrCreateSheet(ss, 'Members');
  if (forceReset || membSheet.getLastRow() <= 1) {
    membSheet.clearContents();
    membSheet.appendRow(['Name', 'Email', 'Credits', 'LastPresented', 'TotalPresentations', 'Active', 'SlackUserID']);
    var membData = [
      ['Andreas',   '', 0, '', 0, 'Yes', ''],
      ['Frank',     '', 0, '', 0, 'Yes', ''],
      ['Giovanni',  '', 0, '', 0, 'Yes', ''],
      ['Guillaume', '', 0, '', 0, 'Yes', ''],
      ['Ivan',      '', 0, '', 0, 'Yes', ''],
      ['Jona',      '', 0, '', 0, 'Yes', ''],
      ['Matej',     '', 0, '', 0, 'Yes', ''],
      ['Pradyun',   '', 0, '', 0, 'Yes', ''],
      ['Stephen',   '', 0, '', 0, 'Yes', ''],
      ['Theresa',   '', 0, '', 0, 'Yes', ''],
      ['Vincent',   '', 0, '', 0, 'Yes', '']
    ];
    membSheet.getRange(2, 1, membData.length, membData[0].length).setValues(membData);
  }

  // --- OptOuts tab ---
  var optSheet = _getOrCreateSheet(ss, 'OptOuts');
  if (forceReset || optSheet.getLastRow() <= 1) {
    optSheet.clearContents();
    optSheet.appendRow(['Timestamp', 'Name', 'Date', 'Reason']);
  }

  // --- Log tab ---
  var logSheet = _getOrCreateSheet(ss, 'Log');
  if (forceReset || logSheet.getLastRow() <= 1) {
    logSheet.clearContents();
    logSheet.appendRow(['Timestamp', 'Action', 'Details']);
  }

  // --- PollResponses tab ---
  var pollSheet = _getOrCreateSheet(ss, 'PollResponses');
  if (forceReset || pollSheet.getLastRow() <= 1) {
    pollSheet.clearContents();
    pollSheet.appendRow(['Timestamp', 'Name', 'UnavailableDates', 'PreferredDate']);
  }

  // --- Archive tab ---
  var archiveSheet = _getOrCreateSheet(ss, 'Archive');
  if (forceReset || archiveSheet.getLastRow() <= 1) {
    archiveSheet.clearContents();
    archiveSheet.appendRow(['Semester', 'Week', 'Date', 'Presenter', 'Type', 'Topic', 'Abstract', 'Status']);
  }

  // Remove default Sheet1 if it exists and is empty
  var sheet1 = ss.getSheetByName('Sheet1');
  if (sheet1 && sheet1.getLastRow() <= 1) {
    try { ss.deleteSheet(sheet1); } catch(e) { /* ignore */ }
  }

  logAction(ss, 'setup', 'Sheets initialized' + (forceReset ? ' (reset)' : ''));
}

function _getOrCreateSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}
