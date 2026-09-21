/* =========================================================
   Smart Bus Pass - Frontend Logic (connected to the Flask API)

   Backend:  https://bus-pass-system-698m.onrender.com

   MULTIPLE ACCOUNTS
   Every account that logs in on this browser is saved with its own
   login token:   bpms_accounts = [{ token, user }, ...]
   The account currently in use is saved as its user id:  bpms_active
   api() always sends the ACTIVE account's token, so switching account
   (top bar > your name) changes whose data every page loads.
   ========================================================= */

const API_BASE = 'https://bus-pass-system-698m.onrender.com/api';

const STORE = { ACCOUNTS: 'bpms_accounts', ACTIVE: 'bpms_active' };
const MAX_ACCOUNTS = 5;

/* The backend stores only the pass type, so how long a pass lasts is
   worked out here from the approval date. */
const PASS_TYPES = {
  daily:     { label: 'Daily',     days: 1 },
  monthly:   { label: 'Monthly',   days: 30 },
  quarterly: { label: 'Quarterly', days: 90 },
  yearly:    { label: 'Yearly',    days: 365 }
};

/* One-way or round trip. The backend prices round trip at exactly 2x one-way. */
const TRIP_TYPES = {
  one_way:    { label: 'One-way',    note: 'One direction' },
  round_trip: { label: 'Round trip', note: 'Both directions' }
};

/* Price from the pricing reply: pricing[passType][tripType].
   A flat number (no trip split) is NOT accepted, because it would show the same price for
   one-way and round trip. The pages fall back to the plain route fare instead. */
function priceFor(pricing, passType, tripType) {
  const v = pricing && passType ? pricing[passType] : null;
  if (v && typeof v === 'object' && v[tripType] != null) return v[tripType];
  return null;
}
/* Is this pricing reply split by trip type at all? */
function isTripPricing(pricing) {
  return !!pricing && Object.keys(pricing).some(function (k) { return pricing[k] && typeof pricing[k] === 'object'; });
}

/* ---------- Small helpers ---------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
function money(n) {
  n = Number(n || 0);
  // whole rupees show as 600, fares with paise show as 121.62
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
}

/* The API sends UTC times without a "Z" (e.g. 2026-09-20T10:00:00.123456).
   Without the Z the browser would read them as local time, so add it. */
function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  let s = String(v).replace(/(\.\d{3})\d+/, '$1');
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(s)) s += 'Z';
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function formatDate(v) {
  const d = parseDate(v);
  if (!d) return '-';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function daysLeft(date) {
  const d = parseDate(date);
  if (!d) return 0;
  return Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86400000));
}
function validityPercent(app) {
  const start = parseDate(app.reviewed_on), end = parseDate(app.expiry);
  if (!start || !end) return 0;
  const total = end - start, left = end - Date.now();
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((left / total) * 100)));
}

/* ---------- Icons (inline SVG, inherit text colour) ---------- */
const ICONS = {
  bus: '<rect x="4" y="3" width="16" height="15" rx="3"/><path d="M4 11h16"/><circle cx="8" cy="14.5" r=".8"/><circle cx="16" cy="14.5" r=".8"/><path d="M6.5 18v2.5M17.5 18v2.5"/>',
  bell: '<path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  ticket: '<path d="M4 8a2 2 0 0 0 0 8v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2a2 2 0 0 1 0-8V6a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1Z"/><path d="M14 5v14" stroke-dasharray="2 2.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  logout: '<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="M15 8l4 4-4 4M19 12H9"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/>',
  printer: '<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="8" rx="2"/><path d="M7 14h10v6H7z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  inbox: '<path d="M4 13 6.5 5h11L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z"/><path d="M4 13h4.5a3.5 3.5 0 0 0 7 0H20"/>'
};
function icon(name, size) {
  size = size || 20;
  return '<svg class="ic" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    (ICONS[name] || '') + '</svg>';
}

/* ---------- Avatars ---------- */
const AVATAR_COLORS = ['#c9382d', '#0f7a5f', '#3f51b5', '#9a5b00', '#4a5568', '#8e3b8e'];
function avatarColor(email) {
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
function avatar(user, size) {
  size = size || 32;
  return '<span class="avatar" style="width:' + size + 'px;height:' + size + 'px;background:' +
    avatarColor(user.email || '') + ';font-size:' + Math.round(size * 0.4) + 'px">' + esc(initials(user.name)) + '</span>';
}

/* =========================================================
   TALKING TO THE BACKEND
   ========================================================= */

/* Render's free servers sleep when idle, so the first request can take
   up to a minute. Show a notice instead of a frozen page. */
let slowRequests = 0;
function setWakeNotice(show) {
  let el = document.getElementById('wakeNotice');
  if (show && !el) {
    el = document.createElement('div');
    el.id = 'wakeNotice';
    el.className = 'wake';
    el.setAttribute('role', 'status');
    el.textContent = 'The server is waking up. This can take up to a minute, please wait.';
    document.body.appendChild(el);
  } else if (!show && el) {
    el.remove();
  }
}

function errorMessage(d) {
  if (!d) return '';
  if (Array.isArray(d.errors) && d.errors.length) return d.errors.join(' ');
  return d.message || d.msg || '';
}

/* Every request goes through here. Options: { method, body, auth:false } */
async function api(path, opts) {
  opts = opts || {};
  const token = opts.auth === false ? null : getActiveToken();

  let slow = false;
  const timer = setTimeout(function () { slow = true; slowRequests++; setWakeNotice(true); }, 3500);

  try {
    let res;
    try {
      res = await fetch(API_BASE + path, {
        method: opts.method || 'GET',
        headers: Object.assign(
          { 'Content-Type': 'application/json' },
          token ? { Authorization: 'Bearer ' + token } : {}
        ),
        body: opts.body ? JSON.stringify(opts.body) : undefined
      });
    } catch (netErr) {
      console.error('Request failed:', netErr);
      throw new Error('Cannot reach the server. Check your internet connection and try again.');
    }

    let data = {};
    try { data = await res.json(); } catch (e) { /* not JSON */ }

    // Login token missing, expired or invalid
    if (token && (res.status === 401 || (res.status === 422 && data.msg))) {
      return sessionExpired(token);
    }
    if (!res.ok || data.success === false) {
      throw new Error(errorMessage(data) || 'Something went wrong (' + res.status + ').');
    }
    return data;
  } finally {
    clearTimeout(timer);
    if (slow) { slowRequests--; if (slowRequests <= 0) setWakeNotice(false); }
  }
}

/* =========================================================
   AUTH + MULTI-ACCOUNT
   ========================================================= */
function getAccounts() {
  try {
    const list = JSON.parse(localStorage.getItem(STORE.ACCOUNTS) || '[]');
    return Array.isArray(list) ? list : [];
  } catch (e) { return []; }
}
function saveAccounts(list) { localStorage.setItem(STORE.ACCOUNTS, JSON.stringify(list)); }
function getActiveId() { return Number(localStorage.getItem(STORE.ACTIVE)) || null; }
function getActiveAccount() {
  const id = getActiveId();
  return getAccounts().find(a => a.user.id === id) || null;
}
function getCurrentUser() { const a = getActiveAccount(); return a ? a.user : null; }
function getActiveToken() { const a = getActiveAccount(); return a ? a.token : null; }
function getSignedInAccounts() { return getAccounts().map(a => a.user); }
function homeFor(user) { return user && user.role === 'admin' ? 'admin.html' : 'dashboard.html'; }

function addAccount(token, user) {
  const list = getAccounts().filter(a => a.user.id !== user.id);
  list.push({ token: token, user: user });
  saveAccounts(list);
  localStorage.setItem(STORE.ACTIVE, String(user.id));
}

async function registerUser(details) {
  try {
    await api('/auth/register', { method: 'POST', auth: false, body: details });
    return { ok: true };
  } catch (e) { return { ok: false, message: e.message }; }
}

async function loginUser(email, password) {
  try {
    const data = await api('/auth/login', { method: 'POST', auth: false, body: { email: email, password: password } });
    const token = data.access_token || data.token;
    const user = data.user;
    if (!token || !user) return { ok: false, message: 'The server sent an unexpected reply. Try again.' };
    const already = getAccounts().some(a => a.user.id === user.id);
    if (!already && getAccounts().length >= MAX_ACCOUNTS) {
      return { ok: false, message: 'You can be signed in to ' + MAX_ACCOUNTS + ' accounts at once. Log out of one first.' };
    }
    addAccount(token, user);
    return { ok: true, user: user };
  } catch (e) { return { ok: false, message: e.message }; }
}

function switchAccount(userId) {
  const account = getAccounts().find(a => a.user.id === Number(userId));
  if (!account) return;
  localStorage.setItem(STORE.ACTIVE, String(account.user.id));
  window.location.href = homeFor(account.user);
}

/* Log out of the ACTIVE account only; fall back to another signed-in one. */
function logoutUser() {
  const current = getCurrentUser();
  const remaining = getAccounts().filter(a => !current || a.user.id !== current.id);
  saveAccounts(remaining);
  if (remaining.length) {
    const next = remaining[remaining.length - 1];
    localStorage.setItem(STORE.ACTIVE, String(next.user.id));
    flash('Logged out of ' + (current ? current.name : 'account') + '. Now using ' + next.user.name + '.');
    window.location.href = homeFor(next.user);
  } else {
    localStorage.removeItem(STORE.ACTIVE);
    window.location.href = 'login.html';
  }
}
function logoutAllAccounts() {
  localStorage.removeItem(STORE.ACCOUNTS);
  localStorage.removeItem(STORE.ACTIVE);
  window.location.href = 'login.html';
}

/* A login token was rejected. Remove that account (matched by token, so two
   requests failing at once cannot remove the wrong account) and move on. */
function sessionExpired(token) {
  const accounts = getAccounts();
  const gone = accounts.find(a => a.token === token);
  if (gone) {
    const wasActive = gone.user.id === getActiveId();
    const left = accounts.filter(a => a !== gone);
    saveAccounts(left);
    if (wasActive) {
      if (left.length) {
        const next = left[left.length - 1];
        localStorage.setItem(STORE.ACTIVE, String(next.user.id));
        flash('The login for ' + gone.user.name + ' expired. Now using ' + next.user.name + '.');
        window.location.href = homeFor(next.user);
      } else {
        localStorage.removeItem(STORE.ACTIVE);
        flash('Your login expired. Please log in again.');
        window.location.href = 'login.html';
      }
    }
  }
  const err = new Error('Login expired');
  err.silent = true;      // pages skip showing this one, the redirect explains it
  throw err;
}

/* Redirect helpers to protect pages */
function requireLogin() {
  const user = getCurrentUser();
  if (!user) { window.location.href = 'login.html'; return null; }
  return user;
}
function requireAdmin() {
  const user = requireLogin();
  if (user && user.role !== 'admin') { window.location.href = 'dashboard.html'; return null; }
  return user;
}
/* Admin accounts have no user pages, so send them to the admin panel */
function requireUser() {
  const user = requireLogin();
  if (user && user.role === 'admin') { window.location.href = 'admin.html'; return null; }
  return user;
}

/* =========================================================
   DATA (one small function per backend endpoint)
   ========================================================= */

/* Adds the things the backend does not send: expiry date, what to show, a
   readable pass number. A pass counts as expired once its days have run out,
   even though the backend still says "approved" until it is renewed. */
function decorate(a) {
  const info = PASS_TYPES[a.pass_type] || { label: cap(a.pass_type), days: 30 };
  const start = (a.status === 'approved' || a.status === 'expired') ? parseDate(a.reviewed_on) : null;
  const expiry = start ? new Date(start.getTime() + info.days * 86400000) : null;
  const lapsed = a.status === 'approved' && expiry && expiry.getTime() < Date.now();
  return Object.assign({}, a, {
    typeLabel: info.label,
    tripLabel: (TRIP_TYPES[a.trip_type] || TRIP_TYPES.one_way).label,   // older applications have no trip_type
    days: info.days,
    expiry: expiry,
    state: lapsed ? 'expired' : a.status,
    passId: 'BP-' + String(a.id).padStart(4, '0')
  });
}

async function fetchRoutes() {
  const d = await api('/admin/routes', { auth: false });          // public endpoint
  return d.routes || [];
}
async function fetchMyApplications() {
  const d = await api('/passes/my-applications');
  return (d.applications || []).map(decorate);
}
async function fetchAllApplications() {
  const d = await api('/admin/applications');
  return (d.applications || []).map(decorate);
}
/* Price of each pass type for one route: { monthly, quarterly, yearly } (public endpoint) */
function fetchPricing(routeId) { return api('/passes/pricing/' + routeId, { auth: false }); }
function applyForPass(routeId, passType, tripType) {
  return api('/passes/apply', { method: 'POST', body: { route_id: Number(routeId), pass_type: passType, trip_type: tripType || 'one_way' } });
}
function renewPass(applicationId) {
  return api('/passes/renew/' + applicationId, { method: 'POST' });
}
function setApplicationStatus(applicationId, action) {            // action: 'approve' | 'reject'
  return api('/admin/applications/' + applicationId + '/' + action, { method: 'PUT' });
}
function addRoute(route) {
  return api('/admin/routes', { method: 'POST', body: route });
}
function fetchNotifications() { return api('/passes/notifications'); }
function markNotificationsRead() { return api('/passes/notifications/read', { method: 'POST' }); }
function verifyPass(applicationId) { return api('/passes/verify/' + applicationId, { auth: false }); }

/* ---------- Route helpers ---------- */
function routeName(r) { return r ? r.source + ' to ' + r.destination : 'Route removed'; }
function routeLabel(r) { return 'Route ' + r.route_number + ' - ' + r.source + ' to ' + r.destination; }
function plateHTML(r, large) {
  return '<span class="plate' + (large ? ' plate-lg' : '') + '">' + esc(r ? r.route_number : '-') + '</span>';
}

/* Notifications only have a message, so work out the heading and icon */
function describeNotification(n) {
  const m = String(n.message || '').toLowerCase();
  if (m.indexOf('approved') >= 0) return { title: 'Pass approved', kind: 'ok', icon: 'check' };
  if (m.indexOf('rejected') >= 0) return { title: 'Pass rejected', kind: 'bad', icon: 'x' };
  if (m.indexOf('submitted') >= 0) return { title: 'Application submitted', kind: '', icon: 'mail' };
  return { title: 'Update', kind: '', icon: 'bell' };
}

/* ---------- Toast + one-shot messages across a redirect ---------- */
function showToast(message, isError) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = 'toast' + (isError ? ' error' : '');
  toast.style.display = 'block';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(function () { toast.style.display = 'none'; }, 3800);
}
function flash(message) {
  try { sessionStorage.setItem('bpms_flash', message); } catch (e) { /* ignore */ }
}
function showFlash() {
  let msg = null;
  try { msg = sessionStorage.getItem('bpms_flash'); sessionStorage.removeItem('bpms_flash'); } catch (e) { /* ignore */ }
  if (msg) showToast(msg);
}

function badgeForStatus(status) {
  const map = {
    pending: '<span class="badge badge-pending">Pending</span>',
    approved: '<span class="badge badge-approved">Approved</span>',
    rejected: '<span class="badge badge-rejected">Rejected</span>',
    expired: '<span class="badge badge-expired">Expired</span>'
  };
  return map[status] || esc(status);
}

function emptyState(iconName, message, ctaHref, ctaLabel, tight) {
  return '<div class="empty-state' + (tight ? ' tight' : '') + '"><div class="ic-wrap">' + icon(iconName, 26) + '</div>' +
    '<p>' + message + '</p>' +
    (ctaHref ? '<a class="btn btn-primary btn-sm" href="' + ctaHref + '">' + ctaLabel + '</a>' : '') + '</div>';
}
function loadingHTML(text) { return '<div class="loading">' + (text || 'Loading...') + '</div>'; }

/* Shows a failed load with a Try again button. Silent errors (login expired) are skipped. */
function showError(el, err, retry) {
  if (err && err.silent) return;
  el.innerHTML = '<div class="inline-error"><p>' + esc((err && err.message) || 'Could not load this.') + '</p>' +
    (retry ? '<button type="button" class="btn btn-outline btn-sm">Try again</button>' : '') + '</div>';
  const b = el.querySelector('button');
  if (b) b.addEventListener('click', function () { el.innerHTML = loadingHTML(); retry(); });
}

function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) { btn.dataset.label = btn.textContent; btn.textContent = label || 'Please wait...'; btn.disabled = true; }
  else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
}

/* =========================================================
   NAVBAR (rendered by JS so every page shares one copy)
   ========================================================= */
const USER_LINKS = [
  { page: 'home', href: 'index.html', label: 'Home' },
  { page: 'dashboard', href: 'dashboard.html', label: 'Dashboard' },
  { page: 'apply', href: 'apply.html', label: 'Apply for pass' },
  { page: 'track', href: 'track.html', label: 'Track status' },
  { page: 'mypass', href: 'mypass.html', label: 'My pass' }
];

function brandHTML(href) {
  return '<a class="brand" href="' + href + '"><span class="brand-mark">' + icon('bus', 20) + '</span>' +
    '<span>Smart Bus Pass</span></a>';
}

function accountSwitcherHTML(user) {
  const accounts = getSignedInAccounts();
  const canAdd = accounts.length < MAX_ACCOUNTS;
  const first = user.name.split(' ')[0];
  return '' +
  '<div class="acct" id="acct">' +
    '<button type="button" class="acct-btn" id="acctBtn" aria-haspopup="true" aria-expanded="false" aria-controls="acctPanel">' +
      avatar(user, 32) + '<span class="acct-name">' + esc(first) + '</span>' + icon('chevron', 16) +
    '</button>' +
    '<div class="acct-panel" id="acctPanel" hidden>' +
      '<div class="acct-title">Accounts on this device</div>' +
      '<ul class="acct-list">' +
        accounts.map(function (a) {
          const isCurrent = a.id === user.id;
          return '<li><button type="button" class="acct-item' + (isCurrent ? ' current' : '') + '" data-id="' + a.id + '"' +
            (isCurrent ? ' aria-current="true"' : '') + '>' +
            avatar(a, 36) +
            '<span class="acct-meta"><b>' + esc(a.name) + '</b><small>' + esc(a.email) + '</small></span>' +
            (a.role === 'admin' ? '<span class="tag">Admin</span>' : '') +
            (isCurrent ? icon('check', 18) : '') +
          '</button></li>';
        }).join('') +
      '</ul>' +
      '<div class="acct-actions">' +
        (canAdd
          ? '<a class="acct-action" href="login.html?add=1">' + icon('plus', 18) + 'Add another account</a>'
          : '<div class="acct-note">You can be signed in to ' + MAX_ACCOUNTS + ' accounts at once.</div>') +
        '<button type="button" class="acct-action" id="logoutOne">' + icon('logout', 18) + 'Log out of ' + esc(first) + '</button>' +
        (accounts.length > 1
          ? '<button type="button" class="acct-action danger" id="logoutAll">Log out of all accounts</button>'
          : '') +
      '</div>' +
    '</div>' +
  '</div>';
}

function wireAccountSwitcher() {
  const btn = document.getElementById('acctBtn');
  const panel = document.getElementById('acctPanel');
  if (!btn || !panel) return;

  function setOpen(open) {
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  btn.addEventListener('click', function (e) { e.stopPropagation(); setOpen(panel.hidden); });
  document.addEventListener('click', function (e) {
    if (!panel.hidden && !panel.contains(e.target)) setOpen(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !panel.hidden) { setOpen(false); btn.focus(); }
  });
  panel.querySelectorAll('.acct-item:not(.current)').forEach(function (b) {
    b.addEventListener('click', function () { switchAccount(b.dataset.id); });
  });
  const one = document.getElementById('logoutOne');
  if (one) one.addEventListener('click', logoutUser);
  const all = document.getElementById('logoutAll');
  if (all) all.addEventListener('click', logoutAllAccounts);
}

/* Bell badge = unread notifications of the active account */
function setBell(count) {
  const badge = document.getElementById('notifBadge');
  if (!badge) return;
  badge.textContent = count || '';
  badge.style.display = count ? '' : 'none';
  if (badge.parentElement) {
    badge.parentElement.setAttribute('aria-label', 'Notifications' + (count ? ', ' + count + ' unread' : ''));
  }
}
async function refreshBell() {
  try { const d = await fetchNotifications(); setBell(d.unread_count || 0); }
  catch (e) { /* the bell is optional, ignore failures */ }
}

/* Renders the top bar. Logged-out visitors get a simple public bar. */
function initNavbar(activePage) {
  const host = document.getElementById('topbar');
  const user = getCurrentUser();
  if (host) {
    host.className = 'topbar';
    if (!user) {
      host.innerHTML = '<div class="topbar-inner">' + brandHTML('index.html') +
        '<div class="topbar-right">' +
          '<a class="btn btn-ghost btn-sm" href="login.html">Log in</a>' +
          '<a class="btn btn-accent btn-sm" href="register.html">Register</a>' +
        '</div></div>';
    } else {
      const isAdmin = user.role === 'admin';
      const links = isAdmin
        ? [{ page: 'home', href: 'index.html', label: 'Home' }, { page: 'admin', href: 'admin.html', label: 'Applications' }]
        : USER_LINKS;
      host.innerHTML = '<div class="topbar-inner">' +
        brandHTML('index.html') + (isAdmin ? '<span class="admin-tag">Admin</span>' : '') +
        '<nav class="topnav" aria-label="Main">' +
          links.map(function (l) {
            return '<a class="nav-link' + (l.page === activePage ? ' active' : '') + '" href="' + l.href + '"' +
              (l.page === activePage ? ' aria-current="page"' : '') + '>' + l.label + '</a>';
          }).join('') +
        '</nav>' +
        '<div class="topbar-right">' +
          (isAdmin ? '' :
            '<a class="icon-btn" href="notifications.html" aria-label="Notifications">' + icon('bell', 20) +
              '<span id="notifBadge" class="count-dot" style="display:none"></span></a>') +
          accountSwitcherHTML(user) +
        '</div></div>';
      wireAccountSwitcher();
      if (!isAdmin && activePage !== 'notifications') refreshBell();
    }
  }
  showFlash();
}

/* If accounts exist but none is marked active (cleared storage), pick the last one */
(function fixActiveAccount() {
  const accounts = getAccounts();
  if (accounts.length && !getActiveAccount()) {
    localStorage.setItem(STORE.ACTIVE, String(accounts[accounts.length - 1].user.id));
  }
})();
