// Main Alpine.js application

document.addEventListener('alpine:init', () => {
  Alpine.data('meetingApp', () => ({
    // State
    schedule: [],
    members: CONFIG.MEMBERS,
    credits: {},
    optOuts: [],
    indicoEvents: [],
    archive: [],
    pollResponses: [],
    loading: true,
    error: null,
    notification: null,
    notificationType: 'success',

    // Modal state
    showVolunteerModal: false,
    showOptOutModal: false,
    showSwapModal: false,
    showRandomModal: false,
    showFairnessModal: false,
    showEmergencyCancelModal: false,
    showPollModal: false,
    showGenerateModal: false,
    showArchive: false,

    // Volunteer form
    volName: '',
    volCustomName: '',
    volDate: '',
    volType: '',
    volCustomType: '',
    volTopic: '',
    volAbstract: '',
    volSubmitting: false,

    // Opt-out form
    optOutName: '',
    optOutDate: '',
    optOutReason: '',
    optOutSubmitting: false,

    // Swap form
    swapMember1: '',
    swapMember2: '',
    swapSubmitting: false,

    // Emergency cancel form
    emergName: '',
    emergDate: '',
    emergReason: '',
    emergSubmitting: false,

    // Random assignment
    randomDate: '',
    randomResult: null,
    randomSubmitting: false,

    // Poll form
    pollName: '',
    pollUnavailable: [],
    pollPreferred: '',
    pollSubmitting: false,

    // Schedule generation
    generatePreview: null,
    generateSubmitting: false,

    // Archive
    selectedArchiveSemester: '',

    // Theme
    darkMode: localStorage.getItem('theme') || 'dark',

    async init() {
      this.applyTheme();
      await this.loadData();
    },

    applyTheme() {
      document.documentElement.setAttribute('data-theme', this.darkMode);
    },

    toggleTheme() {
      const order = ['dark', 'light', 'auto'];
      this.darkMode = order[(order.indexOf(this.darkMode) + 1) % 3];
      localStorage.setItem('theme', this.darkMode);
      this.applyTheme();
    },

    async loadData() {
      this.loading = true;
      this.error = null;

      const data = await API.fetchAll();

      if (data && data.schedule) {
        this.schedule = data.schedule;
        this.optOuts = data.optOuts || [];
        this.archive = data.archive || [];
        this.pollResponses = data.pollResponses || [];
        this.indicoEvents = data.indicoEvents || [];
        if (data.members) {
          const memberData = {};
          data.members.forEach(m => { memberData[m.name] = m.credits || 0; });
          this.credits = memberData;
        } else {
          this.credits = Scheduler.computeCredits(this.schedule, this.members);
        }
      } else {
        this.schedule = Scheduler.generateDefaultSchedule();
        this.credits = Scheduler.computeCredits(this.schedule, this.members);
        this.optOuts = [];
        this.archive = [];
        this.pollResponses = [];
        this.indicoEvents = [];
      }

      this.loading = false;
    },

    // ===== Computed properties =====

    get currentDate() {
      return Scheduler.currentOrNextDate(CONFIG.DATES);
    },

    get fairnessIndex() {
      const vals = Object.values(this.credits);
      if (vals.length === 0) return 1;
      return Scheduler.jainsIndex(vals);
    },

    get presentationCounts() {
      return Scheduler.presentationCounts(this.schedule, this.members);
    },

    get upcomingDates() {
      return Scheduler.upcomingDates(CONFIG.DATES);
    },

    // Upcoming non-holiday dates for volunteer form
    get volunteerDates() {
      return this.schedule.filter(s =>
        !Scheduler.isPast(s.date) && s.status !== 'Holiday'
      );
    },

    // Upcoming dates that are empty, buffer (unclaimed), or cancelled
    get emptySlots() {
      return this.schedule.filter(s =>
        !Scheduler.isPast(s.date) &&
        s.status !== 'Holiday' &&
        (s.status === 'Empty' || s.status === 'Buffer' || s.status === 'Cancelled' ||
         (!s.presenter && s.status !== 'Holiday'))
      );
    },

    // Non-holiday, non-buffer upcoming dates for the poll
    get pollAvailableDates() {
      return CONFIG.DATES.filter(d =>
        !Scheduler.isPast(d) && !Scheduler.isHoliday(d)
      );
    },

    // Preferred dates: upcoming non-holiday dates not marked unavailable
    get pollPreferredDates() {
      return this.pollAvailableDates.filter(d => !this.pollUnavailable.includes(d));
    },

    // Archive semesters
    get archiveSemesters() {
      const semesters = [...new Set(this.archive.map(a => a.semester))];
      return semesters.sort().reverse();
    },

    get archiveForSemester() {
      if (!this.selectedArchiveSemester) return [];
      return this.archive.filter(a => a.semester === this.selectedArchiveSemester);
    },

    // ===== Row styling =====

    rowClass(entry) {
      if (entry.status === 'Holiday') return 'holiday-week';
      if (entry.status === 'Buffer' && !entry.presenter) return 'buffer-week';
      if (entry.status === 'Cancelled') return 'cancelled-week';
      if (entry.date === this.currentDate) return 'current-week';
      if (Scheduler.isPast(entry.date)) return 'past-week';
      return '';
    },

    statusClass(status) {
      switch (status) {
        case 'Confirmed': return 'status-confirmed';
        case 'Volunteered': return 'status-volunteered';
        case 'TBD': return 'status-tbd';
        case 'Empty': return 'status-empty';
        case 'Holiday': return 'status-holiday';
        case 'Buffer': return 'status-buffer';
        case 'Cancelled': return 'status-cancelled';
        default: return 'status-tbd';
      }
    },

    statusBadge(entry) {
      if (entry.status === 'Holiday') return 'Holiday';
      if (entry.status === 'Buffer' && !entry.presenter) return 'Buffer';
      if (entry.status === 'Cancelled') return 'Cancelled';
      return entry.status || 'TBD';
    },

    presenterDisplay(entry) {
      if (entry.status === 'Holiday') return entry.presenter || 'No Meeting';
      if (entry.status === 'Buffer' && !entry.presenter) return 'Buffer \u2014 Available';
      if (entry.status === 'Cancelled') return 'Meeting Cancelled';
      return entry.presenter || '\u2014';
    },

    // ===== Date helpers =====

    formatDate(d) { return Scheduler.formatDate(d); },
    formatDateLong(d) { return Scheduler.formatDateLong(d); },
    isPast(d) { return Scheduler.isPast(d); },
    isToday(d) { return Scheduler.isToday(d); },

    indicoLink(date) {
      if (!this.indicoEvents.length) return null;
      const event = this.indicoEvents.find(ev => ev.date === date);
      return event ? event.url : null;
    },

    // ===== Volunteer form =====

    openVolunteerModal() {
      this.volName = '';
      this.volCustomName = '';
      this.volDate = '';
      this.volType = '';
      this.volCustomType = '';
      this.volTopic = '';
      this.volAbstract = '';
      this.showVolunteerModal = true;
    },

    async submitVolunteer() {
      const effectiveName = this.volName === '__other__' ? this.volCustomName.trim() : this.volName;
      const effectiveType = this.volType === '__other__' ? this.volCustomType.trim() : this.volType;
      if (!effectiveName || !this.volDate || !effectiveType || !this.volTopic) {
        this.notify('Please fill in Name, Date, Type, and Topic.', 'error');
        return;
      }
      this.volSubmitting = true;

      const res = await API.volunteer(effectiveName, this.volDate, effectiveType, this.volTopic, this.volAbstract);

      if (res.success) {
        const msg = res.reversedCancellation
          ? `${effectiveName} volunteered for ${Scheduler.formatDate(this.volDate)} \u2014 cancellation reversed!`
          : `${effectiveName} volunteered for ${Scheduler.formatDate(this.volDate)}!`;
        this.notify(msg);
        this.showVolunteerModal = false;
        await this.loadData();
      } else if (res.error) {
        this.notify(res.error, 'error');
        if (res.error.includes('not configured')) {
          this.applyVolunteerLocally(effectiveName, effectiveType);
        }
      }
      this.volSubmitting = false;
    },

    applyVolunteerLocally(name, type) {
      const entry = this.schedule.find(s => s.date === this.volDate);
      if (!entry) return;
      const wasCancelled = entry.status === 'Cancelled';
      if (entry.presenter && entry.status !== 'Empty' && entry.status !== 'Cancelled' && entry.status !== 'Buffer') {
        entry.presenter += ` & ${name}`;
      } else {
        entry.presenter = name;
      }
      entry.type = type;
      entry.topic = this.volTopic;
      entry.abstract = this.volAbstract;
      entry.status = 'Volunteered';
      this.showVolunteerModal = false;
      const extra = wasCancelled ? ' (cancellation reversed, local only)' : ' (local only)';
      this.notify(`${name} volunteered for ${Scheduler.formatDate(this.volDate)}${extra}.`);
    },

    // ===== Opt-out form =====

    openOptOutModal() {
      this.optOutName = '';
      this.optOutDate = '';
      this.optOutReason = '';
      this.showOptOutModal = true;
    },

    get optOutDatesForMember() {
      if (!this.optOutName) return [];
      return this.schedule.filter(s =>
        !Scheduler.isPast(s.date) &&
        s.status !== 'Holiday' && s.status !== 'Buffer' &&
        Scheduler.parsePresenters(s.presenter).includes(this.optOutName)
      );
    },

    optOutDeadlinePassed(dateStr) {
      return !Scheduler.canOptOut(dateStr);
    },

    get optOutDeadlineMessage() {
      if (!this.optOutDate) return '';
      if (this.optOutDeadlinePassed(this.optOutDate)) {
        return 'The deadline has passed \u2014 please try to find someone to swap with, or contact Pradyun directly.';
      }
      const days = Scheduler.daysUntil(this.optOutDate);
      return `${days} days until this meeting. Deadline: ${CONFIG.OPT_OUT_DEADLINE_DAYS} days before (Tuesday of the prior week).`;
    },

    async submitOptOut() {
      if (!this.optOutName || !this.optOutDate) {
        this.notify('Please select your name and date.', 'error');
        return;
      }
      if (this.optOutDeadlinePassed(this.optOutDate)) {
        this.notify('Opt-out deadline has passed. Try swapping instead, or contact Pradyun.', 'error');
        return;
      }
      this.optOutSubmitting = true;

      const res = await API.optOut(this.optOutName, this.optOutDate, this.optOutReason);

      if (res.success) {
        let msg = `${this.optOutName} opted out of ${Scheduler.formatDate(this.optOutDate)}.`;
        if (res.movedToBuffer) {
          msg += ` Moved to buffer week: ${Scheduler.formatDate(res.movedToBuffer)}.`;
        }
        if (res.autoAssigned) {
          msg += ` ${res.autoAssigned} auto-assigned as replacement.`;
        }
        this.notify(msg);
        this.showOptOutModal = false;
        await this.loadData();
      } else if (res.error) {
        this.notify(res.error, 'error');
        if (res.error.includes('not configured')) {
          this.applyOptOutLocally();
        }
      }
      this.optOutSubmitting = false;
    },

    applyOptOutLocally() {
      const entry = this.schedule.find(s => s.date === this.optOutDate);
      if (!entry) return;
      const presenters = Scheduler.parsePresenters(entry.presenter)
        .filter(p => p !== this.optOutName);

      // Try to move to buffer
      const buffer = Scheduler.findNextBuffer(this.schedule, this.optOutDate);
      let bufferMsg = '';

      if (presenters.length > 0) {
        entry.presenter = presenters.join(' & ');
      } else {
        entry.presenter = '';
        entry.status = 'Empty';
      }

      if (buffer) {
        buffer.presenter = this.optOutName;
        buffer.status = 'TBD';
        bufferMsg = ` Moved to buffer week: ${Scheduler.formatDate(buffer.date)}.`;
      }

      this.optOuts.push({ name: this.optOutName, date: this.optOutDate, reason: this.optOutReason });
      this.showOptOutModal = false;
      this.notify(`${this.optOutName} opted out of ${Scheduler.formatDate(this.optOutDate)}${bufferMsg} (local only).`);
    },

    // ===== Emergency cancel (no deadline — for emergencies) =====

    openEmergencyCancelModal() {
      this.emergName = '';
      this.emergDate = '';
      this.emergReason = '';
      this.showEmergencyCancelModal = true;
    },

    get emergCancelDatesForMember() {
      if (!this.emergName) return [];
      return this.schedule.filter(s =>
        !Scheduler.isPast(s.date) &&
        s.status !== 'Holiday' && s.status !== 'Buffer' && s.status !== 'Cancelled' &&
        Scheduler.parsePresenters(s.presenter).includes(this.emergName)
      );
    },

    async submitEmergencyCancel() {
      if (!this.emergName || !this.emergDate) {
        this.notify('Please select your name and date.', 'error');
        return;
      }
      this.emergSubmitting = true;

      const res = await API.emergencyCancel(this.emergName, this.emergDate, this.emergReason);

      if (res.success) {
        let msg = `${this.emergName} emergency-cancelled ${Scheduler.formatDate(this.emergDate)}. Meeting marked as cancelled.`;
        if (res.movedToBuffer) {
          msg += ` Moved to buffer week: ${Scheduler.formatDate(res.movedToBuffer)}.`;
        }
        this.notify(msg);
        this.showEmergencyCancelModal = false;
        await this.loadData();
      } else if (res.error) {
        this.notify(res.error, 'error');
        if (res.error.includes('not configured')) {
          this.applyEmergencyCancelLocally();
        }
      }
      this.emergSubmitting = false;
    },

    applyEmergencyCancelLocally() {
      const entry = this.schedule.find(s => s.date === this.emergDate);
      if (!entry) return;
      const presenters = Scheduler.parsePresenters(entry.presenter)
        .filter(p => p !== this.emergName);

      const buffer = Scheduler.findNextBuffer(this.schedule, this.emergDate);
      let bufferMsg = '';

      if (presenters.length > 0) {
        entry.presenter = presenters.join(' & ');
      } else {
        entry.presenter = '';
        entry.status = 'Cancelled';
      }

      if (buffer) {
        buffer.presenter = this.emergName;
        buffer.status = 'TBD';
        bufferMsg = ` Moved to buffer week: ${Scheduler.formatDate(buffer.date)}.`;
      }

      this.showEmergencyCancelModal = false;
      this.notify(`${this.emergName} emergency-cancelled ${Scheduler.formatDate(this.emergDate)}.${bufferMsg} (local only).`);
    },

    // ===== Swap form (no deadline — available anytime) =====

    openSwapModal() {
      this.swapMember1 = '';
      this.swapMember2 = '';
      this.showSwapModal = true;
    },

    datesForMember(name) {
      if (!name) return [];
      return this.schedule.filter(s =>
        !Scheduler.isPast(s.date) &&
        s.status !== 'Holiday' && s.status !== 'Buffer' &&
        Scheduler.parsePresenters(s.presenter).includes(name)
      );
    },

    get swapMember1Dates() { return this.datesForMember(this.swapMember1); },
    get swapMember2Dates() { return this.datesForMember(this.swapMember2); },

    get swapPreview() {
      if (!this.swapMember1 || !this.swapMember2) return null;
      if (this.swapMember1 === this.swapMember2) return null;
      const d1 = this.swapMember1Dates;
      const d2 = this.swapMember2Dates;
      if (d1.length === 0 || d2.length === 0) return null;
      return {
        from1: d1.map(s => Scheduler.formatDate(s.date)).join(', '),
        from2: d2.map(s => Scheduler.formatDate(s.date)).join(', ')
      };
    },

    async submitSwap() {
      if (!this.swapMember1 || !this.swapMember2 || this.swapMember1 === this.swapMember2) {
        this.notify('Please select two different members.', 'error');
        return;
      }
      const d1 = this.swapMember1Dates;
      const d2 = this.swapMember2Dates;
      if (d1.length === 0 || d2.length === 0) {
        this.notify('Both members must have upcoming assigned dates to swap.', 'error');
        return;
      }
      this.swapSubmitting = true;

      const date1 = d1[0].date;
      const date2 = d2[0].date;

      const res = await API.swap(this.swapMember1, date1, this.swapMember2, date2);

      if (res.success) {
        this.notify(`Swapped: ${this.swapMember1} \u2194 ${this.swapMember2}`);
        this.showSwapModal = false;
        await this.loadData();
      } else if (res.error) {
        this.notify(res.error, 'error');
        if (res.error.includes('not configured')) {
          this.applySwapLocally(date1, date2);
        }
      }
      this.swapSubmitting = false;
    },

    applySwapLocally(date1, date2) {
      const entry1 = this.schedule.find(s => s.date === date1);
      const entry2 = this.schedule.find(s => s.date === date2);
      if (!entry1 || !entry2) return;

      const replacePres = (entry, oldName, newName) => {
        const parts = Scheduler.parsePresenters(entry.presenter);
        const idx = parts.indexOf(oldName);
        if (idx >= 0) parts[idx] = newName;
        entry.presenter = parts.join(' & ');
      };

      replacePres(entry1, this.swapMember1, this.swapMember2);
      replacePres(entry2, this.swapMember2, this.swapMember1);

      this.showSwapModal = false;
      this.notify(`Swapped: ${this.swapMember1} \u2194 ${this.swapMember2} (local only).`);
    },

    // ===== Random assignment =====

    openRandomModal() {
      this.randomDate = '';
      this.randomResult = null;
      this.showRandomModal = true;
    },

    pickRandom() {
      if (!this.randomDate) {
        this.notify('Please select a date.', 'error');
        return;
      }
      const picked = Scheduler.pickRandom(
        this.randomDate, this.schedule, this.members, this.credits, this.optOuts
      );
      if (!picked) {
        this.notify('No eligible members for this date.', 'error');
        return;
      }
      this.randomResult = picked;
    },

    async confirmRandom() {
      if (!this.randomResult || !this.randomDate) return;
      this.randomSubmitting = true;

      const res = await API.assignRandom(this.randomDate, this.randomResult);

      if (res.success) {
        this.notify(`${this.randomResult} assigned to ${Scheduler.formatDate(this.randomDate)}!`);
        this.showRandomModal = false;
        await this.loadData();
      } else if (res.error) {
        this.notify(res.error, 'error');
        if (res.error.includes('not configured')) {
          this.applyRandomLocally();
        }
      }
      this.randomSubmitting = false;
    },

    applyRandomLocally() {
      const entry = this.schedule.find(s => s.date === this.randomDate);
      if (!entry) return;
      if (entry.presenter && entry.status !== 'Empty' && entry.status !== 'Buffer' && entry.status !== 'Cancelled') {
        entry.presenter += ` & ${this.randomResult}`;
      } else {
        entry.presenter = this.randomResult;
      }
      entry.status = 'TBD';
      this.showRandomModal = false;
      this.notify(`${this.randomResult} assigned to ${Scheduler.formatDate(this.randomDate)} (local only).`);
    },

    // ===== Fairness tracker =====

    openFairnessModal() {
      this.credits = Scheduler.computeCredits(this.schedule, this.members);
      this.showFairnessModal = true;
    },

    get sortedMembers() {
      return [...this.members].sort((a, b) => (this.credits[b] || 0) - (this.credits[a] || 0));
    },

    get maxCredit() {
      const vals = Object.values(this.credits);
      return vals.length ? Math.max(...vals, 1) : 1;
    },

    fairnessColor() {
      const j = this.fairnessIndex;
      if (j >= 0.95) return 'var(--pico-color-green-500, #22c55e)';
      if (j >= 0.90) return 'var(--pico-color-yellow-500, #eab308)';
      return 'var(--pico-color-red-500, #ef4444)';
    },

    // ===== Poll form =====

    openPollModal() {
      this.pollName = '';
      this.pollUnavailable = [];
      this.pollPreferred = '';
      this.showPollModal = true;
    },

    async submitPoll() {
      if (!this.pollName) {
        this.notify('Please select your name.', 'error');
        return;
      }
      this.pollSubmitting = true;

      const unavailStr = this.pollUnavailable.join(',');
      const res = await API.submitPoll(this.pollName, unavailStr, this.pollPreferred);

      if (res.success) {
        this.notify(`Availability submitted for ${this.pollName}!`);
        this.showPollModal = false;
        await this.loadData();
      } else if (res.error) {
        this.notify(res.error, 'error');
        if (res.error.includes('not configured')) {
          this.pollResponses.push({
            timestamp: new Date().toISOString(),
            name: this.pollName,
            unavailableDates: unavailStr,
            preferredDate: this.pollPreferred
          });
          this.showPollModal = false;
          this.notify(`Availability saved for ${this.pollName} (local only).`);
        }
      }
      this.pollSubmitting = false;
    },

    // ===== Schedule generation (organizer) =====

    openGenerateModal() {
      this.generatePreview = null;
      this.showGenerateModal = true;
    },

    generatePreviewSchedule() {
      const preview = Scheduler.generateSchedule(
        CONFIG.DATES,
        this.members,
        CONFIG.HOLIDAYS,
        CONFIG.BUFFER_WEEKS,
        this.pollResponses,
        this.credits
      );
      this.generatePreview = preview;
    },

    async confirmGenerate() {
      if (!this.generatePreview) return;
      this.generateSubmitting = true;

      const res = await API.archiveAndSave(CONFIG.SEMESTER.label, this.generatePreview);

      if (res.success) {
        this.notify('New schedule saved! Previous schedule archived.');
        this.showGenerateModal = false;
        await this.loadData();
      } else if (res.error) {
        this.notify(res.error, 'error');
        if (res.error.includes('not configured')) {
          this.schedule = this.generatePreview;
          this.showGenerateModal = false;
          this.notify('Schedule updated (local only).');
        }
      }
      this.generateSubmitting = false;
    },

    // ===== Notifications =====

    notify(message, type = 'success') {
      this.notification = message;
      this.notificationType = type;
      setTimeout(() => { this.notification = null; }, 5000);
    }
  }));
});
