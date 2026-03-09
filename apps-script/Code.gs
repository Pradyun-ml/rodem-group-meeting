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
 * Sheet tabs required: Schedule, Members, OptOuts, Log
 */

// ============================================================
// Configuration
// ============================================================

function getSecret() {
  return PropertiesService.getScriptProperties().getProperty('SECRET') || '';
}

function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
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

  return jsonResponse({
    success: true,
    schedule: schedule,
    members: members,
    optOuts: optOuts
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
      default:
        result = { success: false, error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { success: false, error: err.message };
  } finally {
    lock.releaseLock();
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
  var rowIndex = -1;

  for (var i = 1; i < data.length; i++) {
    var cellDate = formatSheetDate(data[i][dateCol]);
    if (cellDate === targetDate) {
      rowIndex = i + 1; // 1-indexed for Sheets
      break;
    }
  }

  if (rowIndex === -1) {
    return { success: false, error: 'Date not found in schedule: ' + targetDate };
  }

  var currentPresenter = data[rowIndex - 1][presCol] || '';
  var currentStatus = data[rowIndex - 1][statusCol] || '';

  // Add as additional presenter if someone is already assigned (and slot isn't empty)
  var newPresenter;
  if (currentPresenter && currentStatus !== 'Empty') {
    newPresenter = currentPresenter + ' & ' + body.name;
  } else {
    newPresenter = body.name;
  }

  sheet.getRange(rowIndex, presCol + 1).setValue(newPresenter);
  sheet.getRange(rowIndex, typeCol + 1).setValue(body.type || '');
  sheet.getRange(rowIndex, topicCol + 1).setValue(body.topic || '');
  sheet.getRange(rowIndex, abstractCol + 1).setValue(body.abstract || '');
  sheet.getRange(rowIndex, statusCol + 1).setValue('Volunteered');

  logAction(ss, 'volunteer', body.name + ' volunteered for ' + targetDate + ': ' + (body.topic || ''));

  return { success: true };
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
  var rowIndex = -1;

  for (var i = 1; i < data.length; i++) {
    var cellDate = formatSheetDate(data[i][dateCol]);
    if (cellDate === targetDate) {
      rowIndex = i + 1;
      break;
    }
  }

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

  logAction(ss, 'optOut', body.name + ' opted out of ' + targetDate + (body.reason ? ': ' + body.reason : ''));

  return { success: true };
}

function handleSwap(body) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName('Schedule');
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var dateCol = headers.indexOf('Date');
  var presCol = headers.indexOf('Presenter');

  var row1 = -1, row2 = -1;

  for (var i = 1; i < data.length; i++) {
    var cellDate = formatSheetDate(data[i][dateCol]);
    if (cellDate === body.date1) row1 = i + 1;
    if (cellDate === body.date2) row2 = i + 1;
  }

  if (row1 === -1 || row2 === -1) {
    return { success: false, error: 'One or both dates not found.' };
  }

  var pres1 = (data[row1 - 1][presCol] || '').toString();
  var pres2 = (data[row2 - 1][presCol] || '').toString();

  // Replace member1 with member2 in row1, and vice versa in row2
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
  var rowIndex = -1;

  for (var i = 1; i < data.length; i++) {
    var cellDate = formatSheetDate(data[i][dateCol]);
    if (cellDate === targetDate) {
      rowIndex = i + 1;
      break;
    }
  }

  if (rowIndex === -1) {
    return { success: false, error: 'Date not found.' };
  }

  var currentPresenter = (data[rowIndex - 1][presCol] || '').toString();
  var currentStatus = (data[rowIndex - 1][statusCol] || '').toString();

  var newPresenter;
  if (currentPresenter && currentStatus !== 'Empty') {
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

/**
 * Format a Date object or string to YYYY-MM-DD
 */
function formatSheetDate(val) {
  if (val instanceof Date) {
    var y = val.getFullYear();
    var m = ('0' + (val.getMonth() + 1)).slice(-2);
    var d = ('0' + val.getDate()).slice(-2);
    return y + '-' + m + '-' + d;
  }
  // Already a string
  return (val || '').toString().trim().substring(0, 10);
}

/**
 * Replace one member name with another in a presenter list string
 */
function replaceMemberInList(presenterStr, oldName, newName) {
  var parts = presenterStr.split(/[,&]/).map(function(s) { return s.trim(); }).filter(Boolean);
  var idx = parts.indexOf(oldName);
  if (idx >= 0) {
    parts[idx] = newName;
  }
  return parts.join(' & ');
}

// ============================================================
// Setup helpers
// ============================================================

/**
 * Safe setup — only fills tabs that have no data rows (skips if data exists).
 * Run this the first time.
 */
function setupSheets() {
  _doSetup(false);
}

/**
 * Force setup — clears ALL tabs and re-populates from scratch.
 * Use this if setupSheets didn't populate correctly, or to start over.
 * WARNING: this erases any existing schedule data.
 */
function resetAndSetupSheets() {
  _doSetup(true);
}

function _doSetup(forceReset) {
  var ss = getSpreadsheet();

  // --- Schedule tab ---
  var schedSheet = _getOrCreateSheet(ss, 'Schedule');
  if (forceReset || schedSheet.getLastRow() <= 1) {
    schedSheet.clearContents();
    schedSheet.appendRow(['Week', 'Date', 'Presenter', 'Type', 'Topic', 'Abstract', 'Status']);
    var schedData = [
      [1,  '2026-03-16', 'Andreas',   '', '', '', 'TBD'],
      [2,  '2026-03-23', 'Frank',     '', '', '', 'TBD'],
      [3,  '2026-03-30', 'Giovanni',  '', '', '', 'TBD'],
      [4,  '2026-04-06', 'Guillaume', '', '', '', 'TBD'],
      [5,  '2026-04-13', 'Ivan',      '', '', '', 'TBD'],
      [6,  '2026-04-20', 'Jona',      '', '', '', 'TBD'],
      [7,  '2026-04-27', 'Matej',     '', '', '', 'TBD'],
      [8,  '2026-05-04', 'Pradyun',   '', '', '', 'TBD'],
      [9,  '2026-05-11', 'Stephen',   '', '', '', 'TBD'],
      [10, '2026-05-18', 'Theresa',   '', '', '', 'TBD'],
      [11, '2026-05-25', 'Vincent',   '', '', '', 'TBD'],
      [12, '2026-06-01', 'Andreas',   '', '', '', 'TBD'],
      [13, '2026-06-08', 'Frank',     '', '', '', 'TBD'],
      [14, '2026-06-15', 'Giovanni',  '', '', '', 'TBD'],
      [15, '2026-06-22', 'Guillaume', '', '', '', 'TBD'],
      [16, '2026-06-29', 'Ivan',      '', '', '', 'TBD']
    ];
    schedSheet.getRange(2, 1, schedData.length, schedData[0].length).setValues(schedData);
  }

  // --- Members tab ---
  var membSheet = _getOrCreateSheet(ss, 'Members');
  if (forceReset || membSheet.getLastRow() <= 1) {
    membSheet.clearContents();
    membSheet.appendRow(['Name', 'Email', 'Credits', 'LastPresented', 'TotalPresentations', 'Active']);
    var membData = [
      ['Andreas',   '', 0, '', 0, 'Yes'],
      ['Frank',     '', 0, '', 0, 'Yes'],
      ['Giovanni',  '', 0, '', 0, 'Yes'],
      ['Guillaume', '', 0, '', 0, 'Yes'],
      ['Ivan',      '', 0, '', 0, 'Yes'],
      ['Jona',      '', 0, '', 0, 'Yes'],
      ['Matej',     '', 0, '', 0, 'Yes'],
      ['Pradyun',   '', 0, '', 0, 'Yes'],
      ['Stephen',   '', 0, '', 0, 'Yes'],
      ['Theresa',   '', 0, '', 0, 'Yes'],
      ['Vincent',   '', 0, '', 0, 'Yes']
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

  // Remove default Sheet1 if it exists and is empty
  var sheet1 = ss.getSheetByName('Sheet1');
  if (sheet1 && sheet1.getLastRow() <= 1) {
    try { ss.deleteSheet(sheet1); } catch(e) { /* ignore if it's the only sheet */ }
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
