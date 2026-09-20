const API_BASE = 'http://localhost:5000/api';   // your backend URL

async function api(path, { method = 'GET', body } = {}) {
  const token = getActiveToken();               // see step 3
  const res = await fetch(API_BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Something went wrong');
  return data;
}
/* =========================================================
   Smart Bus Pass - Frontend Logic
   Uses localStorage as a mock database so the whole demo
   works without a real backend. Replace the DB helpers with
   real API (fetch) calls later if you add a backend.

   MULTIPLE ACCOUNTS
   - bpms_sessions      = list of emails signed in on this browser
   - bpms_current_user  = the email that is currently active
   Every page reads the active account, so switching accounts
   (top bar > your name) instantly changes whose passes,
   notifications and applications you see.
   ========================================================= */

const DB_KEYS = {
  USERS: 'bpms_users',
  APPLICATIONS: 'bpms_applications',
  CURRENT_USER: 'bpms_current_user',
  SESSIONS: 'bpms_sessions',
  NOTIFICATIONS: 'bpms_notifications'
};

const MAX_ACCOUNTS = 5;

/* Single source of truth for routes and fares */
const ROUTES = [
  { no: '1',  from: 'Andheri',     to: 'Dadar' },
  { no: '5',  from: 'Borivali',    to: 'Churchgate' },
  { no: '12', from: 'City Center', to: 'Tech Park' },
  { no: '20', from: 'Thane',       to: 'CST' }
];
const PASS_TYPES = {
  Monthly:   { price: 600,  days: 30 },
  Quarterly: { price: 1600, days: 90 },
  Yearly:    { price: 5500, days: 365 }
};

function routeValue(r) { return `Route ${r.no} - ${r.from} to ${r.to}`; }
function routeNo(routeStr) {
  const m = /^Route\s+(\S+)/i.exec(routeStr || '');
  return m ? m[1] : '-';
}
function routeName(routeStr) {
  const i = (routeStr || '').indexOf(' - ');
  return i >= 0 ? routeStr.slice(i + 3) : (routeStr || '');
}

/* ---------- Low level storage helpers ---------- */
function getData(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); }
  catch (e) { return []; }
}
function setData(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

/* ---------- Small helpers ---------- */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString();
}
function daysFromNow(n) {
  const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString();
}
function formatDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function daysLeft(iso) {
  if (!iso) return 0;
  return Math.max(0, Math.ceil((new Date(iso) - new Date()) / 86400000));
}
function validityPercent(app) {
  if (!app.approvedDate || !app.expiryDate) return 0;
  const total = new Date(app.expiryDate) - new Date(app.approvedDate);
  const left = new Date(app.expiryDate) - new Date();
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((left / total) * 100)));
}
function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

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
    avatarColor(user.email) + ';font-size:' + Math.round(size * 0.4) + 'px">' + esc(initials(user.name)) + '</span>';
}

/* ---------- Seed demo data on first run ---------- */
function seedDatabase() {
  if (!localStorage.getItem(DB_KEYS.USERS)) {
    setData(DB_KEYS.USERS, [
      { name: 'Admin User', email: 'admin@bpms.com', phone: '9999999999', password: 'admin123', role: 'admin' },
      { name: 'Rahul Sharma', email: 'rahul@example.com', phone: '9876543210', password: 'pass123', role: 'user' }
    ]);
  }
  if (!localStorage.getItem(DB_KEYS.APPLICATIONS)) {
    setData(DB_KEYS.APPLICATIONS, [
      {
        id: 'BP-1001',
        userEmail: 'rahul@example.com',
        name: 'Rahul Sharma',
        route: 'Route 12 - City Center to Tech Park',
        passType: 'Monthly',
        status: 'approved',
        appliedDate: daysAgo(20),
        approvedDate: daysAgo(18),
        expiryDate: daysFromNow(10),
        amount: 600
      }
    ]);
  }
  if (!localStorage.getItem(DB_KEYS.NOTIFICATIONS)) {
    setData(DB_KEYS.NOTIFICATIONS, [
      {
        id: 'N-1',
        userEmail: 'rahul@example.com',
        title: 'Pass approved',
        message: 'Your Monthly pass for Route 12 has been approved.',
        date: daysAgo(18),
        read: false
      }
    ]);
  }
}

/* =========================================================
   AUTH + MULTI-ACCOUNT
   ========================================================= */
function publicUser(u) {
  if (!u) return null;
  const copy = Object.assign({}, u);
  delete copy.password;
  return copy;
}
function homeFor(user) {
  return user && user.role === 'admin' ? 'admin.html' : 'dashboard.html';
}

function getSessionEmails() {
  const users = getData(DB_KEYS.USERS);
  const emails = getData(DB_KEYS.SESSIONS);
  return emails.filter(e => users.some(u => u.email === e));
}
function setActiveAccount(email) {
  const sessions = getSessionEmails();
  if (!sessions.includes(email)) sessions.push(email);
  setData(DB_KEYS.SESSIONS, sessions);
  localStorage.setItem(DB_KEYS.CURRENT_USER, JSON.stringify(email));
}
function getSignedInAccounts() {
  const users = getData(DB_KEYS.USERS);
  return getSessionEmails()
    .map(e => users.find(u => u.email === e))
    .filter(Boolean)
    .map(publicUser);
}

function registerUser(user) {
  const users = getData(DB_KEYS.USERS);
  if (users.find(u => u.email === user.email)) {
    return { ok: false, message: 'An account with this email already exists. Log in instead.' };
  }
  users.push(Object.assign({}, user, { role: 'user' }));
  setData(DB_KEYS.USERS, users);
  return { ok: true };
}

function loginUser(email, password) {
  const users = getData(DB_KEYS.USERS);
  const user = users.find(u => u.email === email && u.password === password);
  if (!user) return { ok: false, message: 'Email or password is incorrect. Check both and try again.' };
  const sessions = getSessionEmails();
  if (!sessions.includes(email) && sessions.length >= MAX_ACCOUNTS) {
    return { ok: false, message: 'You can be signed in to ' + MAX_ACCOUNTS + ' accounts at once. Log out of one first.' };
  }
  setActiveAccount(email);
  return { ok: true, user: publicUser(user) };
}

function getCurrentUser() {
  const raw = localStorage.getItem(DB_KEYS.CURRENT_USER);
  if (!raw) return null;
  let email = null;
  try {
    const parsed = JSON.parse(raw);
    email = (parsed && typeof parsed === 'object') ? parsed.email : parsed;   // old builds stored the whole user object
  } catch (e) { email = raw; }
  const user = getData(DB_KEYS.USERS).find(u => u.email === email);
  return publicUser(user);
}

function switchAccount(email) {
  if (!getSessionEmails().includes(email)) return;
  setActiveAccount(email);
  const user = getCurrentUser();
  window.location.href = homeFor(user);
}

/* Log out of the ACTIVE account only. If other accounts are still signed in,
   fall back to one of them instead of dropping the person at the login page. */
function logoutUser() {
  const current = getCurrentUser();
  const remaining = getSessionEmails().filter(e => !current || e !== current.email);
  setData(DB_KEYS.SESSIONS, remaining);
  if (remaining.length) {
    const nextEmail = remaining[remaining.length - 1];
    localStorage.setItem(DB_KEYS.CURRENT_USER, JSON.stringify(nextEmail));
    const next = getCurrentUser();
    flash('Logged out of ' + (current ? current.name : 'account') + '. Now using ' + next.name + '.');
    window.location.href = homeFor(next);
  } else {
    localStorage.removeItem(DB_KEYS.CURRENT_USER);
    window.location.href = 'login.html';
  }
}
function logoutAllAccounts() {
  localStorage.removeItem(DB_KEYS.SESSIONS);
  localStorage.removeItem(DB_KEYS.CURRENT_USER);
  window.location.href = 'login.html';
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
/* Admin accounts have no user dashboard, so send them to the admin panel */
function requireUser() {
  const user = requireLogin();
  if (user && user.role === 'admin') { window.location.href = 'admin.html'; return null; }
  return user;
}

/* ---------- Applications ---------- */
function generatePassId() {
  const apps = getData(DB_KEYS.APPLICATIONS);
  return 'BP-' + (1001 + apps.length);
}

function submitApplication(appData) {
  const apps = getData(DB_KEYS.APPLICATIONS);
  const newApp = Object.assign({
    id: generatePassId(),
    status: 'pending',
    appliedDate: new Date().toISOString(),
    approvedDate: null,
    expiryDate: null
  }, appData);
  apps.push(newApp);
  setData(DB_KEYS.APPLICATIONS, apps);
  addNotification(appData.userEmail, 'Application submitted',
    'Your ' + appData.passType + ' pass application (' + newApp.id + ') has been submitted and is pending review.');
  return newApp;
}

function getUserApplications(email) {
  return getData(DB_KEYS.APPLICATIONS).filter(a => a.userEmail === email)
    .sort((a, b) => new Date(b.appliedDate) - new Date(a.appliedDate));
}

function getAllApplications() {
  return getData(DB_KEYS.APPLICATIONS).sort((a, b) => new Date(b.appliedDate) - new Date(a.appliedDate));
}

function updateApplicationStatus(id, status) {
  const apps = getData(DB_KEYS.APPLICATIONS);
  const app = apps.find(a => a.id === id);
  if (!app) return;
  app.status = status;
  if (status === 'approved') {
    app.approvedDate = new Date().toISOString();
    const days = (PASS_TYPES[app.passType] || { days: 30 }).days;
    app.expiryDate = daysFromNow(days);
    addNotification(app.userEmail, 'Pass approved',
      'Your ' + app.passType + ' pass (' + app.id + ') has been approved. Valid till ' + formatDate(app.expiryDate) + '.');
  } else if (status === 'rejected') {
    addNotification(app.userEmail, 'Pass rejected',
      'Your pass application (' + app.id + ') was rejected. Contact the administration or apply again.');
  }
  setData(DB_KEYS.APPLICATIONS, apps);
}

/* Auto-expire passes whose expiryDate has passed */
function refreshExpiries() {
  const apps = getData(DB_KEYS.APPLICATIONS);
  let changed = false;
  apps.forEach(a => {
    if (a.status === 'approved' && a.expiryDate && new Date(a.expiryDate) < new Date()) {
      a.status = 'expired';
      changed = true;
    }
  });
  if (changed) setData(DB_KEYS.APPLICATIONS, apps);
}

/* ---------- Notifications ---------- */
function addNotification(userEmail, title, message) {
  const notifs = getData(DB_KEYS.NOTIFICATIONS);
  notifs.unshift({
    id: 'N-' + (notifs.length + 1) + '-' + Date.now(),
    userEmail: userEmail, title: title, message: message,
    date: new Date().toISOString(),
    read: false
  });
  setData(DB_KEYS.NOTIFICATIONS, notifs);
}

function getUserNotifications(email) {
  return getData(DB_KEYS.NOTIFICATIONS).filter(n => n.userEmail === email)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function markNotificationsRead(email) {
  const notifs = getData(DB_KEYS.NOTIFICATIONS);
  notifs.forEach(n => { if (n.userEmail === email) n.read = true; });
  setData(DB_KEYS.NOTIFICATIONS, notifs);
}

function unreadCount(email) {
  return getData(DB_KEYS.NOTIFICATIONS).filter(n => n.userEmail === email && !n.read).length;
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
  showToast._t = setTimeout(() => { toast.style.display = 'none'; }, 3200);
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

function plateHTML(routeStr, large) {
  return '<span class="plate' + (large ? ' plate-lg' : '') + '">' + esc(routeNo(routeStr)) + '</span>';
}

function emptyState(iconName, message, ctaHref, ctaLabel, tight) {
  return '<div class="empty-state' + (tight ? ' tight' : '') + '"><div class="ic-wrap">' + icon(iconName, 26) + '</div>' +
    '<p>' + message + '</p>' +
    (ctaHref ? '<a class="btn btn-primary btn-sm" href="' + ctaHref + '">' + ctaLabel + '</a>' : '') + '</div>';
}

/* =========================================================
   NAVBAR (rendered by JS so every page shares one copy)
   ========================================================= */
const USER_LINKS = [
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
          const isCurrent = a.email === user.email;
          const unread = (!isCurrent && a.role !== 'admin') ? unreadCount(a.email) : 0;
          return '<li><button type="button" class="acct-item' + (isCurrent ? ' current' : '') + '" data-email="' + esc(a.email) + '"' +
            (isCurrent ? ' aria-current="true"' : '') + '>' +
            avatar(a, 36) +
            '<span class="acct-meta"><b>' + esc(a.name) + '</b><small>' + esc(a.email) + '</small></span>' +
            (a.role === 'admin' ? '<span class="tag">Admin</span>' : '') +
            (unread > 0 ? '<span class="count-pill" title="' + unread + ' unread">' + unread + '</span>' : '') +
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
    b.addEventListener('click', function () { switchAccount(b.dataset.email); });
  });
  const one = document.getElementById('logoutOne');
  if (one) one.addEventListener('click', logoutUser);
  const all = document.getElementById('logoutAll');
  if (all) all.addEventListener('click', logoutAllAccounts);
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
      const links = isAdmin ? [{ page: 'admin', href: 'admin.html', label: 'Applications' }] : USER_LINKS;
      const unread = isAdmin ? 0 : unreadCount(user.email);
      host.innerHTML = '<div class="topbar-inner">' +
        brandHTML(homeFor(user)) + (isAdmin ? '<span class="admin-tag">Admin</span>' : '') +
        '<nav class="topnav" aria-label="Main">' +
          links.map(function (l) {
            return '<a class="nav-link' + (l.page === activePage ? ' active' : '') + '" href="' + l.href + '"' +
              (l.page === activePage ? ' aria-current="page"' : '') + '>' + l.label + '</a>';
          }).join('') +
        '</nav>' +
        '<div class="topbar-right">' +
          (isAdmin ? '' :
            '<a class="icon-btn" href="notifications.html" aria-label="Notifications' + (unread ? ', ' + unread + ' unread' : '') + '">' +
              icon('bell', 20) +
              '<span id="notifBadge" class="count-dot"' + (unread ? '' : ' style="display:none"') + '>' + (unread || '') + '</span>' +
            '</a>') +
          accountSwitcherHTML(user) +
        '</div></div>';
      wireAccountSwitcher();
    }
  }
  showFlash();
}

/* Run seed + expiry check on every page load */
seedDatabase();
refreshExpiries();

/* If someone was already logged in with the old single-account version,
   carry them over so they appear in the account switcher. */
(function migrateSingleLogin() {
  const current = getCurrentUser();
  if (current && !getSessionEmails().includes(current.email)) setActiveAccount(current.email);
  if (!current) localStorage.removeItem(DB_KEYS.CURRENT_USER);
})();
