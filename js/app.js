// Main Alpine.js application

document.addEventListener('alpine:init', () => {
  Alpine.data('meetingApp', () => ({
    // State
    schedule: [],
    members: CONFIG.MEMBERS,
    credits: {},
    optOuts: [],
    indicoEvents: [],
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

    // Volunteer form
    volName: '',
    volDate: '',
    volType: '',
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

    // Random assignment
    randomDate: '',
    randomResult: null,
    randomSubmitting: false,

    async init() {
      await this.loadData();
      this.loadIndicoEvents();
    },

    async loadData() {
      this.loading = true;
      this.error = null;

      const data = await API.fetchAll();

      if (data && data.schedule) {
        this.schedule = data.schedule;
        this.optOuts = data.optOuts || [];
        if (data.members) {
          // Update credits from server
          const memberData = {};
          data.members.forEach(m => { memberData[m.name] = m.credits || 0; });
          this.credits = memberData;
        } else {
          this.credits = Scheduler.computeCredits(this.schedule, this.members);
        }
      } else {
        // Fallback to local defaults
        this.schedule = JSON.parse(JSON.stringify(CONFIG.DEFAULT_SCHEDULE));
        this.credits = Scheduler.computeCredits(this.schedule, this.members);
        this.optOuts = [];
      }

      this.loading = false;
    },

    async loadIndicoEvents() {
      this.indicoEvents = await API.fetchIndicoEvents();
    },

    // --- Computed properties ---

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

    get emptySlots() {
      return this.schedule.filter(s =>
        !Scheduler.isPast(s.date) &&
        (!s.presenter || s.status === 'Empty')
      );
    },

    // --- Row styling ---

    rowClass(entry) {
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
        default: return 'status-tbd';
      }
    },

    statusBadge(status) {
      return status || 'TBD';
    },

    // --- Date helpers ---

    formatDate(d) { return Scheduler.formatDate(d); },
    formatDateLong(d) { return Scheduler.formatDateLong(d); },
    isPast(d) { return Scheduler.isPast(d); },
    isToday(d) { return Scheduler.isToday(d); },

    indicoLink(date) {
      if (!this.indicoEvents.length) return null;
      const target = new Date(date + 'T00:00:00');
      for (const ev of this.indicoEvents) {
        const evDate = new Date(ev.startDate.date);
        if (evDate.getFullYear() === target.getFullYear() &&
            evDate.getMonth() === target.getMonth() &&
            evDate.getDate() === target.getDate()) {
          return ev.url;
        }
      }
      return null;
    },

    // --- Volunteer form ---

    openVolunteerModal() {
      this.volName = '';
      this.volDate = '';
      this.volType = '';
      this.volTopic = '';
      this.volAbstract = '';
      this.showVolunteerModal = true;
    },

    async submitVolunteer() {
      if (!this.volName || !this.volDate || !this.volType || !this.volTopic) {
        this.notify('Please fill in Name, Date, Type, and Topic.', 'error');
        return;
      }
      this.volSubmitting = true;

      const res = await API.volunteer(this.volName, this.volDate, this.volType, this.volTopic, this.volAbstract);

      if (res.success) {
        this.notify(`${this.volName} volunteered for ${Scheduler.formatDate(this.volDate)}!`);
        this.showVolunteerModal = false;
        await this.loadData();
      } else if (res.error) {
        this.notify(res.error, 'error');
        // If backend not configured, apply locally
        if (res.error.includes('not configured')) {
          this.applyVolunteerLocally();
        }
      }
      this.volSubmitting = false;
    },

    applyVolunteerLocally() {
      const entry = this.schedule.find(s => s.date === this.volDate);
      if (!entry) return;
      if (entry.presenter && entry.status !== 'Empty') {
        // Add as additional presenter
        entry.presenter += ` & ${this.volName}`;
      } else {
        entry.presenter = this.volName;
      }
      entry.type = this.volType;
      entry.topic = this.volTopic;
      entry.abstract = this.volAbstract;
      entry.status = 'Volunteered';
      this.showVolunteerModal = false;
      this.notify(`${this.volName} volunteered for ${Scheduler.formatDate(this.volDate)} (local only).`);
    },

    // --- Opt-out form ---

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
        Scheduler.parsePresenters(s.presenter).includes(this.optOutName)
      );
    },

    async submitOptOut() {
      if (!this.optOutName || !this.optOutDate) {
        this.notify('Please select your name and date.', 'error');
        return;
      }
      this.optOutSubmitting = true;

      const res = await API.optOut(this.optOutName, this.optOutDate, this.optOutReason);

      if (res.success) {
        this.notify(`${this.optOutName} opted out of ${Scheduler.formatDate(this.optOutDate)}.`);
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
      if (presenters.length > 0) {
        entry.presenter = presenters.join(' & ');
      } else {
        entry.presenter = '';
        entry.status = 'Empty';
      }
      this.optOuts.push({ name: this.optOutName, date: this.optOutDate, reason: this.optOutReason });
      this.showOptOutModal = false;
      this.notify(`${this.optOutName} opted out of ${Scheduler.formatDate(this.optOutDate)} (local only).`);
    },

    // --- Swap form ---

    openSwapModal() {
      this.swapMember1 = '';
      this.swapMember2 = '';
      this.showSwapModal = true;
    },

    datesForMember(name) {
      if (!name) return [];
      return this.schedule.filter(s =>
        !Scheduler.isPast(s.date) &&
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

      // Swap the first upcoming date of each member
      const date1 = d1[0].date;
      const date2 = d2[0].date;

      const res = await API.swap(this.swapMember1, date1, this.swapMember2, date2);

      if (res.success) {
        this.notify(`Swapped: ${this.swapMember1} ↔ ${this.swapMember2}`);
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

      // Swap presenters for these two entries
      const replacePres = (entry, oldName, newName) => {
        const parts = Scheduler.parsePresenters(entry.presenter);
        const idx = parts.indexOf(oldName);
        if (idx >= 0) parts[idx] = newName;
        entry.presenter = parts.join(' & ');
      };

      replacePres(entry1, this.swapMember1, this.swapMember2);
      replacePres(entry2, this.swapMember2, this.swapMember1);

      this.showSwapModal = false;
      this.notify(`Swapped: ${this.swapMember1} ↔ ${this.swapMember2} (local only).`);
    },

    // --- Random assignment ---

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
      if (entry.presenter && entry.status !== 'Empty') {
        entry.presenter += ` & ${this.randomResult}`;
      } else {
        entry.presenter = this.randomResult;
      }
      entry.status = 'TBD';
      this.showRandomModal = false;
      this.notify(`${this.randomResult} assigned to ${Scheduler.formatDate(this.randomDate)} (local only).`);
    },

    // --- Fairness tracker ---

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

    // --- Notifications ---

    notify(message, type = 'success') {
      this.notification = message;
      this.notificationType = type;
      setTimeout(() => { this.notification = null; }, 5000);
    },

    // --- Utility ---

    closeAllModals() {
      this.showVolunteerModal = false;
      this.showOptOutModal = false;
      this.showSwapModal = false;
      this.showRandomModal = false;
      this.showFairnessModal = false;
    }
  }));
});
