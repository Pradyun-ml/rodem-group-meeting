// Configuration — fill in after deploying Google Apps Script
const CONFIG = {
  // Google Apps Script Web App URL (deploy as "Execute as: Me", "Who has access: Anyone")
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbzxJCCLoNN0wWrKpgDfraX4pIF_SuZvUrPKMmGYuVQceh641IheUAd3cH88_kg3lWJQsQ/exec',

  // Shared secret for basic request authentication (must match Apps Script property 'SECRET')
  SECRET: 'my-secret-key-2026',

  // Indico category ID (optional — leave empty to disable)
  INDICO_CATEGORY_ID: '',

  // Meeting details
  MEETING_TIME: '15:00 CET',
  MEETING_DAY: 'Monday',
  SEMESTER_START: '2026-03-16',
  SEMESTER_END: '2026-06-29',

  // Members in round-robin order
  MEMBERS: [
    'Andreas', 'Frank', 'Giovanni', 'Guillaume', 'Ivan',
    'Jona', 'Matej', 'Pradyun', 'Stephen', 'Theresa', 'Vincent'
  ],

  // 16 verified Mondays: March 16 – June 29, 2026
  DATES: [
    '2026-03-16', '2026-03-23', '2026-03-30',
    '2026-04-06', '2026-04-13', '2026-04-20', '2026-04-27',
    '2026-05-04', '2026-05-11', '2026-05-18', '2026-05-25',
    '2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29'
  ],

  // Pre-computed round-robin schedule
  DEFAULT_SCHEDULE: [
    { week: 1, date: '2026-03-16', presenter: 'Andreas', type: '', topic: '', abstract: '', status: 'TBD' },
    { week: 2, date: '2026-03-23', presenter: 'Frank', type: '', topic: '', abstract: '', status: 'TBD' },
    { week: 3, date: '2026-03-30', presenter: 'Giovanni', type: '', topic: '', abstract: '', status: 'TBD' },
    { week: 4, date: '2026-04-06', presenter: 'Guillaume', type: '', topic: '', abstract: '', status: 'TBD' },
    { week: 5, date: '2026-04-13', presenter: 'Ivan', type: '', topic: '', abstract: '', status: 'TBD' },
    { week: 6, date: '2026-04-20', presenter: 'Jona', type: '', topic: '', abstract: '', status: 'TBD' },
    { week: 7, date: '2026-04-27', presenter: 'Matej', type: '', topic: '', abstract: '', status: 'TBD' },
    { week: 8, date: '2026-05-04', presenter: 'Pradyun', type: '', topic: '', abstract: '', status: 'TBD' },
    { week: 9, date: '2026-05-11', presenter: 'Stephen', type: '', topic: '', abstract: '', status: 'TBD' },
    { week: 10, date: '2026-05-18', presenter: 'Theresa', type: '', topic: '', abstract: '', status: 'TBD' },
    { week: 11, date: '2026-05-25', presenter: 'Vincent', type: '', topic: '', abstract: '', status: 'TBD' },
    { week: 12, date: '2026-06-01', presenter: 'Andreas', type: '', topic: '', abstract: '', status: 'TBD' },
    { week: 13, date: '2026-06-08', presenter: 'Frank', type: '', topic: '', abstract: '', status: 'TBD' },
    { week: 14, date: '2026-06-15', presenter: 'Giovanni', type: '', topic: '', abstract: '', status: 'TBD' },
    { week: 15, date: '2026-06-22', presenter: 'Guillaume', type: '', topic: '', abstract: '', status: 'TBD' },
    { week: 16, date: '2026-06-29', presenter: 'Ivan', type: '', topic: '', abstract: '', status: 'TBD' }
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
