/* ════════════════════════════════════════════
   UHRS TRACKER — app.js
   Live rates: api.frankfurter.dev (free, no key)
   ════════════════════════════════════════════ */

'use strict';

// ── CONSTANTS ─────────────────────────────────
const PASSCODE        = '9386959494';
const TASK_USD        = 0.25;
const EUR_THRESHOLD   = 10;
const PAYOUT_DAYS     = 39;
const PAYPAL_FEE_PCT  = 0.02;
const RATES_CACHE_KEY = 'uhrs_liveRates';
const RATES_TTL_MS    = 6 * 60 * 60 * 1000; // refresh every 6 hours

// ── STORAGE HELPERS ───────────────────────────
const LS = {
  get:    k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set:    (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  remove: k => localStorage.removeItem(k),
};

// ── DATA LOADERS ──────────────────────────────
const loadEntries    = () => LS.get('uhrs_entries')    || [];
const saveEntries    = e  => LS.set('uhrs_entries', e);
const loadSettings   = () => LS.get('uhrs_settings')  || { usdEur: 0.92, eurInr: 90.5 };
const loadWeekRates  = () => LS.get('uhrs_weekRates') || {};
const loadWeekStatus = () => LS.get('uhrs_weekStatus')|| {};
const saveWeekStatus = w  => LS.set('uhrs_weekStatus', w);

// ── LIVE RATE FETCHING ────────────────────────
// Uses Frankfurter: free, open-source, ECB data, no key, CORS-enabled
// Endpoint: https://api.frankfurter.dev/v2/latest?base=USD&quotes=EUR,INR

let liveRates = null; // { usdEur, eurInr, fetchedAt, source }

async function fetchLiveRates() {
  // Check cache first
  const cached = LS.get(RATES_CACHE_KEY);
  if (cached && cached.fetchedAt && (Date.now() - cached.fetchedAt) < RATES_TTL_MS) {
    liveRates = cached;
    return cached;
  }

  setRateBadge('loading');
  try {
    const res  = await fetch('https://api.frankfurter.dev/v2/latest?base=USD&quotes=EUR,INR');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    const rates = {
      usdEur:    parseFloat(data.rates.EUR),
      eurInr:    parseFloat(data.rates.INR) / parseFloat(data.rates.EUR), // INR per EUR
      usdInr:    parseFloat(data.rates.INR),
      fetchedAt: Date.now(),
      date:      data.date,
      source:    'Frankfurter / ECB'
    };

    LS.set(RATES_CACHE_KEY, rates);
    liveRates = rates;
    setRateBadge('live', rates.date);
    return rates;
  } catch (err) {
    console.warn('Live rate fetch failed:', err);
    // Fall back to last cached or stored default
    const fallback = LS.get(RATES_CACHE_KEY) || loadSettings();
    liveRates = fallback;
    setRateBadge('stale', fallback.date || null);
    return fallback;
  }
}

function setRateBadge(state, date) {
  const badge = document.getElementById('rateBadge');
  if (!badge) return;
  const map = {
    loading: ['⟳ Fetching rates…', '#6b7280', '#f3f4f6'],
    live:    [`✓ Live rates · ${date || ''}`, '#16a34a', '#f0fdf4'],
    stale:   ['⚠ Cached rates', '#d97706', '#fffbeb'],
  };
  const [text, color, bg] = map[state] || map.stale;
  badge.textContent   = text;
  badge.style.color   = color;
  badge.style.background = bg;
}

function getEffectiveRates(mondayStr) {
  // Priority: per-week override → live rates → stored settings
  const weekRates = loadWeekRates();
  if (weekRates[mondayStr]) return weekRates[mondayStr];
  if (liveRates && liveRates.usdEur) return liveRates;
  return loadSettings();
}

// ── DATE HELPERS ──────────────────────────────
const toISO = d => d.toISOString().slice(0, 10);

function getMondayOfDate(dateStr) {
  const d   = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return toISO(d);
}

function getSundayOfWeek(mondayStr) {
  const d = new Date(mondayStr + 'T00:00:00');
  d.setDate(d.getDate() + 6);
  return toISO(d);
}

function formatDate(str) {
  return new Date(str + 'T00:00:00')
    .toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
}

function daysDiff(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}

const todayISO = () => toISO(new Date());

// ── WEEK HELPERS ──────────────────────────────
function getWeekKeys(entries) {
  const keys = new Set([getMondayOfDate(todayISO())]);
  entries.forEach(e => keys.add(getMondayOfDate(e.date)));
  return [...keys].sort().reverse();
}

function calcWeek(mondayStr, entries) {
  const sun    = getSundayOfWeek(mondayStr);
  const rates  = getEffectiveRates(mondayStr);
  const { usdEur, eurInr } = rates;

  const weekEntries = entries.filter(e => getMondayOfDate(e.date) === mondayStr);
  const totalTasks  = weekEntries.reduce((s, e) => s + Number(e.tasks || 0), 0);
  const usd  = totalTasks * TASK_USD;
  const eur  = usd * usdEur;
  const inr  = eur * eurInr;

  return { mondayStr, sun, weekEntries, totalTasks, usd, eur, inr, usdEur, eurInr };
}

// ── FORMATTING ────────────────────────────────
const fmt2   = n => Number(n).toFixed(2);
const fmtINR = n => '₹' + Number(n).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const fmtUSD = n => '$' + fmt2(n);
const fmtEUR = n => '€' + fmt2(n);

// ── RENDER ────────────────────────────────────
function render() {
  const entries    = loadEntries();
  const weekStatus = loadWeekStatus();
  const weekKeys   = getWeekKeys(entries);
  const sortedAsc  = [...weekKeys].reverse();
  const currentMon = getMondayOfDate(todayISO());

  // Carry-forward pass (chronological)
  let carryEUR = 0;
  const carryMap = {};
  for (const mon of sortedAsc) {
    const w = calcWeek(mon, entries);
    const effectiveEUR = w.eur + carryEUR;
    carryMap[mon] = { carryIn: carryEUR, effectiveEUR };
    carryEUR = effectiveEUR < EUR_THRESHOLD ? effectiveEUR : 0;
  }

  // Stats
  let pendingINR = 0, thisWeekTasks = 0, lifetimeTasks = 0;
  for (const mon of weekKeys) {
    const w   = calcWeek(mon, entries);
    const cm  = carryMap[mon] || { effectiveEUR: w.eur };
    const effectiveINR = cm.effectiveEUR * w.eurInr * (1 - PAYPAL_FEE_PCT);
    lifetimeTasks += w.totalTasks;
    if (mon === currentMon) thisWeekTasks = w.totalTasks;
    const status = weekStatus[mon] || (cm.effectiveEUR >= EUR_THRESHOLD ? 'pending' : 'upcoming');
    if (status === 'pending' && cm.effectiveEUR >= EUR_THRESHOLD) pendingINR += effectiveINR;
  }

  document.getElementById('statPending').textContent   = fmtINR(pendingINR);
  document.getElementById('statWeekTasks').textContent = thisWeekTasks;
  document.getElementById('statLifetime').textContent  = lifetimeTasks;

  // Show live rate strip
  if (liveRates && liveRates.usdEur) {
    const strip = document.getElementById('rateStrip');
    if (strip) {
      strip.textContent =
        `1 USD = ${fmtEUR(liveRates.usdEur)}  ·  1 EUR = ₹${fmt2(liveRates.eurInr)}  ·  1 USD = ₹${fmt2(liveRates.usdInr || liveRates.usdEur * liveRates.eurInr)}`;
    }
  }

  // Week cards
  const list = document.getElementById('weekList');
  const openWeeks = new Set(
    [...list.querySelectorAll('.week-card.open')].map(c => c.dataset.mon)
  );
  list.innerHTML = '';

  if (weekKeys.length === 0) {
    list.innerHTML = '<p class="empty-msg">No entries yet. Add your first daily entry.</p>';
    return;
  }

  for (const mon of weekKeys) {
    const w   = calcWeek(mon, entries);
    const cm  = carryMap[mon] || { carryIn: 0, effectiveEUR: w.eur };
    const effectiveEUR = cm.effectiveEUR;
    const effectiveINR = effectiveEUR * w.eurInr * (1 - PAYPAL_FEE_PCT);
    const meetsThreshold = effectiveEUR >= EUR_THRESHOLD;

    let paypalDate = null, daysLeft = null;
    if (meetsThreshold) {
      const d = new Date(w.sun + 'T00:00:00');
      d.setDate(d.getDate() + PAYOUT_DAYS);
      paypalDate = toISO(d);
      daysLeft   = daysDiff(todayISO(), paypalDate);
    }

    const weekIdx = sortedAsc.indexOf(mon) + 1;
    const rawStatus = weekStatus[mon] || (meetsThreshold ? 'pending' : 'upcoming');
    const displayStatus = !meetsThreshold ? 'carry' : rawStatus;

    const badgeMap = {
      pending: ['badge-pending', 'Pending'],
      paid:    ['badge-paid',    'Paid ✓'],
      upcoming:['badge-upcoming','Upcoming'],
      carry:   ['badge-carry',   'Carry Fwd'],
    };
    const [badgeClass, badgeText] = badgeMap[displayStatus] || badgeMap.pending;

    // Countdown
    let countdownHTML = '';
    if (meetsThreshold && daysLeft !== null && rawStatus !== 'paid') {
      if (daysLeft > 0)
        countdownHTML = `<span class="countdown-text">PayPal in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}</span>`;
      else if (daysLeft === 0)
        countdownHTML = `<span class="countdown-text">PayPal Today!</span>`;
      else
        countdownHTML = `<span class="countdown-text">Overdue ${Math.abs(daysLeft)}d</span>`;
    } else if (!meetsThreshold && cm.carryIn > 0) {
      countdownHTML = `<span class="countdown-text countdown-carry">+ ${fmtEUR(cm.carryIn)} carried in</span>`;
    }

    // Rate source label
    const weekRates   = loadWeekRates();
    const rateSource  = weekRates[mon] ? '(custom)' : (liveRates?.usdEur ? '(live)' : '(default)');

    // Daily rows
    const sortedEntries = [...w.weekEntries].sort((a, b) => a.date.localeCompare(b.date));
    let rowsHTML = sortedEntries.length === 0
      ? `<tr><td colspan="7" class="no-entries">No entries this week</td></tr>`
      : sortedEntries.map(e => {
          const usd = Number(e.tasks) * TASK_USD;
          const eur = usd * w.usdEur;
          const inr = eur * w.eurInr;
          return `<tr>
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
        }).join('');

    const paidChecked = rawStatus === 'paid' ? 'checked' : '';

    const card = document.createElement('div');
    card.className = 'week-card' + (openWeeks.has(mon) ? ' open' : '');
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
          <div class="sum-item"><span class="sum-key">Threshold</span>
            <span class="sum-val" style="color:${meetsThreshold ? 'var(--green)' : 'var(--amber)'}">
              ${meetsThreshold ? '✓ Met' : `✗ Need ${fmtEUR(EUR_THRESHOLD - effectiveEUR)} more`}
            </span>
          </div>
          <div class="sum-item"><span class="sum-key">PayPal Date</span><span class="sum-val">${paypalDate ? formatDate(paypalDate) : '—'}</span></div>
          <div class="sum-item">
            <span class="sum-key">USD→EUR <small>${rateSource}</small></span>
            <span class="sum-val">${w.usdEur}</span>
          </div>
          <div class="sum-item">
            <span class="sum-key">EUR→INR <small>${rateSource}</small></span>
            <span class="sum-val">${fmt2(w.eurInr)}</span>
          </div>
        </div>

        <div class="summary-actions">
          ${countdownHTML}
          <div class="paid-toggle-wrap">
            <label class="toggle">
              <input type="checkbox" ${paidChecked} onchange="togglePaid('${mon}', this.checked)" />
              <span class="toggle-slider"></span>
            </label>
            <span>${rawStatus === 'paid' ? 'Paid ✓' : 'Mark Paid'}</span>
          </div>
          <button class="btn-secondary btn-sm" onclick="openRateModal('${mon}')">Override Rates</button>
        </div>

        <table class="entries-table">
          <thead>
            <tr>
              <th>Date</th><th>Tasks</th><th>USD</th>
              <th class="hide-mobile">EUR</th><th>INR Est.</th>
              <th class="hide-mobile">Notes</th><th></th>
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
    initApp();
  } else {
    err.classList.remove('hidden');
    document.getElementById('passcodeInput').value = '';
    setTimeout(() => err.classList.add('hidden'), 2500);
  }
}

document.getElementById('passcodeInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') checkPasscode();
});

function lockApp() {
  LS.remove('uhrs_auth');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('lockScreen').classList.remove('hidden');
  document.getElementById('passcodeInput').value = '';
}

async function initApp() {
  await fetchLiveRates();
  render();
  // Re-fetch rates every 6 hours silently
  setInterval(async () => {
    LS.remove(RATES_CACHE_KEY); // force refresh
    await fetchLiveRates();
    render();
  }, RATES_TTL_MS);
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
  const e = loadEntries().find(x => x.id === id);
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
  if (!date || isNaN(tasks) || tasks < 0) { err.classList.remove('hidden'); return; }
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
  saveEntries(loadEntries().filter(e => e.id !== id));
  render();
}

// ── PAID TOGGLE ───────────────────────────────
function togglePaid(mon, isPaid) {
  const s = loadWeekStatus();
  s[mon]  = isPaid ? 'paid' : 'pending';
  saveWeekStatus(s);
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
window.saveSettings = function () {
  const usdEur = parseFloat(document.getElementById('settingUsdEur').value);
  const eurInr  = parseFloat(document.getElementById('settingEurInr').value);
  if (!isNaN(usdEur) && !isNaN(eurInr)) {
    LS.set('uhrs_settings', { usdEur, eurInr });
    closeSettings();
    render();
  }
};

// ── WEEK RATE OVERRIDE MODAL ──────────────────
let rateModalMon = null;

function openRateModal(mon) {
  rateModalMon = mon;
  const wr = loadWeekRates();
  const r  = wr[mon] || liveRates || loadSettings();
  document.getElementById('rateModalTitle').textContent = `Override Rates — ${formatDate(mon)}`;
  document.getElementById('rateUsdEur').value = fmt2(r.usdEur);
  document.getElementById('rateEurInr').value = fmt2(r.eurInr);
  document.getElementById('rateModal').classList.remove('hidden');
}
function closeRateModal() {
  document.getElementById('rateModal').classList.add('hidden');
  rateModalMon = null;
}
function saveWeekRates() {
  if (!rateModalMon) return;
  const usdEur = parseFloat(document.getElementById('rateUsdEur').value);
  const eurInr  = parseFloat(document.getElementById('rateEurInr').value);
  if (!isNaN(usdEur) && !isNaN(eurInr)) {
    const wr = loadWeekRates();
    wr[rateModalMon] = { usdEur, eurInr };
    LS.set('uhrs_weekRates', wr);
    closeRateModal();
    render();
  }
}
function clearWeekRateOverride() {
  if (!rateModalMon) return;
  const wr = loadWeekRates();
  delete wr[rateModalMon];
  LS.set('uhrs_weekRates', wr);
  closeRateModal();
  render();
}

// ── MANUAL REFRESH BUTTON ─────────────────────
async function refreshRates() {
  LS.remove(RATES_CACHE_KEY);
  setRateBadge('loading');
  await fetchLiveRates();
  render();
}

// ── CLOSE MODALS ON OVERLAY CLICK ─────────────
['entryModal', 'settingsModal', 'rateModal'].forEach(id => {
  document.getElementById(id).addEventListener('click', e => {
    if (e.target.id === id) document.getElementById(id).classList.add('hidden');
  });
});

// ── UID ───────────────────────────────────────
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ── INIT ──────────────────────────────────────
(function init() {
  if (LS.get('uhrs_auth') === '1') {
    document.getElementById('lockScreen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    initApp();
  }
})();
