// Scheduling logic: fairness, credits, random assignment

const Scheduler = {
  /**
   * Calculate Jain's Fairness Index
   * J = (sum(xi))^2 / (n * sum(xi^2))
   * Returns 1.0 when all values are equal, approaches 1/n when maximally unfair
   */
  jainsIndex(values) {
    const n = values.length;
    if (n === 0) return 1;
    const sum = values.reduce((a, b) => a + b, 0);
    const sumSq = values.reduce((a, b) => a + b * b, 0);
    if (sumSq === 0) return 1; // all zeros
    return (sum * sum) / (n * sumSq);
  },

  /**
   * Compute credits for all members based on schedule history
   * - Each week a non-presenting active member gets +1 credit
   * - Presenting resets credits to 0
   */
  computeCredits(schedule, members) {
    const credits = {};
    members.forEach(m => { credits[m] = 0; });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Process only past/current weeks
    const pastWeeks = schedule.filter(s => new Date(s.date + 'T00:00:00') <= today);

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
   * Pick a random speaker for a date, weighted by credits
   * Higher credits = more likely to be picked
   * Excludes opt-outs and recent presenters
   */
  pickRandom(date, schedule, members, credits, optOuts) {
    // Members who opted out of this date
    const optedOut = (optOuts || [])
      .filter(o => o.date === date)
      .map(o => o.name);

    // Members already assigned to this date
    const weekEntry = schedule.find(s => s.date === date);
    const alreadyAssigned = weekEntry ? Scheduler.parsePresenters(weekEntry.presenter) : [];

    // Find the date index
    const dateIndex = schedule.findIndex(s => s.date === date);

    // Members who presented in the last 2 weeks (excluding current date)
    const recentPresenters = [];
    for (let i = Math.max(0, dateIndex - 2); i < dateIndex; i++) {
      recentPresenters.push(...Scheduler.parsePresenters(schedule[i].presenter));
    }

    // Eligible members
    const eligible = members.filter(m =>
      !optedOut.includes(m) &&
      !alreadyAssigned.includes(m) &&
      !recentPresenters.includes(m)
    );

    if (eligible.length === 0) return null;

    // Weight by credits (minimum weight of 1 so everyone has a chance)
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
   * Get presentation counts per member from the full schedule
   */
  presentationCounts(schedule, members) {
    const counts = {};
    members.forEach(m => { counts[m] = 0; });
    schedule.forEach(week => {
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

  /**
   * Check if a date is in the past
   */
  isPast(dateStr) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Date(dateStr + 'T00:00:00') < today;
  },

  /**
   * Check if a date is today
   */
  isToday(dateStr) {
    const today = new Date();
    const d = new Date(dateStr + 'T00:00:00');
    return d.getFullYear() === today.getFullYear() &&
           d.getMonth() === today.getMonth() &&
           d.getDate() === today.getDate();
  },

  /**
   * Format date string for display: "Mon, Mar 16"
   */
  formatDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric'
    });
  },

  /**
   * Format date for long display: "Monday, March 16, 2026"
   */
  formatDateLong(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    });
  },

  /**
   * Get upcoming (non-past) dates
   */
  upcomingDates(dates) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return dates.filter(d => new Date(d + 'T00:00:00') >= today);
  }
};
