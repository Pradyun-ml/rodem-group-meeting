// API layer — all communication with Google Apps Script backend

const API = {
  /**
   * GET schedule + members + opt-outs + archive + poll responses from Apps Script
   */
  async fetchAll() {
    if (!CONFIG.APPS_SCRIPT_URL) {
      console.warn('Apps Script URL not configured — using local defaults');
      return null;
    }
    try {
      const url = `${CONFIG.APPS_SCRIPT_URL}?secret=${encodeURIComponent(CONFIG.SECRET)}`;
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error('Failed to fetch data:', err);
      return null;
    }
  },

  /**
   * POST an action to Apps Script.
   * Content-Type: text/plain to avoid CORS preflight.
   */
  async post(action, payload) {
    if (!CONFIG.APPS_SCRIPT_URL) {
      console.error('Apps Script URL not configured');
      return { success: false, error: 'Backend not configured. See config.js.' };
    }
    try {
      const body = JSON.stringify({
        secret: CONFIG.SECRET,
        action,
        ...payload
      });
      const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        redirect: 'follow',
        body
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error(`POST ${action} failed:`, err);
      return { success: false, error: err.message };
    }
  },

  // --- Action helpers ---

  async volunteer(name, date, type, topic, abstract) {
    return this.post('volunteer', { name, date, type, topic, abstract });
  },

  async optOut(name, date, reason) {
    return this.post('optOut', { name, date, reason });
  },

  async swap(member1, date1, member2, date2) {
    return this.post('swap', { member1, date1, member2, date2 });
  },

  async assignRandom(date, name) {
    return this.post('assignRandom', { date, name });
  },

  async updateCredits(credits) {
    return this.post('updateCredits', { credits });
  },

  async emergencyCancel(name, date, reason) {
    return this.post('emergencyCancel', { name, date, reason });
  },

  async submitPoll(name, unavailableDates, preferredDate) {
    return this.post('submitPoll', { name, unavailableDates, preferredDate });
  },

  async archiveAndSave(semesterLabel, newSchedule) {
    return this.post('archiveAndSave', { semesterLabel, newSchedule });
  },

  // --- Indico integration (optional) ---

  fetchIndicoEvents() {
    return new Promise((resolve) => {
      if (!CONFIG.INDICO_CATEGORY_ID) {
        resolve([]);
        return;
      }
      const callbackName = '_indicoCb_' + Date.now();
      const script = document.createElement('script');

      const cleanup = () => {
        delete window[callbackName];
        if (script.parentNode) script.parentNode.removeChild(script);
      };

      window[callbackName] = (data) => {
        cleanup();
        resolve(data.results || []);
      };

      script.onerror = () => {
        cleanup();
        console.warn('Indico JSONP request failed');
        resolve([]);
      };

      const catId = CONFIG.INDICO_CATEGORY_ID;
      script.src = `https://indico.cern.ch/export/categ/${catId}.jsonp?from=today&to=+90d&jsonp=${callbackName}`;
      document.head.appendChild(script);

      setTimeout(() => {
        if (window[callbackName]) {
          cleanup();
          resolve([]);
        }
      }, 10000);
    });
  }
};
