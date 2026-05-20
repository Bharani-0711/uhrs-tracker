/* ════════════════════════════════════════════
   UHRS TRACKER — app.js
   ════════════════════════════════════════════ */

'use strict';

// ── CONSTANTS ─────────────────────────────────
const PASSCODE       = '9386959494';
const TASK_USD       = 0.25;          // $0.25 per task
const EUR_THRESHOLD  = 10;            // €10 minimum for payout
const PAYOUT_DAYS    = 39;            // 39-day countdown from Sunday
const PAYPAL_FEE_PCT = 0.02;          // 2% deduction

// ── STORAGE HELPERS ───────────────────────────
const LS = {
  get:    (k)    => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set:    (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  remove: (k)    => localStorage.removeItem(k),
};

// ── DATA MODEL ────────────────────────────────
// entries: [ { id, date:'YYYY-MM-DD', tasks:Number, notes:String } ]
// settings: { usdEur, eurInr }
// weekRates: { 'YYYY-MM-DD': { usdEur, eurInr } }  — keyed by Monday date
// weekStatus: { 'YYYY-MM-DD': 'pending'|'paid' }
// weekCarry:  { 'YYYY-MM-DD': Boolean }

function loadEntries()    { return LS.get('uhrs_entries')    || []; }
function saveEntries(e)   { LS.set('uhrs_entries', e); }
function loadSettings()   { return LS.get('uhrs_settings')  || { usdEur: 0.92, eurInr: 90.5 }; }
function saveSettings(s)  { LS.set('uhrs_settings', s); }
function loadWeekRates()  { return LS.get('uhrs_weekRates') || {}; }
function saveWeekRates(w) { LS.set('uhrs_weekRates', w); }
function loadWeekStatus() { return LS.get('uhrs_weekStatus')|| {}; }
function saveWeekStatus(w){ LS.set('uhrs_weekStatus', w); }

// ── DATE HELPERS ──────────────────────────────
function toISO(d) {
  return d.toISOString().slice(0, 10);
}

function getMondayOfDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay(); // 0=Sun, 1=Mon…
  const diff = (day === 0) ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toISO(d);
}

function getSundayOfWeek(mondayStr) {
  const d = new Date(mondayStr + 'T00:00:00');
  d.setDate(d.getDate() + 6);
  return toISO(d);
}

function formatDate(str) {
  const d = new Date(str + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
}

function daysDiff(fromStr, toStr) {
  const a = new Date(fromStr + 'T00:00:00');
  const b = new Date(toStr  + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

function todayISO() { return toISO(new Date()); }

// ── WEEKLY GROUPING ───────────────────────────
function groupEntriesByWeek(entries) {
  const map = {};
  for (const e of entries) {
    const mon = getMondayOfDate(e.date);
    if (!map[mon]) map[mon] = [];
    map[mon].push(e);
  }
  return map;
}

// All weeks that should be visible: from earliest entry week up to current week
function getWeekKeys(entries) {
  const today = todayISO();
  const currentMon = getMondayOfDate(today);
  const keys = new Set([currentMon]);
  for (const e of entries) {
    keys.add(getMondayOfDate(e.date));
  }
  // Sort descending (newest first)
  return [...keys].sort().reverse();
}

// ── CALC HELPERS ─────────────────────────────
function calcWeek(mondayStr, entries, settings, weekRates, weekStatus) {
  const sun = getSundayOfWeek(mondayStr);
  const rates = weekRates[mondayStr] || settings;
  const { usdEur, eurInr } = rates;

  const weekEntries = entries.filter(e => {
    const mon = getMondayOfDate(e.date);
    return mon === mondayStr;
  });

  const totalTasks = weekEntries.reduce((s, e) => s + Number(e.tasks || 0), 0);
  const usd  = totalTasks * TASK_USD;
  const eur  = usd * usdEur;
  const inr  = eur * eurInr;
  const inrAfterFee = inr * (1 - PAYPAL_FEE_PCT);

  // Threshold & payout
  const meetsThreshold = eur >= EUR_THRESHOLD;
  let paypalDate = null;
  let daysLeft   = null;
  if (meetsThreshold) {
    const d = new Date(sun + 'T00:00:00');
    d.setDate(d.getDate() + PAYOUT_DAYS);
    paypalDate = toISO(d);
    daysLeft   = daysDiff(todayISO(), paypalDate);
  }

  const status = weekStatus[mondayStr] || (meetsThreshold ? 'pending' : 'upcoming');

  return {
    mondayStr, sun, weekEntries,
    totalTasks, usd, eur, inr, inrAfterFee,
    meetsThreshold, paypalDate, daysLeft,
    status, usdEur, eurInr
  };
}

// ── FORMATTING ────────────────────────────────
function fmt2(n)   { return Number(n).toFixed(2); }
function fmtINR(n) { return '₹' + Number(n).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function fmtUSD(n) { return '$' + fmt2(n); }
function fmtEUR(n) { return '€' + fmt2(n); }

// ── RENDER ────────────────────────────────────
function render() {
  const entries    = loadEntries();
  const settings   = loadSettings();
  const weekRates  = loadWeekRates();
  const weekStatus = loadWeekStatus();
  const weekKeys   = getWeekKeys(entries);

  // Stats
  let pendingINR = 0, thisWeekTasks = 0, lifetimeTasks = 0;
  const currentMon = getMondayOfDate(todayISO());

  for (const mon of weekKeys) {
    const w = calcWeek(mon, entries, settings, weekRates, weekStatus);
    lifetimeTasks += w.totalTasks;
    if (mon === currentMon) thisWeekTasks = w.totalTasks;
    if (w.status === 'pending' && w.meetsThreshold) pendingINR += w.inrAfterFee;
  }

  document.getElementById('statPending').textContent   = fmtINR(pendingINR);
  document.getElementById('statWeekTasks').textContent = thisWeekTasks;
  document.getElementById('statLifetime').textContent  = lifetimeTasks;

  // Week cards
  const list = document.getElementById('weekList');
  list.innerHTML = '';

  if (weekKeys.length === 0) {
    list.innerHTML = '<p style="color:var(--muted);text-align:center;padding:40px 0;font-size:13px;">No entries yet. Add your first daily entry.</p>';
    return;
  }

  // Carry-forward logic: if a week doesn't meet threshold, carry to next
  // We'll mark which weeks are being carried
  let carryEUR = 0;
  const carryMap = {}; // mondayStr => carryEUR from previous weeks

  // Process in chronological order
  const sortedAsc = [...weekKeys].reverse();
  for (let i = 0; i < sortedAsc.length; i++) {
    const mon = sortedAsc[i];
    const w = calcWeek(mon, entries, settings, weekRates, weekStatus);
    const effectiveEUR = w.eur + carryEUR;
    carryMap[mon] = { carryIn: carryEUR, effectiveEUR };
    if (effectiveEUR < EUR_THRESHOLD) {
      carryEUR = effectiveEUR; // carry forward
    } else {
      carryEUR = 0;            // threshold met, reset
    }
  }

  for (const mon of weekKeys) {
    const w   = calcWeek(mon, entries, settings, weekRates, weekStatus);
    const cm  = carryMap[mon] || { carryIn: 0, effectiveEUR: w.eur };
    const effectiveEUR   = cm.effectiveEUR;
    const effectiveINR   = effectiveEUR * w.eurInr * (1 - PAYPAL_FEE_PCT);
    const meetsEffective = effectiveEUR >= EUR_THRESHOLD;

    // Payout date based on effective
    let effPaypalDate = null, effDaysLeft = null;
    if (meetsEffective) {
      const d = new Date(w.sun + 'T00:00:00');
      d.setDate(d.getDate() + PAYOUT_DAYS);
      effPaypalDate = toISO(d);
      effDaysLeft   = daysDiff(todayISO(), effPaypalDate);
    }

    // Week index number
    const weekIdx = sortedAsc.indexOf(mon) + 1;

    // Status label
    const today = todayISO();
    let displayStatus = w.status;
    if (displayStatus === 'upcoming' && mon <= today) displayStatus = 'pending';
    if (!meetsEffective) displayStatus = 'carry';

    const badgeClass = {
      pending: 'badge-pending',
      paid:    'badge-paid',
      upcoming:'badge-upcoming',
      carry:   'badge-carry'
    }[displayStatus] || 'badge-pending';

    const badgeText = {
      pending: 'Pending',
      paid:    'Paid',
      upcoming:'Upcoming',
      carry:   'Carry Fwd'
    }[displayStatus] || 'Pending';

    // Countdown text
    let countdownHTML = '';
    if (meetsEffective && effDaysLeft !== null && displayStatus !== 'paid') {
      if (effDaysLeft > 0) {
        countdownHTML = `<span class="countdown-text">PayPal in ${effDaysLeft} day${effDaysLeft !== 1 ? 's' : ''}</span>`;
      } else if (effDaysLeft === 0) {
        countdownHTML = `<span class="countdown-text">PayPal Today!</span>`;
      } else {
        countdownHTML = `<span class="countdown-text">Payout overdue ${Math.abs(effDaysLeft)}d</span>`;
      }
    } else if (!meetsEffective && cm.carryIn > 0) {
      countdownHTML = `<span class="countdown-text countdown-carry">Carry: ${fmtEUR(cm.carryIn)} from prev.</span>`;
    }

    // Daily rows
    const sortedEntries = [...w.weekEntries].sort((a, b) => a.date.localeCompare(b.date));
    let rowsHTML = '';
    if (sortedEntries.length === 0) {
      rowsHTML = `<tr><td colspan="6" class="no-entries">No entries this week</td></tr>`;
    } else {
      for (const e of sortedEntries) {
        const usd = Number(e.tasks) * TASK_USD;
        const eur = usd * w.usdEur;
        const inr = eur * w.eurInr;
        rowsHTML += `
          <tr>
            <td>${formatDate(e.date)}</td>
            <td>${e.tasks}</td>
            <td>${fmtUSD(usd)}</td>
            <td class="hide-mobile">${fmtEUR(eur)}</td>
            <td>${fmtINR(inr)}</td>
            <td class="td-notes hide-mobile">${e.notes || '—'}</td>
            <td class="td-actions">
              <button class="btn-edit" onclick="openEditEntry('${e.id}')">✎</button>
              <button class="btn-del"  onclick="deleteEntry('${e.id}')">✕</button>
            </td>
          </tr>`;
      }
    }

    const paidChecked = w.status === 'paid' ? 'checked' : '';

    const card = document.createElement('div');
    card.className = 'week-card';
    card.dataset.mon = mon;
    card.innerHTML = `
      <div class="week-header" onclick="toggleWeek('${mon}')">
        <span class="week-name">W${weekIdx}</span>
        <span class="week-range">${formatDate(mon)} – ${formatDate(w.sun)}</span>
        <div class="week-meta">
          <span class="week-tasks">${w.totalTasks} tasks</span>
          <span class="week-inr">${fmtINR(effectiveINR)}</span>
          <span class="badge ${badgeClass}">${badgeText}</span>
          <span class="week-arrow">▾</span>
        </div>
      </div>
      <div class="week-body">

        <div class="week-summary">
          <div class="sum-item"><span class="sum-key">Tasks</span><span class="sum-val">${w.totalTasks}</span></div>
          <div class="sum-item"><span class="sum-key">USD</span><span class="sum-val">${fmtUSD(w.usd)}</span></div>
          <div class="sum-item"><span class="sum-key">EUR</span><span class="sum-val">${fmtEUR(effectiveEUR)}</span></div>
          <div class="sum-item"><span class="sum-key">INR (net)</span><span class="sum-val">${fmtINR(effectiveINR)}</span></div>
          <div class="sum-item"><span class="sum-key">Threshold</span><span class="sum-val" style="color:${meetsEffective ? 'var(--green)' : 'var(--amber)'}">${meetsEffective ? '✓ Met' : '✗ No'}</span></div>
          <div class="sum-item"><span class="sum-key">PayPal Date</span><span class="sum-val">${effPaypalDate ? formatDate(effPaypalDate) : '—'}</span></div>
          <div class="sum-item"><span class="sum-key">USD→EUR</span><span class="sum-val">${w.usdEur}</span></div>
          <div class="sum-item"><span class="sum-key">EUR→INR</span><span class="sum-val">${w.eurInr}</span></div>
        </div>

        <div class="summary-actions">
          ${countdownHTML}
          <div class="paid-toggle-wrap">
            <label class="toggle">
              <input type="checkbox" ${paidChecked} onchange="togglePaid('${mon}', this.checked)" />
              <span class="toggle-slider"></span>
            </label>
            <span>${w.status === 'paid' ? 'Paid ✓' : 'Mark Paid'}</span>
          </div>
          <button class="btn-secondary btn-sm" onclick="openRateModal('${mon}')">Edit Rates</button>
        </div>

        <table class="entries-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Tasks</th>
              <th>USD</th>
              <th class="hide-mobile">EUR</th>
              <th>INR Est.</th>
              <th class="hide-mobile">Notes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${rowsHTML}</tbody>
        </table>
      </div>`;

    list.appendChild(card);
  }
}

// ── TOGGLE WEEK ───────────────────────────────
function toggleWeek(mon) {
  const card = document.querySelector(`.week-card[data-mon="${mon}"]`);
  if (card) card.classList.toggle('open');
}

// ── PASSCODE ──────────────────────────────────
function checkPasscode() {
  const val = document.getElementById('passcodeInput').value;
  const err = document.getElementById('passcodeError');
  if (val === PASSCODE) {
    LS.set('uhrs_auth', '1');
    document.getElementById('lockScreen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    render();
  } else {
    err.classList.remove('hidden');
    document.getElementById('passcodeInput').value = '';
    setTimeout(() => err.classList.add('hidden'), 2500);
  }
}

document.getElementById('passcodeInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') checkPasscode();
});

function lockApp() {
  LS.remove('uhrs_auth');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('lockScreen').classList.remove('hidden');
  document.getElementById('passcodeInput').value = '';
}

// ── ENTRY MODAL ───────────────────────────────
let editingEntryId = null;

function openAddEntry() {
  editingEntryId = null;
  document.getElementById('modalTitle').textContent = 'Add Daily Entry';
  document.getElementById('entryDate').value  = todayISO();
  document.getElementById('entryTasks').value = '';
  document.getElementById('entryNotes').value = '';
  document.getElementById('entryError').classList.add('hidden');
  document.getElementById('entryModal').classList.remove('hidden');
}

function openEditEntry(id) {
  const entries = loadEntries();
  const e = entries.find(x => x.id === id);
  if (!e) return;
  editingEntryId = id;
  document.getElementById('modalTitle').textContent = 'Edit Entry';
  document.getElementById('entryDate').value  = e.date;
  document.getElementById('entryTasks').value = e.tasks;
  document.getElementById('entryNotes').value = e.notes || '';
  document.getElementById('entryError').classList.add('hidden');
  document.getElementById('entryModal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('entryModal').classList.add('hidden');
}

function saveEntry() {
  const date  = document.getElementById('entryDate').value.trim();
  const tasks = parseInt(document.getElementById('entryTasks').value, 10);
  const notes = document.getElementById('entryNotes').value.trim();
  const err   = document.getElementById('entryError');

  if (!date || isNaN(tasks) || tasks < 0) {
    err.classList.remove('hidden');
    return;
  }
  err.classList.add('hidden');

  let entries = loadEntries();
  if (editingEntryId) {
    const idx = entries.findIndex(x => x.id === editingEntryId);
    if (idx !== -1) entries[idx] = { id: editingEntryId, date, tasks, notes };
  } else {
    entries.push({ id: uid(), date, tasks, notes });
  }
  saveEntries(entries);
  closeModal();
  render();
}

function deleteEntry(id) {
  if (!confirm('Delete this entry?')) return;
  const entries = loadEntries().filter(e => e.id !== id);
  saveEntries(entries);
  render();
}

// ── PAID TOGGLE ───────────────────────────────
function togglePaid(mon, isPaid) {
  const status = loadWeekStatus();
  status[mon]  = isPaid ? 'paid' : 'pending';
  saveWeekStatus(status);
  render();
}

// ── SETTINGS MODAL ───────────────────────────
function openSettings() {
  const s = loadSettings();
  document.getElementById('settingUsdEur').value = s.usdEur;
  document.getElementById('settingEurInr').value = s.eurInr;
  document.getElementById('settingsModal').classList.remove('hidden');
}
function closeSettings() {
  document.getElementById('settingsModal').classList.add('hidden');
}
function saveSettings() {
  const usdEur = parseFloat(document.getElementById('settingUsdEur').value);
  const eurInr = parseFloat(document.getElementById('settingEurInr').value);
  if (!isNaN(usdEur) && !isNaN(eurInr)) {
    saveSettings({ usdEur, eurInr });
    closeSettings();
    render();
  }
}
// override saveSettings name collision
window.saveSettings = function() {
  const usdEur = parseFloat(document.getElementById('settingUsdEur').value);
  const eurInr = parseFloat(document.getElementById('settingEurInr').value);
  if (!isNaN(usdEur) && !isNaN(eurInr)) {
    LS.set('uhrs_settings', { usdEur, eurInr });
    closeSettings();
    render();
  }
};

// ── WEEK RATE MODAL ───────────────────────────
let rateModalMon = null;

function openRateModal(mon) {
  rateModalMon = mon;
  const rates = loadWeekRates();
  const settings = loadSettings();
  const r = rates[mon] || settings;
  document.getElementById('rateModalTitle').textContent = `Rates for W (${formatDate(mon)})`;
  document.getElementById('rateUsdEur').value = r.usdEur;
  document.getElementById('rateEurInr').value = r.eurInr;
  document.getElementById('rateModal').classList.remove('hidden');
}
function closeRateModal() {
  document.getElementById('rateModal').classList.add('hidden');
  rateModalMon = null;
}
function saveWeekRates() {
  if (!rateModalMon) return;
  const usdEur = parseFloat(document.getElementById('rateUsdEur').value);
  const eurInr = parseFloat(document.getElementById('rateEurInr').value);
  if (!isNaN(usdEur) && !isNaN(eurInr)) {
    const wr = loadWeekRates();
    wr[rateModalMon] = { usdEur, eurInr };
    LS.set('uhrs_weekRates', wr);
    closeRateModal();
    render();
  }
}

// ── CLOSE MODALS ON OVERLAY CLICK ─────────────
['entryModal', 'settingsModal', 'rateModal'].forEach(id => {
  document.getElementById(id).addEventListener('click', (e) => {
    if (e.target === document.getElementById(id)) {
      document.getElementById(id).classList.add('hidden');
    }
  });
});

// ── UID ───────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── INIT ──────────────────────────────────────
(function init() {
  if (LS.get('uhrs_auth') === '1') {
    document.getElementById('lockScreen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    render();
  }
})();
