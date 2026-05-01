// Configuration — fill in after deploying Google Apps Script
const CONFIG = {
  // Google Apps Script Web App URL (deploy as "Execute as: Me", "Who has access: Anyone")
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbwfeFLKqmky_6R7btAMikxGntux09EP3rUsv_XiqD90ncPmE6m0MfxuxjxyYPalGyHxwg/exec',

  // Shared secret for basic request authentication (must match Apps Script property 'SECRET')
  SECRET: 'my-secret-key-2026',

  // Meeting details
  MEETING_TIME: '15:00 CET',
  MEETING_DAY: 'Monday',

  // Current semester (6-month schedule cycle)
  // To start a new semester: update label, start, end, and HOLIDAYS
  SEMESTER: {
    label: 'Spring 2026',
    start: '2026-05-04',
    end: '2026-09-28'
  },

  // Geneva, Switzerland public holidays that fall on meeting Mondays
  // Update this array each semester. Only include dates within the semester range.
  HOLIDAYS: [
    { date: '2026-05-25', label: 'Whit Monday' }
  ],

  // Number of buffer weeks per semester (spread evenly through non-holiday dates)
  BUFFER_WEEKS: 2,

  // Opt-out deadline: must opt out at least this many days before the meeting
  // 6 days before Monday = by end of Tuesday of the prior week
  OPT_OUT_DEADLINE_DAYS: 6,

  // Members in round-robin order
  MEMBERS: [
    'Andrea', 'Andreas', 'Frank', 'Giovanni', 'Ivan',
    'Jona', 'Matej', 'Pradyun', 'Stephen', 'Theresa', 'Vincent'
  ],

  // Presentation types
  PRESENTATION_TYPES: [
    'Research Update',
    'Practice Talk',
    'Paper Discussion',
    'Problem-Solving',
    'Workshop/Tutorial',
    'Professional Development'
  ]
};

// Compute all Mondays in the semester range dynamically.
// No need to maintain a manual DATES array — just change SEMESTER.start/end.
CONFIG.DATES = (function() {
  var dates = [];
  var current = new Date(CONFIG.SEMESTER.start + 'T00:00:00');
  var end = new Date(CONFIG.SEMESTER.end + 'T00:00:00');
  // Ensure we start on a Monday (day 1)
  var dow = current.getDay();
  if (dow !== 1) current.setDate(current.getDate() + ((8 - dow) % 7));
  while (current <= end) {
    var y = current.getFullYear();
    var m = ('0' + (current.getMonth() + 1)).slice(-2);
    var d = ('0' + current.getDate()).slice(-2);
    dates.push(y + '-' + m + '-' + d);
    current.setDate(current.getDate() + 7);
  }
  return dates;
})();
