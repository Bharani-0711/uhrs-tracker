/* ════════════════════════════════════════════
   UHRS TRACKER — app.js
   Rates: Open Exchange Rates (openexchangerates.org)
   - Past weeks  : Saturday 23:59 UTC rate (historical endpoint)
   - Current week: Live, refreshed every hour
   ════════════════════════════════════════════ */

'use strict';

// ── CONSTANTS ─────────────────────────────────
const PASSCODE       = '9386959494';
const OXR_APP_ID     = '868dd0c7b6f442d78b62a071be110ad0';
const OXR_BASE       = 'https://openexchangerates.org/api';
const TASK_USD       = 0.25;
const EUR_THRESHOLD  = 10;
const PAYOUT_DAYS    = 39;
const PAYPAL_FEE     = 0.02;

// ── STORAGE ───────────────────────────────────
const LS = {
  get:    k    => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set:    (k,v)=> localStorage.setItem(k, JSON.stringify(v)),
  remove: k    => localStorage.removeItem(k),
};

const loadEntries    = ()  => LS.get('uhrs_entries')    || [];
const saveEntries    = e   => LS.set('uhrs_entries', e);
const loadWeekStatus = ()  => LS.get('uhrs_weekStatus') || {};
const saveWeekStatus = w   => LS.set('uhrs_weekStatus', w);
// rateCache: { 'YYYY-MM-DD': { usdEur, eurInr, fetchedAt } }
// key = saturday date for past weeks, 'live' for current week
const loadRateCache  = ()  => LS.get('uhrs_rateCache')  || {};
const saveRateCache  = rc  => LS.set('uhrs_rateCache', rc);

// ── DATE HELPERS ──────────────────────────────
const toISO = d => d.toISOString().slice(0, 10);

function todayISO() { return toISO(new Date()); }

function getMondayOfDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return toISO(d);
}

function getSaturdayOfWeek(mondayStr) {
  const d = new Date(mondayStr + 'T00:00:00');
  d.setDate(d.getDate() + 5); // Mon+5 = Sat
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
  return Math.round(
    (new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000
  );
}

// Is this week fully past? (Sunday has passed)
function isWeekComplete(mondayStr) {
  const sun = getSundayOfWeek(mondayStr);
  return todayISO() > sun;
}

function isCurrentWeek(mondayStr) {
  return mondayStr === getMondayOfDate(todayISO());
}

// ── OXR FETCH ─────────────────────────────────

// Fetch latest live rates (for current week)
async function fetchLiveRates() {
  const url = `${OXR_BASE}/latest.json?app_id=${OXR_APP_ID}&symbols=EUR,INR`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error('OXR latest: HTTP ' + res.status);
  const data = await res.json();
  return oxrToRates(data);
}

// Fetch historical rates at Saturday 23:59 UTC
// OXR historical endpoint: /historical/YYYY-MM-DD.json
async function fetchHistoricalRates(saturdayStr) {
  const url = `${OXR_BASE}/historical/${saturdayStr}.json?app_id=${OXR_APP_ID}&symbols=EUR,INR`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error('OXR historical: HTTP ' + res.status);
  const data = await res.json();
  return oxrToRates(data);
}

function oxrToRates(data) {
  // OXR base is USD
  const usdEur = parseFloat(data.rates.EUR);
  const usdInr = parseFloat(data.rates.INR);
  const eurInr = usdInr / usdEur; // EUR → INR
  return { usdEur, eurInr, usdInr };
}

// ── RATE RESOLUTION ───────────────────────────
// Returns { usdEur, eurInr } for a given week monday
// Past weeks → Saturday 23:59 historical rate (cached forever)
// Current week → live rate (cached 1 hour)

async function getRatesForWeek(mondayStr) {
  const rc = loadRateCache();

  if (isCurrentWeek(mondayStr)) {
    // Live rate, refresh every hour
    const cached = rc['live'];
    const ONE_HOUR = 60 * 60 * 1000;
    if (cached && cached.fetchedAt && (Date.now() - cached.fetchedAt) < ONE_HOUR) {
      return cached;
    }
    setBadge('loading');
    const rates = await fetchLiveRates();
    rc['live'] = { ...rates, fetchedAt: Date.now() };
    saveRateCache(rc);
    setBadge('live');
    return rc['live'];

  } else {
    // Past week — use Saturday 23:59 rate, cache forever
    const satKey = getSaturdayOfWeek(mondayStr);
    if (rc[satKey]) return rc[satKey]; // already cached, never re-fetch

    const rates = await fetchHistoricalRates(satKey);
    rc[satKey] = { ...rates, fetchedAt: Date.now() };
    saveRateCache(rc);
    return rc[satKey];
  }
}

// ── RATE BADGE / STRIP ────────────────────────
function setBadge(state, extra) {
  const badge = document.getElementById('rateBadge');
  if (!badge) return;
  if (state === 'loading') {
    badge.textContent = '⟳ Fetching…';
    badge.style.cssText = 'background:#f3f4f6;color:#6b7280';
  } else if (state === 'live') {
    badge.textContent = '✓ Live · OXR';
    badge.style.cssText = 'background:#f0fdf4;color:#16a34a';
  } else if (state === 'error') {
    badge.textContent = '✗ Rate error';
    badge.style.cssText = 'background:#fef2f2;color:#dc2626';
  }
}

function updateRateStrip(usdEur, eurInr, usdInr) {
  const strip = document.getElementById('rateStrip');
  if (!strip) return;
  strip.textContent =
    `1 USD = €${usdEur.toFixed(4)}  ·  1 EUR = ₹${eurInr.toFixed(2)}  ·  1 USD = ₹${usdInr.toFixed(2)}`;
}

// ── FORMAT ────────────────────────────────────
const fmt2   = n => Number(n).toFixed(2);
const fmt4   = n => Number(n).toFixed(4);
const fmtINR = n => '₹' + Number(n).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const fmtUSD = n => '$' + fmt2(n);
const fmtEUR = n => '€' + fmt2(n);

// ── WEEK KEYS ─────────────────────────────────
function getWeekKeys(entries) {
  const keys = new Set([getMondayOfDate(todayISO())]);
  entries.forEach(e => keys.add(getMondayOfDate(e.date)));
  return [...keys].sort().reverse(); // newest first
}

// ── CARRY-FORWARD PASS ────────────────────────
// Must be called after all rates are loaded
function buildCarryMap(weekKeys, entries, ratesMap) {
  const sortedAsc = [...weekKeys].reverse();
  let carryEUR = 0;
  const carryMap = {};

  for (const mon of sortedAsc) {
    const r = ratesMap[mon] || { usdEur: 0.92, eurInr: 90 };
    const weekEntries = entries.filter(e => getMondayOfDate(e.date) === mon);
    const tasks = weekEntries.reduce((s, e) => s + Number(e.tasks || 0), 0);
    const eur   = tasks * TASK_USD * r.usdEur;
    const effectiveEUR = eur + carryEUR;
    carryMap[mon] = { carryIn: carryEUR, ownEUR: eur, effectiveEUR };
    carryEUR = effectiveEUR < EUR_THRESHOLD ? effectiveEUR : 0;
  }
  return carryMap;
}

// ── MAIN RENDER ───────────────────────────────
async function render() {
  const entries    = loadEntries();
  const weekStatus = loadWeekStatus();
  const weekKeys   = getWeekKeys(entries);

  // Load all rates in parallel
  const ratesMap = {};
  await Promise.all(weekKeys.map(async mon => {
    try {
      ratesMap[mon] = await getRatesForWeek(mon);
    } catch (err) {
      console.error('Rate fetch failed for', mon, err);
      setBadge('error');
      // Use last known from cache or hardcoded fallback
      const rc = loadRateCache();
      ratesMap[mon] = rc['live'] || rc[getSaturdayOfWeek(mon)] || { usdEur: 0.92, eurInr: 90, usdInr: 83.5 };
    }
  }));

  // Update live strip with current week rates
  const currentMon = getMondayOfDate(todayISO());
  const liveR = ratesMap[currentMon];
  if (liveR) {
    updateRateStrip(liveR.usdEur, liveR.eurInr, liveR.usdInr || liveR.usdEur * liveR.eurInr);
    setBadge('live');
  }

  const carryMap = buildCarryMap(weekKeys, entries, ratesMap);

  // Stats
  let pendingINR = 0, thisWeekTasks = 0, lifetimeTasks = 0;
  for (const mon of weekKeys) {
    const r   = ratesMap[mon] || {};
    const cm  = carryMap[mon] || {};
    const weekEntries = entries.filter(e => getMondayOfDate(e.date) === mon);
    const tasks = weekEntries.reduce((s, e) => s + Number(e.tasks || 0), 0);
    lifetimeTasks += tasks;
    if (mon === currentMon) thisWeekTasks = tasks;
    const effEUR = cm.effectiveEUR || 0;
    const effINR = effEUR * (r.eurInr || 90) * (1 - PAYPAL_FEE);
    const status = weekStatus[mon] || (effEUR >= EUR_THRESHOLD ? 'pending' : 'upcoming');
    if (status === 'pending' && effEUR >= EUR_THRESHOLD) pendingINR += effINR;
  }

  document.getElementById('statPending').textContent   = fmtINR(pendingINR);
  document.getElementById('statWeekTasks').textContent = thisWeekTasks;
  document.getElementById('statLifetime').textContent  = lifetimeTasks;

  // Preserve open state
  const list = document.getElementById('weekList');
  const openWeeks = new Set(
    [...list.querySelectorAll('.week-card.open')].map(c => c.dataset.mon)
  );
  list.innerHTML = '';

  if (weekKeys.length === 0) {
    list.innerHTML = '<p class="empty-msg">No entries yet. Add your first daily entry.</p>';
    return;
  }

  const sortedAsc = [...weekKeys].reverse();

  for (const mon of weekKeys) {
    const r   = ratesMap[mon] || { usdEur: 0.92, eurInr: 90, usdInr: 83.5 };
    const cm  = carryMap[mon] || { carryIn: 0, ownEUR: 0, effectiveEUR: 0 };
    const weekEntries = entries.filter(e => getMondayOfDate(e.date) === mon);
    const totalTasks  = weekEntries.reduce((s, e) => s + Number(e.tasks || 0), 0);
    const sun         = getSundayOfWeek(mon);
    const sat         = getSaturdayOfWeek(mon);

    const ownUSD = totalTasks * TASK_USD;
    const ownEUR = ownUSD * r.usdEur;
    const effEUR = cm.effectiveEUR;
    const effINR = effEUR * r.eurInr * (1 - PAYPAL_FEE);
    const meetsThreshold = effEUR >= EUR_THRESHOLD;

    // Payout countdown
    let paypalDate = null, daysLeft = null;
    if (meetsThreshold) {
      const d = new Date(sun + 'T00:00:00');
      d.setDate(d.getDate() + PAYOUT_DAYS);
      paypalDate = toISO(d);
      daysLeft   = daysDiff(todayISO(), paypalDate);
    }

    const weekIdx  = sortedAsc.indexOf(mon) + 1;
    const rawStatus = weekStatus[mon] || (meetsThreshold ? 'pending' : 'upcoming');
    const displayStatus = !meetsThreshold ? 'carry' : rawStatus;

    const badgeMap = {
      pending: ['badge-pending', 'Pending'],
      paid:    ['badge-paid',    'Paid ✓'],
      upcoming:['badge-upcoming','Upcoming'],
      carry:   ['badge-carry',   'Carry Fwd'],
    };
    const [badgeClass, badgeText] = badgeMap[displayStatus] || badgeMap.pending;

    // Rate source label
    const rateLabel = isCurrentWeek(mon)
      ? '<span class="rate-src live-src">● Live</span>'
      : `<span class="rate-src hist-src">Sat ${formatDate(sat)}</span>`;

    // Countdown chip
    let countdownHTML = '';
    if (meetsThreshold && daysLeft !== null && rawStatus !== 'paid') {
      if (daysLeft > 0)
        countdownHTML = `<span class="countdown-text">PayPal in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}</span>`;
      else if (daysLeft === 0)
        countdownHTML = `<span class="countdown-text">PayPal Today!</span>`;
      else
        countdownHTML = `<span class="countdown-text">Overdue ${Math.abs(daysLeft)}d</span>`;
    } else if (!meetsThreshold && cm.carryIn > 0) {
      countdownHTML = `<span class="countdown-text countdown-carry">+${fmtEUR(cm.carryIn)} carried in</span>`;
    }

    // Daily rows
    const sortedEntries = [...weekEntries].sort((a, b) => a.date.localeCompare(b.date));
    const rowsHTML = sortedEntries.length === 0
      ? `<tr><td colspan="7" class="no-entries">No entries this week</td></tr>`
      : sortedEntries.map(e => {
          const usd = Number(e.tasks) * TASK_USD;
          const eur = usd * r.usdEur;
          const inr = eur * r.eurInr;
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
        <span class="week-range">${formatDate(mon)} – ${formatDate(sun)}</span>
        <div class="week-meta">
          <span class="week-tasks">${totalTasks} tasks</span>
          <span class="week-inr">${fmtINR(effINR)}</span>
          <span class="badge ${badgeClass}">${badgeText}</span>
          <span class="week-arrow">▾</span>
        </div>
      </div>
      <div class="week-body">

        <div class="week-summary">
          <div class="sum-item"><span class="sum-key">Tasks</span><span class="sum-val">${totalTasks}</span></div>
          <div class="sum-item"><span class="sum-key">USD Earned</span><span class="sum-val">${fmtUSD(ownUSD)}</span></div>
          <div class="sum-item"><span class="sum-key">EUR (own)</span><span class="sum-val">${fmtEUR(ownEUR)}</span></div>
          <div class="sum-item"><span class="sum-key">EUR (effective)</span><span class="sum-val">${fmtEUR(effEUR)}</span></div>
          <div class="sum-item"><span class="sum-key">INR (after 2%)</span><span class="sum-val">${fmtINR(effINR)}</span></div>
          <div class="sum-item">
            <span class="sum-key">€10 Threshold</span>
            <span class="sum-val" style="color:${meetsThreshold ? 'var(--green)' : 'var(--amber)'}">
              ${meetsThreshold ? '✓ Met' : `Need ${fmtEUR(EUR_THRESHOLD - effEUR)}`}
            </span>
          </div>
          <div class="sum-item"><span class="sum-key">PayPal Date</span><span class="sum-val">${paypalDate ? formatDate(paypalDate) : '—'}</span></div>
          <div class="sum-item">
            <span class="sum-key">USD→EUR ${rateLabel}</span>
            <span class="sum-val">${fmt4(r.usdEur)}</span>
          </div>
          <div class="sum-item">
            <span class="sum-key">EUR→INR ${rateLabel}</span>
            <span class="sum-val">${fmt2(r.eurInr)}</span>
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
  document.querySelector(`.week-card[data-mon="${mon}"]`)?.classList.toggle('open');
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
  setBadge('loading');
  await render();
  // Auto-refresh live rates every hour
  setInterval(async () => {
    // Remove live cache to force re-fetch
    const rc = loadRateCache();
    delete rc['live'];
    saveRateCache(rc);
    await render();
  }, 60 * 60 * 1000);
}

// Manual refresh
async function refreshRates() {
  const rc = loadRateCache();
  delete rc['live'];
  saveRateCache(rc);
  setBadge('loading');
  await render();
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

// ── CLOSE MODALS ON OVERLAY CLICK ─────────────
document.getElementById('entryModal').addEventListener('click', e => {
  if (e.target.id === 'entryModal') closeModal();
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
