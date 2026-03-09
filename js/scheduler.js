// Scheduling logic: fairness, credits, random assignment, schedule generation

const Scheduler = {
  /**
   * Calculate Jain's Fairness Index
   * J = (sum(xi))^2 / (n * sum(xi^2))
   */
  jainsIndex(values) {
    const n = values.length;
    if (n === 0) return 1;
    const sum = values.reduce((a, b) => a + b, 0);
    const sumSq = values.reduce((a, b) => a + b * b, 0);
    if (sumSq === 0) return 1;
    return (sum * sum) / (n * sumSq);
  },

  /**
   * Compute credits for all members based on schedule history.
   * Each week: non-presenting active members get +1; presenting resets to 0.
   * Skips Holiday and Buffer weeks.
   */
  computeCredits(schedule, members) {
    const credits = {};
    members.forEach(m => { credits[m] = 0; });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const pastWeeks = schedule.filter(s =>
      new Date(s.date + 'T00:00:00') <= today &&
      s.status !== 'Holiday' && s.status !== 'Buffer'
    );

    pastWeeks.forEach(week => {
      const presenters = Scheduler.parsePresenters(week.presenter);
      members.forEach(m => {
        if (presenters.includes(m)) {
          credits[m] = 0;
        } else {
          credits[m] += 1;
        }
      });
    });

    return credits;
  },

  /**
   * Parse presenter field — may contain multiple names separated by commas or '&'
   */
  parsePresenters(presenterStr) {
    if (!presenterStr) return [];
    return presenterStr
      .split(/[,&]/)
      .map(s => s.trim())
      .filter(Boolean);
  },

  /**
   * Check if a date is a configured holiday
   */
  isHoliday(dateStr) {
    return CONFIG.HOLIDAYS.some(h => h.date === dateStr);
  },

  /**
   * Get the holiday label for a date, or null
   */
  holidayLabel(dateStr) {
    const h = CONFIG.HOLIDAYS.find(h => h.date === dateStr);
    return h ? h.label : null;
  },

  /**
   * Check if opt-out is still allowed for a date (>= OPT_OUT_DEADLINE_DAYS away)
   */
  canOptOut(dateStr) {
    const meeting = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.round((meeting - today) / 86400000);
    return diffDays >= CONFIG.OPT_OUT_DEADLINE_DAYS;
  },

  /**
   * Days until a date
   */
  daysUntil(dateStr) {
    const target = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((target - today) / 86400000);
  },

  /**
   * Find the next available buffer week on or after a given date
   */
  findNextBuffer(schedule, afterDate) {
    return schedule.find(s =>
      s.date > afterDate &&
      s.status === 'Buffer' &&
      !s.presenter
    ) || null;
  },

  /**
   * Pick a random speaker for a date, weighted by credits.
   * Excludes opt-outs and recent presenters.
   */
  pickRandom(date, schedule, members, credits, optOuts) {
    const optedOut = (optOuts || [])
      .filter(o => o.date === date)
      .map(o => o.name);

    const weekEntry = schedule.find(s => s.date === date);
    const alreadyAssigned = weekEntry ? Scheduler.parsePresenters(weekEntry.presenter) : [];

    const dateIndex = schedule.findIndex(s => s.date === date);

    const recentPresenters = [];
    for (let i = Math.max(0, dateIndex - 2); i < dateIndex; i++) {
      if (schedule[i].status !== 'Holiday' && schedule[i].status !== 'Buffer') {
        recentPresenters.push(...Scheduler.parsePresenters(schedule[i].presenter));
      }
    }

    const eligible = members.filter(m =>
      !optedOut.includes(m) &&
      !alreadyAssigned.includes(m) &&
      !recentPresenters.includes(m)
    );

    if (eligible.length === 0) return null;

    const weights = eligible.map(m => Math.max(1, credits[m] || 0));
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    let rand = Math.random() * totalWeight;
    for (let i = 0; i < eligible.length; i++) {
      rand -= weights[i];
      if (rand <= 0) return eligible[i];
    }
    return eligible[eligible.length - 1];
  },

  /**
   * Get presentation counts per member
   */
  presentationCounts(schedule, members) {
    const counts = {};
    members.forEach(m => { counts[m] = 0; });
    schedule.forEach(week => {
      if (week.status === 'Holiday' || week.status === 'Buffer') return;
      Scheduler.parsePresenters(week.presenter).forEach(p => {
        if (counts.hasOwnProperty(p)) counts[p]++;
      });
    });
    return counts;
  },

  /**
   * Determine which Monday is current/next upcoming
   */
  currentOrNextDate(dates) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const d of dates) {
      const dt = new Date(d + 'T00:00:00');
      if (dt >= today) return d;
    }
    return null;
  },

  isPast(dateStr) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Date(dateStr + 'T00:00:00') < today;
  },

  isToday(dateStr) {
    const today = new Date();
    const d = new Date(dateStr + 'T00:00:00');
    return d.getFullYear() === today.getFullYear() &&
           d.getMonth() === today.getMonth() &&
           d.getDate() === today.getDate();
  },

  formatDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric'
    });
  },

  formatDateLong(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    });
  },

  upcomingDates(dates) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return dates.filter(d => new Date(d + 'T00:00:00') >= today);
  },

  // ===== Schedule generation from poll responses =====

  /**
   * Compute evenly-spaced buffer positions among non-holiday dates.
   * Returns array of 0-based indices into the nonHolidayDates array.
   */
  getBufferPositions(totalSlots, bufferCount) {
    if (bufferCount <= 0 || totalSlots <= bufferCount) return [];
    const positions = [];
    for (let k = 1; k <= bufferCount; k++) {
      positions.push(Math.round(totalSlots * k / (bufferCount + 1)) - 1);
    }
    return positions;
  },

  /**
   * Generate the default schedule (no poll responses, no credits).
   * Uses CONFIG values to compute dates, holidays, buffers, and round-robin.
   */
  generateDefaultSchedule() {
    return Scheduler.generateSchedule(
      CONFIG.DATES, CONFIG.MEMBERS, CONFIG.HOLIDAYS,
      CONFIG.BUFFER_WEEKS, [], {}
    );
  },

  /**
   * Generate a full schedule from poll responses.
   *
   * @param {string[]} dates - all Mondays in the semester
   * @param {string[]} members - member names in round-robin order
   * @param {Object[]} holidays - [{date, label}]
   * @param {number} bufferCount - number of buffer weeks
   * @param {Object[]} pollResponses - [{timestamp, name, unavailableDates, preferredDate}]
   * @param {Object} credits - {name: creditValue}
   * @returns {Object[]} schedule entries
   */
  generateSchedule(dates, members, holidays, bufferCount, pollResponses, credits) {
    const holidayDates = new Set(holidays.map(h => h.date));
    const nonHolidayDates = dates.filter(d => !holidayDates.has(d));

    // Determine buffer positions
    const bufferPositions = Scheduler.getBufferPositions(nonHolidayDates.length, bufferCount);
    const bufferDateSet = new Set(bufferPositions.map(i => nonHolidayDates[i]));

    // Presentation dates = non-holiday, non-buffer
    const presentationDates = nonHolidayDates.filter(d => !bufferDateSet.has(d));

    // Parse poll responses
    const unavailable = {};
    const preferred = {};
    members.forEach(m => { unavailable[m] = new Set(); });

    // Sort by timestamp for first-come-first-served preferred dates
    const sortedPolls = [...(pollResponses || [])].sort(
      (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
    );

    sortedPolls.forEach(r => {
      if (r.unavailableDates) {
        const dates = typeof r.unavailableDates === 'string'
          ? r.unavailableDates.split(',') : r.unavailableDates;
        dates.forEach(d => {
          const trimmed = d.trim();
          if (trimmed && unavailable[r.name]) unavailable[r.name].add(trimmed);
        });
      }
      // First poll response with a preferred date wins (FCFS)
      if (r.preferredDate && !preferred[r.name]) {
        preferred[r.name] = r.preferredDate;
      }
    });

    // Step 1: assign preferred dates (FCFS)
    const assigned = {};   // date -> presenter name
    const usedMembers = new Set();

    for (const r of sortedPolls) {
      const pref = preferred[r.name];
      if (!pref) continue;
      if (!presentationDates.includes(pref)) continue;
      if (assigned[pref]) continue; // date already taken
      if (unavailable[r.name] && unavailable[r.name].has(pref)) continue;
      assigned[pref] = r.name;
      usedMembers.add(r.name);
    }

    // Step 2: round-robin fill remaining slots, sorted by credits (highest first)
    const remainingPool = members
      .filter(m => !usedMembers.has(m))
      .sort((a, b) => (credits[b] || 0) - (credits[a] || 0));

    // Add already-used members back for the second cycle
    const fullPool = [...remainingPool, ...members.filter(m => usedMembers.has(m))];
    let poolIdx = 0;

    for (const date of presentationDates) {
      if (assigned[date]) continue;

      let found = false;
      for (let attempt = 0; attempt < fullPool.length; attempt++) {
        const candidate = fullPool[(poolIdx + attempt) % fullPool.length];
        if (unavailable[candidate] && unavailable[candidate].has(date)) continue;
        // Check not already assigned to another date in this cycle
        const alreadyAssignedDates = Object.entries(assigned)
          .filter(([, n]) => n === candidate)
          .map(([d]) => d);
        // Allow at most ceil(presentationDates.length / members.length) assignments
        const maxAssignments = Math.ceil(presentationDates.length / members.length);
        if (alreadyAssignedDates.length >= maxAssignments) continue;

        assigned[date] = candidate;
        poolIdx = (poolIdx + attempt + 1) % fullPool.length;
        found = true;
        break;
      }
      if (!found) {
        assigned[date] = ''; // no one available
      }
    }

    // Step 3: build full schedule with holidays and buffers
    return dates.map((date, idx) => {
      const holiday = holidays.find(h => h.date === date);
      if (holiday) {
        return {
          week: idx + 1, date, presenter: holiday.label,
          type: '', topic: '', abstract: '', status: 'Holiday'
        };
      }
      if (bufferDateSet.has(date)) {
        return {
          week: idx + 1, date, presenter: '',
          type: '', topic: '', abstract: '', status: 'Buffer'
        };
      }
      return {
        week: idx + 1, date, presenter: assigned[date] || '',
        type: '', topic: '', abstract: '',
        status: assigned[date] ? 'TBD' : 'Empty'
      };
    });
  }
};
