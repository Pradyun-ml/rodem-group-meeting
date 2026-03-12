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
 *   INDICO_BASE_URL     — Indico instance URL (default: https://partphys-indico.unige.ch)
 *   INDICO_CATEGORY_ID  — Indico category ID (default: 19)
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

function getIndicoBaseUrl() {
  return PropertiesService.getScriptProperties().getProperty('INDICO_BASE_URL') || 'https://partphys-indico.unige.ch';
}

function getIndicoCategoryId() {
  return PropertiesService.getScriptProperties().getProperty('INDICO_CATEGORY_ID') || '19';
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

  var text = '\ud83d\udc4b Hi ' + memberName + '! Friendly reminder: you\'re scheduled to present at the RODEM HEP Weekly on *' + formattedDate + '* (' + daysAway + ' days from now).';
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
    var url = baseUrl + '/export/categ/' + categoryId + '.json?from=today&to=+90d';

    var res = UrlFetchApp.fetch(url, {
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    });

    var code = res.getResponseCode();
    if (code !== 200) {
      logAction(getSpreadsheet(), 'indicoError', 'Indico API returned HTTP ' + code);
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

  return { success: true, movedToBuffer: movedToBuffer };
}

function handleSwap(body) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('Schedule');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var dateCol = headers.indexOf('Date');
  var presCol = headers.indexOf('Presenter');

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

  logAction(ss, 'swap', body.member1 + ' (' + body.date1 + ') <-> ' + body.member2 + ' (' + body.date2 + ')');

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
      }
      break;
    }
  }
}

/**
 * Monday morning announcement trigger.
 * Posts the day's meeting details to #physics-general.
 *
 * To set up:
 *   1. In Apps Script, go to Triggers (clock icon)
 *   2. Add trigger: sendMondayAnnouncement, Time-driven, Week timer, Every Monday, 8am to 9am
 */
function sendMondayAnnouncement() {
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

    var todayStr = formatSheetDate(new Date());

    for (var i = 1; i < data.length; i++) {
      var cellDate = formatSheetDate(data[i][dateCol]);
      if (cellDate === todayStr) {
        var presenter = (data[i][presCol] || '').toString().trim();
        var type = (data[i][typeCol] || '').toString().trim();
        var topic = (data[i][topicCol] || '').toString().trim();
        var status = (data[i][statusCol] || '').toString().trim();

        var indicoUrl = findIndicoUrlForDate(todayStr);
        notifyChannelAnnouncement(todayStr, presenter, type, topic, status, indicoUrl);
        logAction(ss, 'mondayAnnouncement', 'Announced meeting for ' + todayStr + ': ' + (presenter || status));
        break;
      }
    }
  } catch (e) {
    try { logAction(getSpreadsheet(), 'triggerError', 'sendMondayAnnouncement failed: ' + e.message); } catch (ignored) {}
  }
}

/**
 * Daily presenter reminder trigger.
 * Sends DMs to presenters whose talks are 9 or 10 days away.
 *
 * To set up:
 *   1. In Apps Script, go to Triggers (clock icon)
 *   2. Add trigger: sendDailyPresenterReminder, Time-driven, Day timer, 9am to 10am
 */
function sendDailyPresenterReminder() {
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

    var reminderDays = [9, 10];

    for (var d = 0; d < reminderDays.length; d++) {
      var targetDate = new Date(today);
      targetDate.setDate(targetDate.getDate() + reminderDays[d]);
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
              notifyPresenterReminder(ss, names[n], targetStr, reminderDays[d], topic);
            }
            logAction(ss, 'presenterReminder', 'Sent reminder for ' + targetStr + ' (' + reminderDays[d] + ' days away) to: ' + presenter);
          }
          break;
        }
      }
    }
  } catch (e) {
    try { logAction(getSpreadsheet(), 'triggerError', 'sendDailyPresenterReminder failed: ' + e.message); } catch (ignored) {}
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
