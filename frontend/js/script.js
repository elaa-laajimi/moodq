/* =========================================================
   MoodQ — Analytics for Moodle
   script.js
   -----------------------------------------------------------
   Sommaire :
   0. Authentification (login/logout/session)
   1. Config API + helpers fetch
   2. Router de vues (SPA légère, sans framework)
   3. Vue Dashboard (AI Search + suggestions + historique)
   4. Vue AI Analytics (stats globales + graphiques)
   5. Vue Courses (cartes + modal détail cours)
   6. Vue Students (par cours + tri/classement + modal détail élève)
   7. Vue Reports (résumé par cours)
   8. Vue History (historique des recherches AI)
   9. Modal générique
   10. Divers (sidebar, sign out, charts helpers)
   ========================================================= */

/* ---------------------------------------------------------
   1. CONFIG API + HELPERS FETCH
   --------------------------------------------------------- */
const API_BASE_URL = "http://localhost:8000";

async function apiGet(path) {
  const res = await fetch(`${API_BASE_URL}${path}`, { credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Erreur HTTP ${res.status}`);
  }
  return data;
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Erreur HTTP ${res.status}`);
  }
  return data;
}

// Cache local des cours (chargé une fois, réutilisé par la vue
// Students pour les onglets sans re-fetch à chaque clic).
let COURSES_CACHE = [];

async function loadCoursesCache() {
  const data = await apiGet("/courses.php");
  COURSES_CACHE = data.courses || [];
  return COURSES_CACHE;
}

const AI_SUGGESTIONS = [
  "Quel cours a le meilleur taux de complétion ?",
  "Qui sont mes 5 meilleurs étudiants ?",
  "Quelle est la tendance des notes ce trimestre ?"
];

const HISTORY_STORAGE_KEY = "moodq_ai_search_history";

/* ---------------------------------------------------------
   0. AUTHENTIFICATION
   -----------------------------------------------------------
   CURRENT_USER contient le vrai utilisateur connecté (issu de
   la session PHP côté backend), remplace l'ancienne constante
   TEACHER codée en dur.
   --------------------------------------------------------- */
let CURRENT_USER = null;

function showLoginScreen() {
  document.getElementById("loginScreen").classList.remove("hidden");
  document.getElementById("appRoot").classList.add("hidden");
}

function showApp() {
  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("appRoot").classList.remove("hidden");
}

function applyCurrentUserToUi() {
  if (!CURRENT_USER) return;
  document.getElementById("userName").textContent = CURRENT_USER.name;
  document.getElementById("welcomeName").textContent = CURRENT_USER.name;
  document.getElementById("userAvatar").textContent = CURRENT_USER.initials;
  const roleEl = document.getElementById("userRole");
  if (roleEl) roleEl.textContent = CURRENT_USER.role;

  // Panneau profil — utilise les mêmes champs que la topbar, plus
  // d'éventuels champs additionnels (email, username, id) s'ils existent
  // dans la réponse /me.php ; sinon affiche un tiret par défaut.
  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = (value !== undefined && value !== null && value !== "") ? value : "—";
  };
  document.getElementById("profileAvatar").textContent = CURRENT_USER.initials || "--";
  setText("profileName", CURRENT_USER.name);
  const emailEl = document.getElementById("profileEmail");
  if (emailEl) emailEl.textContent = CURRENT_USER.email || "";
  setText("profileRoleBadge", CURRENT_USER.role);
  setText("profileUsername", CURRENT_USER.username || CURRENT_USER.name);
  setText("profileRole", CURRENT_USER.role);
  setText("profileUserId", CURRENT_USER.id);

  reapplySavedAvatarChoice();
}

// Vérifie si une session valide existe déjà (ex: après un rechargement
// de page) avant d'afficher l'écran de login.
async function checkSession() {
  try {
    const data = await apiGet("/me.php");
    CURRENT_USER = data.user;
    applyCurrentUserToUi();
    showApp();
    goToView("home");
    updateAiConnectionStatus();
    startNotifPolling();
  } catch {
    showLoginScreen();
  }
}

function initLoginForm() {
  const form = document.getElementById("loginForm");
  const errorEl = document.getElementById("loginError");
  const submitBtn = document.getElementById("loginSubmitBtn");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.classList.add("hidden");
    submitBtn.disabled = true;

    const username = document.getElementById("loginUsername").value.trim();
    const password = document.getElementById("loginPassword").value;

    try {
      const data = await apiPost("/login.php", { username, password });
      CURRENT_USER = data.user;
      applyCurrentUserToUi();
      form.reset();
      showApp();
      goToView("home");
      updateAiConnectionStatus();
      startNotifPolling();
    } catch (err) {
      errorEl.textContent = err.message || "Connexion impossible.";
      errorEl.classList.remove("hidden");
    } finally {
      submitBtn.disabled = false;
    }
  });
}

async function performLogout() {
  try {
    await apiPost("/logout.php", {});
  } catch {
    // Même si l'appel échoue, on force le retour à l'écran de login.
  }
  CURRENT_USER = null;
  setAiConnectionStatus(false);
  document.getElementById("loginUsername").value = "";
  document.getElementById("loginPassword").value = "";
  closeProfilePanel();
  showLoginScreen();
}

function initLogoutButton() {
  document.getElementById("logoutBtn")?.addEventListener("click", performLogout);
  document.getElementById("profileSignoutBtn")?.addEventListener("click", performLogout);
}

/* ---------------------------------------------------------
   1bis. PANNEAU PROFIL
   -----------------------------------------------------------
   Ouverture/fermeture du panneau, changement de mot de passe,
   toggles de notifications et sélecteur de thème — tout est
   persisté dans localStorage et appliqué immédiatement.
   --------------------------------------------------------- */
const NOTIF_PREFS_KEY = "moodq_notification_prefs";
const THEME_PREF_KEY = "moodq_theme_pref";
const COLOR_MODE_KEY = "moodq_color_mode";
const AVATAR_PREF_KEY = "moodq_avatar_pref";

// Appliqué immédiatement (avant même le rendu complet) pour éviter
// un flash de mode clair si l'utilisateur a choisi le mode sombre.
if ((localStorage.getItem(COLOR_MODE_KEY) || "light") === "dark") {
  document.documentElement.setAttribute("data-mode", "dark");
}

function openProfilePanel() {
  document.getElementById("profilePanelOverlay")?.classList.add("visible");
}

function closeProfilePanel() {
  document.getElementById("profilePanelOverlay")?.classList.remove("visible");
  // Referme aussi le mini-formulaire de mot de passe s'il était ouvert.
  document.getElementById("changePasswordForm")?.classList.add("hidden");
  const msg = document.getElementById("changePasswordMsg");
  if (msg) { msg.textContent = ""; msg.classList.add("hidden"); }
}

function initProfilePanel() {
  const overlay = document.getElementById("profilePanelOverlay");

  document.getElementById("profileTrigger")?.addEventListener("click", (e) => {
    e.stopPropagation();
    openProfilePanel();
  });
  document.getElementById("profilePanelClose")?.addEventListener("click", closeProfilePanel);

  // Fermeture au clic en dehors du panneau (mais pas sur son contenu).
  overlay?.addEventListener("click", (e) => {
    if (e.target === overlay) closeProfilePanel();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeProfilePanel();
  });

  initChangePasswordForm();
  initNotificationToggles();
  initThemePicker();
  initColorModeToggle();
  initAvatarPicker();
  initSidebarMascot();
  initTopbarNotifBell();
}

function initChangePasswordForm() {
  const toggleBtn = document.getElementById("togglePasswordFormBtn");
  const form = document.getElementById("changePasswordForm");
  const msg = document.getElementById("changePasswordMsg");
  const submitBtn = document.getElementById("changePasswordSubmitBtn");

  toggleBtn?.addEventListener("click", () => {
    form.classList.toggle("hidden");
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.classList.add("hidden");
    submitBtn.disabled = true;

    const currentPassword = document.getElementById("currentPassword").value;
    const newPassword = document.getElementById("newPassword").value;

    try {
      await apiPost("/change-password.php", { currentPassword, newPassword });
      msg.textContent = "Mot de passe mis à jour avec succès.";
      msg.style.color = "var(--color-green)";
      msg.classList.remove("hidden");
      form.reset();
    } catch (err) {
      msg.textContent = err.message || "Impossible de modifier le mot de passe pour le moment.";
      msg.style.color = "var(--color-red)";
      msg.classList.remove("hidden");
    } finally {
      submitBtn.disabled = false;
    }
  });
}

function getNotificationPrefs() {
  try {
    return JSON.parse(localStorage.getItem(NOTIF_PREFS_KEY)) || {};
  } catch {
    return {};
  }
}

function initNotificationToggles() {
  const toggles = [
    { id: "notifReportReady", key: "reportReady" },
    { id: "notifNewEnrollment", key: "newEnrollment" },
    { id: "notifWeeklyDigest", key: "weeklyDigest" },
    { id: "notifActivityDone", key: "activityDone" }
  ];
  const prefs = getNotificationPrefs();

  toggles.forEach(({ id, key }) => {
    const input = document.getElementById(id);
    if (!input) return;
    input.checked = prefs[key] !== false; // activé par défaut
    input.addEventListener("change", () => {
      const current = getNotificationPrefs();
      current[key] = input.checked;
      localStorage.setItem(NOTIF_PREFS_KEY, JSON.stringify(current));
    });
  });
}

function applyTheme(theme) {
  if (theme === "violet-rose") {
    document.documentElement.setAttribute("data-theme", "violet-rose");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  document.querySelectorAll(".theme-option").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.theme === theme);
  });
}

function initThemePicker() {
  const savedTheme = localStorage.getItem(THEME_PREF_KEY) || "blue-cyan";
  applyTheme(savedTheme);

  document.querySelectorAll(".theme-option").forEach(btn => {
    btn.addEventListener("click", () => {
      const theme = btn.dataset.theme;
      localStorage.setItem(THEME_PREF_KEY, theme);
      applyTheme(theme);
    });
  });
}

// ---------- Mode clair / sombre ----------
function applyColorMode(mode) {
  if (mode === "dark") {
    document.documentElement.setAttribute("data-mode", "dark");
  } else {
    document.documentElement.removeAttribute("data-mode");
  }
}

function initColorModeToggle() {
  const savedMode = localStorage.getItem(COLOR_MODE_KEY) || "light";
  applyColorMode(savedMode);

  document.getElementById("themeModeToggle")?.addEventListener("click", () => {
    const isDark = document.documentElement.getAttribute("data-mode") === "dark";
    const nextMode = isDark ? "light" : "dark";
    localStorage.setItem(COLOR_MODE_KEY, nextMode);
    applyColorMode(nextMode);
  });
}

// ---------- Photo de profil / avatars ----------
const AVATAR_PRESETS = [
  { id: "blue", gradient: "linear-gradient(135deg, #2d6cdf, #1e5a9e)" },
  { id: "teal", gradient: "linear-gradient(135deg, #14b8a6, #0d9488)" },
  { id: "violet", gradient: "linear-gradient(135deg, #8b5cf6, #6d28d9)" },
  { id: "orange", gradient: "linear-gradient(135deg, #f59e0b, #d97706)" },
  { id: "pink", gradient: "linear-gradient(135deg, #f472b6, #db2777)" },
];

function applyAvatarChoice(choice, { persist = true } = {}) {
  if (persist) localStorage.setItem(AVATAR_PREF_KEY, JSON.stringify(choice));

  [document.getElementById("userAvatar"), document.getElementById("profileAvatar")].forEach(el => {
    if (!el) return;
    if (choice.type === "photo") {
      el.style.background = `center / cover no-repeat url(${choice.dataUrl})`;
      el.textContent = "";
    } else {
      el.style.background = choice.gradient;
      el.textContent = (CURRENT_USER && CURRENT_USER.initials) || "--";
    }
  });

  document.querySelectorAll(".avatar-option[data-avatar-preset]").forEach(btn => {
    btn.classList.toggle("selected", choice.type === "preset" && btn.dataset.avatarPreset === choice.id);
  });
  const uploadBtn = document.getElementById("avatarUploadBtn");
  if (uploadBtn) uploadBtn.classList.toggle("selected", choice.type === "photo");
}

function reapplySavedAvatarChoice() {
  const saved = localStorage.getItem(AVATAR_PREF_KEY);
  if (!saved) return;
  try {
    const choice = JSON.parse(saved);
    if (choice.type === "photo") {
      const uploadBtn = document.getElementById("avatarUploadBtn");
      if (uploadBtn) {
        uploadBtn.classList.add("has-photo");
        uploadBtn.style.background = `center / cover no-repeat url(${choice.dataUrl})`;
        uploadBtn.querySelector(".avatar-upload-icon")?.classList.add("hidden");
      }
    }
    applyAvatarChoice(choice, { persist: false });
  } catch {
    // Préférence corrompue : on l'ignore silencieusement.
  }
}

function initAvatarPicker() {
  document.querySelectorAll(".avatar-option[data-avatar-preset]").forEach(btn => {
    btn.addEventListener("click", () => {
      const preset = AVATAR_PRESETS.find(p => p.id === btn.dataset.avatarPreset);
      if (!preset) return;
      const uploadBtn = document.getElementById("avatarUploadBtn");
      uploadBtn?.classList.remove("has-photo");
      if (uploadBtn) uploadBtn.style.background = "";
      uploadBtn?.querySelector(".avatar-upload-icon")?.classList.remove("hidden");
      applyAvatarChoice({ type: "preset", id: preset.id, gradient: preset.gradient });
    });
  });

  const fileInput = document.getElementById("avatarFileInput");
  const uploadBtn = document.getElementById("avatarUploadBtn");
  uploadBtn?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      uploadBtn.classList.add("has-photo");
      uploadBtn.style.background = `center / cover no-repeat url(${reader.result})`;
      uploadBtn.querySelector(".avatar-upload-icon")?.classList.add("hidden");
      applyAvatarChoice({ type: "photo", dataUrl: reader.result });
    };
    reader.readAsDataURL(file);
  });

  reapplySavedAvatarChoice();
}

/* ---------------------------------------------------------
   Système de notifications (mascotte + cloche topbar)
   Backé par /notifications.php : détection réelle des
   inscriptions et cours terminés Moodle, + création manuelle
   pour les rapports téléchargés. Sondage périodique après
   connexion pour rester à jour sans recharger la page.
   --------------------------------------------------------- */
const NOTIF_PREF_KEY_MAP = {
  enrollment: "newEnrollment",
  report: "reportReady",
  activity: "activityDone",
};

const NOTIF_ICONS = {
  enrollment: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>',
  report: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6M9 9h1"/></svg>',
  activity: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.3l2.3 2.3 4.7-5.2"/></svg>',
};

const NOTIF_POLL_INTERVAL_MS = 30000;

let notifHistory = [];
let notifBubbleTimer = null;
let notifPollTimer = null;

function unreadNotifCount() {
  return notifHistory.filter(n => !n.read).length;
}

function formatNotifTime(mysqlDatetime) {
  // "YYYY-MM-DD HH:MM:SS" (heure serveur) -> timestamp JS
  const timestamp = new Date(mysqlDatetime.replace(" ", "T")).getTime();
  const diffMin = Math.round((Date.now() - timestamp) / 60000);
  if (diffMin < 1) return i18nT("time.justNow", "À l'instant");
  if (diffMin < 60) return i18nT("time.minutesAgo", "Il y a {n} min").replace("{n}", diffMin);
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return i18nT("time.hoursAgo", "Il y a {n} h").replace("{n}", diffH);
  const diffD = Math.round(diffH / 24);
  return i18nT("time.daysAgo", "Il y a {n} j").replace("{n}", diffD);
}

// Met à jour les deux compteurs (mascotte + cloche topbar) à partir
// du même historique de notifications, pour qu'ils restent synchronisés.
function updateNotifBadges() {
  const count = unreadNotifCount();
  [document.getElementById("mascotNotifBadge"), document.getElementById("topbarNotifBadge")].forEach(badge => {
    if (!badge) return;
    badge.textContent = String(count);
    badge.classList.toggle("hidden", count === 0);
  });
}

function renderNotifDropdown() {
  const list = document.getElementById("notifDropdownList");
  if (!list) return;

  if (notifHistory.length === 0) {
    list.innerHTML = `<p class="notif-dropdown-empty">Aucune notification pour le moment.</p>`;
    return;
  }

  list.innerHTML = notifHistory.map(n => `
    <div class="notif-item ${n.read ? "" : "unread"}" data-notif-id="${n.id}">
      <span class="notif-item-icon">${NOTIF_ICONS[n.type] || NOTIF_ICONS.activity}</span>
      <div class="notif-item-body">
        <p class="notif-item-title">${escapeHtml(n.title)}</p>
        <p class="notif-item-text">${escapeHtml(n.text)}</p>
        <p class="notif-item-time">${formatNotifTime(n.rawTime)}</p>
      </div>
      ${n.read ? "" : '<span class="notif-item-dot"></span>'}
    </div>
  `).join("");

  list.querySelectorAll("[data-notif-id]").forEach(el => {
    el.addEventListener("click", async () => {
      const entry = notifHistory.find(n => String(n.id) === el.dataset.notifId);
      if (entry && !entry.read) {
        entry.read = true;
        updateNotifBadges();
        el.classList.remove("unread");
        el.querySelector(".notif-item-dot")?.remove();
        try {
          await apiPost("/notifications.php", { action: "mark_read", id: entry.id });
        } catch {
          // Best-effort : l'état visuel reste à jour même si l'appel échoue.
        }
      }
    });
  });
}

function showMascotBubble(type, title, text) {
  const bubble = document.getElementById("mascotBubble");
  if (!bubble) return;
  bubble.innerHTML = `
    <p class="sidebar-mascot-bubble-title">${NOTIF_ICONS[type] || NOTIF_ICONS.activity}${escapeHtml(title)}</p>
    <p class="sidebar-mascot-bubble-text">${escapeHtml(text)}</p>
  `;
  bubble.classList.add("visible");
  clearTimeout(notifBubbleTimer);
  notifBubbleTimer = setTimeout(() => bubble.classList.remove("visible"), 6500);
}

// Récupère l'historique réel depuis le serveur (détection Moodle +
// notifications créées manuellement), et affiche une bulle "créative"
// pour toute notification réellement nouvelle depuis le dernier sondage.
async function pollNotifications({ silent = false } = {}) {
  let data;
  try {
    data = await apiGet("/notifications.php");
  } catch {
    return; // hors-ligne / backend indisponible : on garde l'état actuel.
  }

  const previousIds = new Set(notifHistory.map(n => n.id));
  const prefs = getNotificationPrefs();

  notifHistory = (data.notifications || []).map(n => ({
    id: n.id,
    type: n.type,
    title: n.title,
    text: n.message,
    rawTime: n.created_at,
    read: !!Number(n.is_read),
  }));

  updateNotifBadges();
  renderNotifDropdown();

  if (!silent && previousIds.size > 0) {
    const brandNew = notifHistory.find(n => !previousIds.has(n.id) && !n.read);
    if (brandNew) {
      const prefKey = NOTIF_PREF_KEY_MAP[brandNew.type];
      if (!prefKey || prefs[prefKey] !== false) {
        showMascotBubble(brandNew.type, brandNew.title, brandNew.text);
      }
    }
  }
}

function startNotifPolling() {
  pollNotifications({ silent: true });
  clearInterval(notifPollTimer);
  notifPollTimer = setInterval(() => pollNotifications(), NOTIF_POLL_INTERVAL_MS);
}

// Crée une notification côté serveur (ex: rapport téléchargé), puis
// rafraîchit immédiatement l'affichage local sans attendre le sondage.
async function createNotification(type, title, text) {
  const prefKey = NOTIF_PREF_KEY_MAP[type];
  const prefs = getNotificationPrefs();
  if (prefKey && prefs[prefKey] === false) return;

  try {
    await apiPost("/notifications.php", { action: "create", type, title, message: text });
    await pollNotifications({ silent: true });
    showMascotBubble(type, title, text);
  } catch {
    // Best-effort : pas de notification affichée si le serveur est indisponible.
  }
}

function initSidebarMascot() {
  const btn = document.getElementById("sidebarMascotBtn");
  if (!btn) return;

  const goToSearch = () => {
    goToView("dashboard");
    document.getElementById("mascotBubble")?.classList.remove("visible");
  };

  btn.addEventListener("click", goToSearch);
  btn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      goToSearch();
    }
  });
}

// Cloche topbar façon Facebook : ouvre un panneau listant tout
// l'historique des notifications reçues (lues et non lues).
function initTopbarNotifBell() {
  const wrap = document.getElementById("topbarNotif");
  const btn = document.getElementById("topbarNotifBtn");
  const dropdown = document.getElementById("notifDropdown");
  const markAllBtn = document.getElementById("markAllReadBtn");
  if (!wrap || !btn || !dropdown) return;

  const closeDropdown = () => dropdown.classList.remove("visible");
  const openDropdown = () => {
    renderNotifDropdown();
    dropdown.classList.add("visible");
  };

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (dropdown.classList.contains("visible")) {
      closeDropdown();
    } else {
      openDropdown();
    }
  });

  markAllBtn?.addEventListener("click", async (e) => {
    e.stopPropagation();
    notifHistory.forEach(n => { n.read = true; });
    updateNotifBadges();
    renderNotifDropdown();
    try {
      await apiPost("/notifications.php", { action: "mark_all_read" });
    } catch {
      // Best-effort.
    }
  });

  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target)) closeDropdown();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDropdown();
  });
}

/* ---------------------------------------------------------
   2. ROUTER DE VUES
   --------------------------------------------------------- */
const VIEW_TITLE_KEYS = {
  "home": "nav.home",
  "dashboard": "nav.aiSearch",
  "ai-analytics": "nav.aiAnalytics",
  "courses": "nav.courses",
  "students": "nav.students",
  "reports": "nav.reports",
  "history": "nav.history"
};

let CURRENT_VIEW = "home";

function i18nT(key, fallback) {
  return (typeof MoodQI18n !== "undefined") ? MoodQI18n.t(key, fallback) : (fallback ?? key);
}

function updatePageTitle() {
  const key = VIEW_TITLE_KEYS[CURRENT_VIEW];
  document.getElementById("pageTitle").textContent = key ? i18nT(key, "MoodQ") : "MoodQ";
}

// Petit registre : chaque vue peut définir une fonction appelée
// à chaque fois qu'on y navigue (pour (re)générer son contenu).
const VIEW_INIT = {
  "ai-analytics": () => { renderAiAnalytics(); initAnalyticsToggle(); },
  "courses": renderCourses,
  "students": renderStudentsView,
  "reports": renderReports,
  "history": renderHistory
};

function goToView(viewName) {
  document.querySelectorAll(".view").forEach(el => el.classList.remove("active"));
  document.getElementById(`view-${viewName}`)?.classList.add("active");

  document.querySelectorAll(".nav-item").forEach(item => {
    item.classList.toggle("active", item.dataset.view === viewName);
  });

  CURRENT_VIEW = viewName;
  updatePageTitle();

  if (VIEW_INIT[viewName]) VIEW_INIT[viewName]();
}

// Le titre de la topbar n'a pas de data-i18n réactif (il est réécrit à
// chaque navigation) : on le raccroche explicitement aux changements
// de langue pour qu'il ne reste pas figé dans l'ancienne langue.
if (typeof MoodQI18n !== "undefined") {
  MoodQI18n.onChange(() => updatePageTitle());
}

function initSidebarNav() {
  document.querySelectorAll(".nav-item").forEach(item => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      goToView(item.dataset.view);
    });
  });
}

// Clic sur le logo/nom "MoodQ" en haut de la sidebar -> page d'accueil.
function initBrandHomeLink() {
  document.getElementById("sidebarBrandHome")?.addEventListener("click", () => {
    goToView("home");
  });
}

/* ---------------------------------------------------------
   3. DASHBOARD — AI SEARCH
   --------------------------------------------------------- */
function initDashboard() {
  renderSuggestions();
  initAiSearchForm();
}

function renderSuggestions() {
  const wrap = document.getElementById("aiSuggestions");
  wrap.innerHTML = AI_SUGGESTIONS.map(q =>
    `<button type="button" class="suggestion-chip" data-question="${escapeHtml(q)}">${escapeHtml(q)}</button>`
  ).join("");

  wrap.querySelectorAll(".suggestion-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const question = chip.dataset.question;
      document.getElementById("aiSearchInput").value = question;
      submitAiQuestion(question);
    });
  });
}

function initAiSearchForm() {
  const form = document.getElementById("aiSearchForm");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const question = document.getElementById("aiSearchInput").value.trim();
    if (!question) return;
    submitAiQuestion(question);
  });
}

let aiChartInstance = null;

async function submitAiQuestion(question) {
  const answerBox = document.getElementById("aiAnswerBox");
  const answerText = document.getElementById("aiAnswerText");
  const askBtn = document.querySelector(".ask-ai-btn");

  askBtn.disabled = true;
  answerBox.classList.remove("hidden");
  answerBox.classList.add("loading");
  answerText.textContent = "Analyse de votre question en cours…";
  clearAiChart();
  clearAiDebugInfo();
  requestAnimationFrame(() => answerBox.classList.add("visible"));

  try {
    const lang = (typeof MoodQI18n !== "undefined") ? MoodQI18n.getCurrentLang() : "fr";
    const data = await apiPost("/ai-search.php", { question, lang });

    answerBox.classList.remove("loading");
    answerText.textContent = data.answer;

    renderAiDebugInfo(data.sql, data.rows);

    if (data.chart) {
      renderAiChart(data.chart);
    }

    saveHistoryEntry(question, data.answer);
  } catch (err) {
    answerBox.classList.remove("loading");
    answerText.textContent = err.message || "Une erreur est survenue. Merci de réessayer.";
    clearAiChart();
    clearAiDebugInfo();
    console.error(err);
  } finally {
    askBtn.disabled = false;
  }
}

function clearAiDebugInfo() {
  document.getElementById("aiDebugInfo")?.remove();
}

function renderAiDebugInfo(sql, rows) {
  clearAiDebugInfo();
  if (!sql) return;

  const answerBox = document.getElementById("aiAnswerBox");
  const details = document.createElement("details");
  details.id = "aiDebugInfo";
  details.style.marginTop = "14px";
  details.style.fontSize = "12.5px";
  details.style.color = "var(--color-muted, #7c93ac)";

  const summary = document.createElement("summary");
  summary.textContent = "Voir la requête SQL générée (debug)";
  summary.style.cursor = "pointer";
  details.appendChild(summary);

  const sqlBlock = document.createElement("pre");
  sqlBlock.style.whiteSpace = "pre-wrap";
  sqlBlock.style.background = "#f4f7fb";
  sqlBlock.style.padding = "10px";
  sqlBlock.style.borderRadius = "8px";
  sqlBlock.style.marginTop = "8px";
  sqlBlock.textContent = sql;
  details.appendChild(sqlBlock);

  if (Array.isArray(rows) && rows.length > 0) {
    const rowsBlock = document.createElement("pre");
    rowsBlock.style.whiteSpace = "pre-wrap";
    rowsBlock.style.background = "#f4f7fb";
    rowsBlock.style.padding = "10px";
    rowsBlock.style.borderRadius = "8px";
    rowsBlock.style.marginTop = "8px";
    rowsBlock.textContent = JSON.stringify(rows, null, 2);
    details.appendChild(rowsBlock);
  }

  answerBox.appendChild(details);
}

function clearAiChart() {
  aiChartInstance?.destroy();
  aiChartInstance = null;
  document.getElementById("aiAnswerChart")?.remove();
}

function renderAiChart(chart) {
  clearAiChart();

  const answerBox = document.getElementById("aiAnswerBox");
  const canvas = document.createElement("canvas");
  canvas.id = "aiAnswerChart";
  canvas.height = 220;
  canvas.style.marginTop = "16px";
  answerBox.appendChild(canvas);

  const palette = ["#2d6cdf", "#14b8a6", "#f59e0b", "#ef4444", "#8b5cf6", "#22c55e"];

  if (chart.type === "pie") {
    aiChartInstance = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels: chart.labels,
        datasets: [{ data: chart.values, backgroundColor: palette, borderWidth: 0 }]
      },
      options: {
        responsive: true, cutout: "60%",
        plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } } }
      }
    });
  } else {
    aiChartInstance = new Chart(canvas, {
      type: "bar",
      data: {
        labels: chart.labels,
        datasets: [{ label: "Valeur", data: chart.values, backgroundColor: CHART_COLORS.primary, borderRadius: 8, maxBarThickness: 60 }]
      },
      options: {
        responsive: true, plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ...baseGridOptions }, x: { grid: { display: false }, ticks: baseGridOptions.ticks } }
      }
    });
  }
}

/* ---------------------------------------------------------
   4. HISTORIQUE (localStorage — persiste entre les sessions)
   --------------------------------------------------------- */
function getHistory() {
  let history;
  try {
    history = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY)) || [];
  } catch {
    history = [];
  }
  // Rétrocompatibilité : les entrées enregistrées avant l'ajout de la
  // suppression individuelle n'ont pas d'id — on leur en attribue un.
  let needsMigration = false;
  history = history.map(entry => {
    if (!entry.id) {
      needsMigration = true;
      return { ...entry, id: (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(36).slice(2)}` };
    }
    return entry;
  });
  if (needsMigration) {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
  }
  return history;
}

function saveHistoryEntry(question, answer) {
  const history = getHistory();
  const id = (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  history.unshift({ id, question, answer, timestamp: new Date().toISOString() });
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, 100)));
}

function deleteHistoryEntry(id) {
  const history = getHistory().filter(entry => entry.id !== id);
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
  renderHistory();
}

function renderHistory() {
  const list = document.getElementById("historyList");
  const history = getHistory();

  if (history.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🕓</div>
        <p>${escapeHtml(i18nT("history.emptyState", "Aucune recherche pour le moment. Posez une question dans Recherche IA."))}</p>
      </div>`;
    return;
  }

  list.innerHTML = history.map(entry => `
    <div class="history-item">
      <button type="button" class="history-delete-btn" data-id="${escapeHtml(entry.id ?? "")}" title="Supprimer cette recherche">✕</button>
      <span class="history-question">${escapeHtml(entry.question)}</span>
      <span class="history-answer">${escapeHtml(entry.answer)}</span>
      <span class="history-time">${formatDateTime(entry.timestamp)}</span>
    </div>
  `).join("");

  list.querySelectorAll(".history-delete-btn").forEach(btn => {
    btn.addEventListener("click", () => deleteHistoryEntry(btn.dataset.id));
  });
}

function initClearHistory() {
  document.getElementById("clearHistoryBtn")?.addEventListener("click", () => {
    localStorage.removeItem(HISTORY_STORAGE_KEY);
    renderHistory();
  });
}

/* ---------------------------------------------------------
   5. AI ANALYTICS — stats globales + graphiques
   --------------------------------------------------------- */
let chartsInitialized = false;
let chartInstances = {};
let latestAnalyticsCharts = null;

async function renderAiAnalytics() {
  const grid = document.getElementById("analyticsStatsGrid");
  grid.innerHTML = `<p class="loading-text">${escapeHtml(i18nT("courses.loadingCourses", "Chargement des cours…"))}</p>`;

  try {
    const data = await apiGet("/analytics.php");
    latestAnalyticsCharts = data.charts;

    const stats = [
      { label: i18nT("analytics.myCourses", "MES COURS"), value: data.stats.coursesCount, icon: '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>', cls: "icon-blue" },
      { label: i18nT("analytics.myStudents", "MES ÉTUDIANTS"), value: data.stats.studentsCount, icon: '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19"/><circle cx="9.5" cy="8" r="3.2"/><path d="M20 19v-1.5a3.3 3.3 0 0 0-2.2-3.1"/><path d="M14.6 4.2a3.2 3.2 0 0 1 0 6.1"/></svg>', cls: "icon-teal" },
      { label: i18nT("analytics.overallAverage", "MOYENNE GÉNÉRALE"), value: `${data.stats.avgGrade}%`, icon: '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 6h6v6"/></svg>', cls: "icon-green" },
      { label: i18nT("analytics.statCompletion", "COMPLÉTION"), value: `${data.stats.avgCompletion}%`, icon: '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="5.5"/><path d="M8.5 12.8L7 21l5-3 5 3-1.5-8.2"/></svg>', cls: "icon-orange" }
    ];

    grid.innerHTML = stats.map(s => `
      <div class="stat-card">
        <div class="stat-info">
          <span class="stat-label">${escapeHtml(s.label)}</span>
          <span class="stat-value">${s.value}</span>
        </div>
        <div class="stat-icon ${s.cls}">${s.icon}</div>
      </div>
    `).join("");

    const chartsGrid = document.getElementById("analyticsChartsGrid");
    if (chartsGrid && !chartsGrid.classList.contains("hidden")) {
      buildCharts(latestAnalyticsCharts);
    }
  } catch (err) {
    grid.innerHTML = `<p class="error-text">${escapeHtml(i18nT("analytics.loadError", "Impossible de charger les statistiques : "))}${escapeHtml(err.message)}</p>`;
  }
}

const CHART_COLORS = {
  primary: "#2d6cdf", primaryFill: "rgba(45, 108, 223, 0.12)",
  teal: "#14b8a6", orange: "#f59e0b", grid: "#e3edf6", text: "#7c93ac"
};
const baseGridOptions = {
  grid: { color: CHART_COLORS.grid, drawBorder: false },
  ticks: { color: CHART_COLORS.text, font: { size: 11 } }
};

function initGradeTrendChart(data) {
  chartInstances.gradeTrend?.destroy();
  chartInstances.gradeTrend = new Chart(document.getElementById("gradeTrendChart"), {
    type: "line",
    data: { labels: data.labels, datasets: [{
      label: "Average grade", data: data.values,
      borderColor: CHART_COLORS.primary, backgroundColor: CHART_COLORS.primaryFill,
      fill: true, tension: 0.35, pointRadius: 4, pointBackgroundColor: CHART_COLORS.primary, borderWidth: 2
    }]},
    options: {
      responsive: true, plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ...baseGridOptions }, x: { grid: { display: false }, ticks: baseGridOptions.ticks } }
    }
  });
}

function initQuizPerformanceChart(data) {
  chartInstances.quizPerformance?.destroy();
  chartInstances.quizPerformance = new Chart(document.getElementById("quizPerformanceChart"), {
    type: "bar",
    data: { labels: data.labels, datasets: [{ label: "Average score", data: data.values, backgroundColor: CHART_COLORS.primary, borderRadius: 8, maxBarThickness: 70 }] },
    options: {
      responsive: true, plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ...baseGridOptions }, x: { grid: { display: false }, ticks: baseGridOptions.ticks } }
    }
  });
}

function initAttendanceChart(data) {
  chartInstances.attendance?.destroy();
  chartInstances.attendance = new Chart(document.getElementById("attendanceChart"), {
    type: "bar",
    data: { labels: data.labels, datasets: [{ label: "Activity log events", data: data.values, backgroundColor: CHART_COLORS.teal, borderRadius: 8, maxBarThickness: 70 }] },
    options: {
      responsive: true, plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ...baseGridOptions }, x: { grid: { display: false }, ticks: baseGridOptions.ticks } }
    }
  });
}

function initCompletionChart(data) {
  chartInstances.completion?.destroy();
  chartInstances.completion = new Chart(document.getElementById("completionChart"), {
    type: "doughnut",
    data: { labels: data.labels, datasets: [{ data: data.values, backgroundColor: [CHART_COLORS.primary, CHART_COLORS.orange], borderWidth: 0 }] },
    options: { responsive: true, cutout: "68%", plugins: { legend: { position: "bottom", labels: { color: CHART_COLORS.text, boxWidth: 10, font: { size: 11 } } } } }
  });
}

function buildCharts(charts) {
  if (!charts) return;
  initGradeTrendChart(charts.gradeTrend);
  initQuizPerformanceChart(charts.quizPerformance);
  initAttendanceChart(charts.attendance);
  initCompletionChart(charts.completion);
  chartsInitialized = true;
}

function initAnalyticsToggle() {
  const toggle = document.getElementById("analyticsToggle");
  if (toggle.dataset.bound === "true") return;
  toggle.dataset.bound = "true";

  toggle.querySelectorAll(".toggle-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      toggle.querySelectorAll(".toggle-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      const statsGrid = document.getElementById("analyticsStatsGrid");
      const chartsGrid = document.getElementById("analyticsChartsGrid");

      if (btn.dataset.mode === "numbers") {
        chartsGrid.classList.add("hidden");
        statsGrid.classList.remove("hidden");
      } else {
        statsGrid.classList.add("hidden");
        chartsGrid.classList.remove("hidden");
        if (!chartsInitialized && latestAnalyticsCharts) {
          buildCharts(latestAnalyticsCharts);
        }
      }
    });
  });
}

/* ---------------------------------------------------------
   6. COURSES — cartes + modal détail
   --------------------------------------------------------- */
async function renderCourses() {
  const grid = document.getElementById("coursesGrid");
  grid.innerHTML = `<p class="loading-text">${escapeHtml(i18nT("courses.loadingCourses", "Chargement des cours…"))}</p>`;

  try {
    const courses = await loadCoursesCache();

    grid.innerHTML = courses.map(c => `
      <div class="course-card">
        <div class="course-card-top">
          <button type="button" class="course-card-title" data-course-id="${c.id}">${escapeHtml(c.name)}</button>
          <span class="course-code-badge">${c.id}</span>
        </div>
        <div class="course-card-meta">
          <div class="course-meta-item">
            <span class="course-meta-label">${escapeHtml(i18nT("courses.enrolled", "INSCRITS"))}</span>
            <span class="course-meta-value">${c.enrols}</span>
          </div>
          <div class="course-meta-item">
            <span class="course-meta-label">${escapeHtml(i18nT("courses.average", "MOYENNE"))}</span>
            <span class="course-meta-value">${Number(c.avgGrade).toFixed(1)}%</span>
          </div>
        </div>
        <div class="completion-cell">
          <div class="completion-bar"><span style="width:${c.completion}%"></span></div>
          <span>${escapeHtml(i18nT("courses.completionOf", "{pct}% de complétion").replace("{pct}", c.completion))}</span>
        </div>
      </div>
    `).join("");

    grid.querySelectorAll("[data-course-id]").forEach(btn => {
      btn.addEventListener("click", () => openCourseModal(btn.dataset.courseId));
    });
  } catch (err) {
    grid.innerHTML = `<p class="error-text">${escapeHtml(i18nT("courses.loadError", "Impossible de charger les cours : "))}${escapeHtml(err.message)}</p>`;
  }
}

function openCourseModal(courseId) {
  const c = COURSES_CACHE.find(x => x.id === courseId);
  if (!c) return;

  const daysLabel = c.avgCompletionDays != null ? `${c.avgCompletionDays} ${i18nT("courses.days", "jours")}` : "—";

  const html = `
    <h3 class="modal-title">${escapeHtml(c.name)}</h3>
    <p class="modal-subtitle">${c.id} · ${escapeHtml(c.category)}</p>

    <div class="modal-stats-grid">
      <div class="modal-stat"><span class="modal-stat-label">${escapeHtml(i18nT("courses.modalEnrolled", "ÉTUDIANTS INSCRITS"))}</span><span class="modal-stat-value">${c.enrols}</span></div>
      <div class="modal-stat"><span class="modal-stat-label">${escapeHtml(i18nT("courses.modalCompleted", "ONT TERMINÉ"))}</span><span class="modal-stat-value">${c.completedCount}</span></div>
      <div class="modal-stat"><span class="modal-stat-label">${escapeHtml(i18nT("courses.modalCompletionRate", "TAUX DE COMPLÉTION"))}</span><span class="modal-stat-value">${c.completion}%</span></div>
      <div class="modal-stat"><span class="modal-stat-label">${escapeHtml(i18nT("courses.modalAvgDuration", "DURÉE MOYENNE"))}</span><span class="modal-stat-value">${daysLabel}</span></div>
      <div class="modal-stat"><span class="modal-stat-label">${escapeHtml(i18nT("courses.modalDropoutRate", "TAUX D'ABANDON"))}</span><span class="modal-stat-value">${c.dropoutRate}%</span></div>
      <div class="modal-stat"><span class="modal-stat-label">${escapeHtml(i18nT("courses.modalAvgQuizScore", "SCORE MOYEN QUIZ"))}</span><span class="modal-stat-value">${c.avgQuizScore}%</span></div>
      <div class="modal-stat"><span class="modal-stat-label">${escapeHtml(i18nT("courses.modalEffectiveness", "EFFICACITÉ DU COURS"))}</span><span class="modal-stat-value">${escapeHtml(translateEffectiveness(c))}</span></div>
      <div class="modal-stat"><span class="modal-stat-label">${escapeHtml(i18nT("courses.modalActivityEvents", "ÉVÉNEMENTS D'ACTIVITÉ"))}</span><span class="modal-stat-value">${c.activityEvents}</span></div>
    </div>
  `;
  openModal(html);
}

// Statut brut stocké en base (français, cf. moodq_exercises) → libellé traduit.
function translateExerciseStatus(status) {
  const map = {
    "Terminé": i18nT("students.statusCompleted", "Terminé"),
    "En cours": i18nT("students.statusInProgress", "En cours"),
    "Non commencé": i18nT("students.statusNotStarted", "Non commencé"),
  };
  return map[status] ?? status;
}

// c.effectivenessCode ('low'/'medium'/'high') est traduit côté client ;
// à défaut (ancien backend sans ce champ), on retombe sur c.effectiveness
// tel que renvoyé par le serveur (généralement en français).
function translateEffectiveness(c) {
  const map = { low: "reports.effectivenessLow", medium: "reports.effectivenessMedium", high: "reports.effectivenessHigh" };
  const key = map[c.effectivenessCode];
  return key ? i18nT(key, c.effectiveness) : c.effectiveness;
}

/* ---------------------------------------------------------
   7. STUDENTS — par cours, tri, modal détail élève
   --------------------------------------------------------- */
let currentStudentsCourseId = null;
let currentStudentsSort = "alpha";

async function renderStudentsView() {
  if (COURSES_CACHE.length === 0) {
    await loadCoursesCache().catch(() => {});
  }
  if (!currentStudentsCourseId && COURSES_CACHE.length > 0) {
    currentStudentsCourseId = COURSES_CACHE[0].id;
  }

  renderCourseTabs();
  attachSortControl();
  renderStudentsTable();
}

function renderCourseTabs() {
  const wrap = document.getElementById("studentsCourseTabs");
  wrap.innerHTML = COURSES_CACHE.map(c =>
    `<button type="button" class="course-tab ${c.id === currentStudentsCourseId ? "active" : ""}" data-course-id="${c.id}">${c.id} — ${escapeHtml(c.name)}</button>`
  ).join("");

  wrap.querySelectorAll(".course-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      currentStudentsCourseId = tab.dataset.courseId;
      renderCourseTabs();
      renderStudentsTable();
    });
  });
}

function attachSortControl() {
  const select = document.getElementById("studentsSort");
  select.value = currentStudentsSort;
  select.onchange = () => {
    currentStudentsSort = select.value;
    renderStudentsTable();
  };
}

async function renderStudentsTable() {
  const tbody = document.querySelector("#studentsTable tbody");
  if (!currentStudentsCourseId) {
    tbody.innerHTML = `<tr><td colspan="6">${escapeHtml(i18nT("courses.noCoursesAvailable", "Aucun cours disponible."))}</td></tr>`;
    return;
  }

  tbody.innerHTML = `<tr><td colspan="6" class="loading-text">${escapeHtml(i18nT("students.loadingStudents", "Chargement des étudiants…"))}</td></tr>`;

  try {
    const data = await apiGet(
      `/students.php?course=${encodeURIComponent(currentStudentsCourseId)}&sort=${encodeURIComponent(currentStudentsSort)}`
    );
    const students = data.students || [];

    if (students.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6">${escapeHtml(i18nT("students.noStudentsEnrolled", "Aucun étudiant inscrit à ce cours."))}</td></tr>`;
      return;
    }

    tbody.innerHTML = students.map(s => {
      const rank = s.rank;
      const rankCls = rank === 1 ? "top1" : rank === 2 ? "top2" : rank === 3 ? "top3" : "";
      const gradeClass = s.avgGrade >= 75 ? "high" : "";
      const statusCls = s.completed ? "completed" : "in-progress";
      const statusLabel = s.completed ? i18nT("students.statusCompleted", "Terminé") : i18nT("students.statusInProgress", "En cours");

      return `
        <tr class="clickable-row" data-student-id="${s.studentId}" data-course-id="${currentStudentsCourseId}">
          <td><span class="rank-badge ${rankCls}">${rank}</span></td>
          <td class="course-name">${escapeHtml(s.name)}</td>
          <td>${escapeHtml(s.email)}</td>
          <td>
            <div class="completion-cell">
              <div class="completion-bar"><span style="width:${s.progress}%"></span></div>
              <span>${s.progress}%</span>
            </div>
          </td>
          <td><span class="status-pill ${statusCls}">${escapeHtml(statusLabel)}</span></td>
          <td><span class="grade-pill ${gradeClass}">${Number(s.avgGrade).toFixed(1)}%</span></td>
        </tr>
      `;
    }).join("");

    tbody.querySelectorAll(".clickable-row").forEach(row => {
      row.addEventListener("click", () => openStudentModal(Number(row.dataset.studentId), row.dataset.courseId));
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="error-text">${escapeHtml(i18nT("students.loadError", "Impossible de charger les étudiants : "))}${escapeHtml(err.message)}</td></tr>`;
  }
}

async function openStudentModal(studentId, courseId) {
  openModal(`<p class="loading-text">${escapeHtml(i18nT("students.loadingDetail", "Chargement du détail de l'étudiant…"))}</p>`);

  try {
    const detail = await apiGet(
      `/students.php?course=${encodeURIComponent(courseId)}&student=${encodeURIComponent(studentId)}`
    );
    const course = COURSES_CACHE.find(c => c.id === courseId);
    const daysWord = i18nT("courses.days", "jours");

    const html = `
      <h3 class="modal-title">${escapeHtml(detail.name)}</h3>
      <p class="modal-subtitle">${escapeHtml(detail.email)} · ${course ? escapeHtml(course.name) : ""}</p>

      <div class="modal-stats-grid">
        <div class="modal-stat"><span class="modal-stat-label">${escapeHtml(i18nT("students.modalProgression", "PROGRESSION"))}</span><span class="modal-stat-value">${detail.progress}%</span></div>
        <div class="modal-stat"><span class="modal-stat-label">${escapeHtml(i18nT("students.modalAverage", "MOYENNE"))}</span><span class="modal-stat-value">${Number(detail.avgGrade).toFixed(1)}%</span></div>
        <div class="modal-stat"><span class="modal-stat-label">${escapeHtml(i18nT("students.modalStatus", "STATUT"))}</span><span class="modal-stat-value">${detail.completed ? escapeHtml(i18nT("students.statusCompleted", "Terminé")) : escapeHtml(i18nT("students.statusInProgress", "En cours"))}</span></div>
        <div class="modal-stat"><span class="modal-stat-label">${escapeHtml(detail.completed ? i18nT("students.modalCompletedIn", "TERMINÉ EN") : i18nT("students.modalDaysElapsed", "JOURS ÉCOULÉS"))}</span><span class="modal-stat-value">${detail.daysToComplete ?? "—"} ${detail.daysToComplete ? escapeHtml(daysWord) : ""}</span></div>
      </div>

      <p class="modal-section-title">${escapeHtml(i18nT("students.examsCompleted", "Examens effectués"))}</p>
      <ul class="modal-list">
        ${detail.exams.map(ex => `<li><span>${escapeHtml(ex.name)}</span><span class="grade-pill ${ex.score >= 75 ? "high" : ""}">${ex.score}%</span></li>`).join("")}
      </ul>

      <p class="modal-section-title">${escapeHtml(i18nT("students.exercisesTitle", "Exercices"))}</p>
      <ul class="modal-list">
        ${detail.exercises.map(ex => `<li><span>${escapeHtml(ex.name)}</span><span class="status-pill ${ex.status === "Terminé" ? "completed" : "in-progress"}">${escapeHtml(translateExerciseStatus(ex.status))}</span></li>`).join("")}
      </ul>
    `;
    openModal(html);
  } catch (err) {
    openModal(`<p class="error-text">${escapeHtml(i18nT("students.detailLoadError", "Impossible de charger le détail de l'étudiant : "))}${escapeHtml(err.message)}</p>`);
  }
}

/* ---------------------------------------------------------
   8. REPORTS — résumé par cours (déjà pré-calculé par le backend)
   --------------------------------------------------------- */
function reportHeadlineLabel(level) {
  const icons = { critical: "🔴", warning: "🟡", ok: "🟢" };
  const keys = { critical: "reports.headlineCritical", warning: "reports.headlineWarning", ok: "reports.headlineOk" };
  return `${icons[level] || ""} ${i18nT(keys[level] || "", "")}`.trim();
}

const REPORT_ALERT_ICONS = { critical: "🔴", warning: "🟡" };

// Couleurs par code de priorité ('high'/'medium'/'low' — langue-agnostique,
// le libellé affiché vient de priorityLabel, déjà traduit côté serveur).
const ACTION_PRIORITY_STYLE = {
  high: { color: "#c0392b", bg: "#fdecea" },
  medium: { color: "#b8860b", bg: "#fff8e6" },
  low: { color: "#2e7d32", bg: "#eaf7ec" },
};

function renderReportCards(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return "";
  return `
    <div class="report-cards-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:10px; margin:14px 0;">
      ${cards.map(c => `
        <div class="report-mini-card" style="border:1px solid #e6e9ef; border-radius:10px; padding:10px 12px; background:#fafbfd;">
          <div style="font-size:18px;">${escapeHtml(c.icon || "")}</div>
          <div style="font-size:11.5px; color:var(--color-muted, #7c93ac); margin-top:4px;">${escapeHtml(c.label)}</div>
          <div style="font-size:15px; font-weight:700; margin-top:2px;">${escapeHtml(String(c.value))}</div>
        </div>
      `).join("")}
    </div>`;
}

function renderReportAlerts(alerts) {
  if (!Array.isArray(alerts) || alerts.length === 0) return "";
  return `
    <div class="report-section" style="margin:14px 0;">
      <h5 style="margin:0 0 8px;">${escapeHtml(i18nT("reports.sectionAttention", "Points d'attention"))}</h5>
      ${alerts.map(a => `
        <div style="display:flex; gap:8px; align-items:flex-start; padding:8px 10px; border-radius:8px; margin-bottom:6px; background:${a.level === "critical" ? "#fdecea" : "#fff8e6"};">
          <span>${REPORT_ALERT_ICONS[a.level] || "•"}</span>
          <span style="font-size:13px;">${escapeHtml(a.message)}</span>
        </div>
      `).join("")}
    </div>`;
}

function renderDistributionBars(distribution) {
  if (!Array.isArray(distribution) || distribution.length === 0) return "";
  const max = Math.max(1, ...distribution.map(d => d.count));
  return `
    <div style="margin-top:10px;">
      ${distribution.map(d => `
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:5px;">
          <span style="width:52px; font-size:11.5px; color:var(--color-muted, #7c93ac);">${escapeHtml(d.range)}/20</span>
          <div style="flex:1; background:#eef1f6; border-radius:5px; overflow:hidden; height:12px;">
            <div style="width:${(d.count / max) * 100}%; background:#4a7fe8; height:100%;"></div>
          </div>
          <span style="width:24px; font-size:11.5px; text-align:right;">${d.count}</span>
        </div>
      `).join("")}
    </div>`;
}

function renderReportPerformance(performance) {
  if (!performance) return "";
  const kpis = [
    [i18nT("reports.average", "Moyenne"), `${performance.avgGrade20 ?? "—"}/20`],
    [i18nT("reports.median", "Médiane"), `${performance.median20 ?? "—"}/20`],
    [i18nT("reports.bestGrade", "Meilleure note"), `${performance.bestGrade20 ?? "—"}/20`],
    [i18nT("reports.worstGrade", "Plus faible note"), `${performance.worstGrade20 ?? "—"}/20`],
    [i18nT("reports.successRateLabel", "Taux de réussite"), `${performance.successRate}%`],
  ];
  const strugglingLine = i18nT("reports.strugglingExcellent", "{struggling} étudiant(s) en difficulté (note < 8/20), {excellent} excellent(s) (note ≥ 16/20).")
    .replace("{struggling}", performance.strugglingCount)
    .replace("{excellent}", performance.excellentCount);
  return `
    <div class="report-section" style="margin:14px 0;">
      <h5 style="margin:0 0 8px;">${escapeHtml(i18nT("reports.sectionPerformance", "Analyse des performances — vos étudiants comprennent-ils le cours ?"))}</h5>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:8px;">
        ${kpis.map(([label, value]) => `
          <div style="font-size:12.5px;"><span style="color:var(--color-muted, #7c93ac);">${escapeHtml(label)} : </span><strong>${escapeHtml(String(value))}</strong></div>
        `).join("")}
      </div>
      ${renderDistributionBars(performance.distribution)}
      <p style="font-size:12.5px; margin-top:10px;">${escapeHtml(strugglingLine)}</p>
    </div>`;
}

function renderReportEngagement(engagement) {
  if (!engagement) return "";
  return `
    <div class="report-section" style="margin:14px 0;">
      <h5 style="margin:0 0 8px;">${escapeHtml(i18nT("reports.sectionEngagement", "Engagement — vos étudiants sont-ils actifs ?"))}</h5>
      <p style="font-size:12.5px;">
        ${escapeHtml(i18nT("reports.participationLabel", "Participation"))} : <strong>${engagement.participationRate}%</strong> ·
        ${escapeHtml(i18nT("reports.avgActivityLabel", "Activité moyenne"))} : <strong>${engagement.avgActionsPerStudent}</strong> ${escapeHtml(i18nT("reports.actionsPerStudentSuffix", "action(s)/étudiant"))} ·
        ${escapeHtml(i18nT("reports.activitiesCompletedLabel", "Activités complétées"))} : <strong>${engagement.activitiesCompletedRate}%</strong>
      </p>
    </div>`;
}

function renderReportBottlenecks(bottlenecks) {
  if (!Array.isArray(bottlenecks) || bottlenecks.length === 0) return "";
  return `
    <div class="report-section" style="margin:14px 0;">
      <h5 style="margin:0 0 8px;">${escapeHtml(i18nT("reports.sectionBottlenecks", "Points de blocage"))}</h5>
      ${bottlenecks.map(b => `
        <div style="font-size:12.5px; margin-bottom:4px;">🚧 <strong>${escapeHtml(b.name)}</strong> — ${escapeHtml(i18nT("reports.bottleneckStuck", "{pct}% des étudiants bloqués ou n'ayant pas commencé").replace("{pct}", b.stuckPct))}</div>
      `).join("")}
    </div>`;
}

function renderReportAtRisk(atRiskStudents) {
  if (!Array.isArray(atRiskStudents) || atRiskStudents.length === 0) return "";
  const title = i18nT("reports.sectionAtRisk", "Étudiants à risque ({n})").replace("{n}", atRiskStudents.length);
  return `
    <div class="report-section" style="margin:14px 0;">
      <h5 style="margin:0 0 8px;">${escapeHtml(title)}</h5>
      ${atRiskStudents.map(s => `
        <div style="font-size:12.5px; margin-bottom:4px;">🔍 <strong>${escapeHtml(s.name)}</strong> — ${escapeHtml(s.reasons.join(", "))}</div>
      `).join("")}
    </div>`;
}

function renderReportBenchmark(benchmark) {
  if (!benchmark || !benchmark.available) return "";
  const deltaLabel = (v) => (v > 0 ? `+${v}` : `${v}`);
  const line = i18nT("reports.benchmarkLine", "Complétion : {completion} pts vs moyenne · Abandon : {dropout} pts vs moyenne · Score quiz : {quiz} pts vs moyenne")
    .replace("{completion}", deltaLabel(benchmark.completionDelta))
    .replace("{dropout}", deltaLabel(benchmark.dropoutDelta))
    .replace("{quiz}", deltaLabel(benchmark.quizDelta));
  return `
    <div class="report-section" style="margin:14px 0;">
      <h5 style="margin:0 0 8px;">${escapeHtml(i18nT("reports.sectionBenchmark", "Comparaison aux autres cours"))}</h5>
      <p style="font-size:12.5px;">${escapeHtml(line)}</p>
    </div>`;
}

function renderReportActionPlan(actionPlan) {
  if (!Array.isArray(actionPlan) || actionPlan.length === 0) return "";
  return `
    <div class="report-section" style="margin:14px 0;">
      <h5 style="margin:0 0 8px;">${escapeHtml(i18nT("reports.sectionActionPlan", "Plan d'action"))}</h5>
      ${actionPlan.map(p => {
        const style = ACTION_PRIORITY_STYLE[p.priority] || ACTION_PRIORITY_STYLE.low;
        return `
          <div style="display:flex; gap:8px; align-items:flex-start; padding:8px 10px; border-radius:8px; margin-bottom:6px; background:${style.bg};">
            <span style="font-size:11px; font-weight:700; color:${style.color}; white-space:nowrap;">${escapeHtml(p.priorityLabel || p.priority)}</span>
            <span style="font-size:12.5px;">${escapeHtml(p.action)}</span>
          </div>`;
      }).join("")}
    </div>`;
}

async function renderReports() {
  const list = document.getElementById("reportsList");
  list.innerHTML = `<p class="loading-text">${escapeHtml(i18nT("reports.loading", "Chargement des rapports…"))}</p>`;

  try {
    const lang = (typeof MoodQI18n !== "undefined") ? MoodQI18n.getCurrentLang() : "fr";
    const data = await apiGet(`/reports.php?lang=${encodeURIComponent(lang)}`);
    const reports = data.reports || [];

    list.innerHTML = reports.map(r => `
      <div class="report-card">
        <div class="report-card-header">
          <div>
            <h4>${escapeHtml(r.courseName)} <span style="color:var(--color-muted); font-weight:500;">(${escapeHtml(r.courseId)})</span></h4>
            <p class="report-date">${escapeHtml(i18nT("reports.generatedOn", "Rapport généré le {date}").replace("{date}", formatIsoDate(r.generatedAt)))}</p>
          </div>
          <div style="display:flex; gap:10px; align-items:center;">
            <span style="font-size:12px; font-weight:600; white-space:nowrap;">${escapeHtml(reportHeadlineLabel(r.headlineLevel))}</span>
            <button class="export-btn" data-export-course="${escapeHtml(r.courseId)}">${escapeHtml(i18nT("reports.exportPdf", "📄 Exporter PDF"))}</button>
          </div>
        </div>

        <p class="report-summary">${escapeHtml(r.summary)}</p>

        ${renderReportCards(r.cards)}
        ${renderReportAlerts(r.alerts)}
        ${renderReportPerformance(r.performance)}
        ${renderReportEngagement(r.engagement)}
        ${renderReportBottlenecks(r.bottlenecks)}
        ${renderReportAtRisk(r.atRiskStudents)}
        ${renderReportBenchmark(r.benchmark)}
        ${renderReportActionPlan(r.actionPlan)}

        ${r.topStudent ? `
          <div class="report-section" style="margin-top:14px; padding-top:12px; border-top:1px solid #eef1f6;">
            <h5 style="margin:0 0 6px;">${escapeHtml(i18nT("reports.topStudentSection", "Étudiant en tête de classement"))}</h5>
            <p style="font-size:12.5px;">${escapeHtml(i18nT("reports.topStudentLine", "{name} — moyenne de {grade}%").replace("{name}", r.topStudent.name).replace("{grade}", Number(r.topStudent.avgGrade).toFixed(1)))}</p>
          </div>` : ""}
      </div>
    `).join("");

    list.querySelectorAll("[data-export-course]").forEach(btn => {
      btn.addEventListener("click", () => {
        const report = reports.find(r => r.courseId === btn.dataset.exportCourse);
        if (report) exportReportToPdf(report);
      });
    });
  } catch (err) {
    list.innerHTML = `<p class="error-text">${escapeHtml(i18nT("reports.loadError", "Impossible de charger les rapports : "))}${escapeHtml(err.message)}</p>`;
  }
}

function exportReportToPdf(report) {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) {
    alert(i18nT("reports.pdfLibMissing", "La librairie jsPDF n'est pas chargée. Vérifie que le script CDN est bien inclus dans index.html."));
    return;
  }

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const marginX = 18;
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 22;

  // Ajoute une page si on n'a plus la place pour `neededHeight` mm.
  function ensureSpace(neededHeight) {
    if (y + neededHeight > pageHeight - 15) {
      doc.addPage();
      y = 20;
    }
  }

  function sectionTitle(title) {
    ensureSpace(12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(20, 20, 20);
    doc.text(title, marginX, y);
    y += 7;
  }

  function keyValueLine(label, value) {
    ensureSpace(6);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`${label} :`, marginX, y);
    doc.text(String(value), marginX + 65, y);
    y += 6;
  }

  function bulletLine(text, prefix = "•") {
    ensureSpace(10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const lines = doc.splitTextToSize(`${prefix} ${text}`, pageWidth - marginX * 2 - 4);
    doc.text(lines, marginX + 2, y);
    y += lines.length * 5 + 2;
  }

  // --- En-tête ---
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(`${report.courseName} (${report.courseId})`, marginX, y);

  y += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(120, 120, 120);
  doc.text(i18nT("reports.generatedOn", "Rapport généré le {date}").replace("{date}", formatIsoDate(report.generatedAt)), marginX, y);
  if (report.headlineLevel) {
    doc.text(reportHeadlineLabel(report.headlineLevel).replace(/^[^ ]+ /, ""), pageWidth - marginX, y, { align: "right" });
  }
  doc.setTextColor(20, 20, 20);

  y += 10;
  doc.setFontSize(11);
  const summaryLines = doc.splitTextToSize(report.summary, pageWidth - marginX * 2);
  doc.text(summaryLines, marginX, y);
  y += summaryLines.length * 5.5 + 8;

  // --- Cartes de synthèse ---
  if (Array.isArray(report.cards) && report.cards.length > 0) {
    sectionTitle(i18nT("reports.pdfKeyStats", "Statistiques clés"));
    report.cards.forEach(c => keyValueLine(c.label, c.value));
    y += 3;
  }

  // --- Alertes ---
  if (Array.isArray(report.alerts) && report.alerts.length > 0) {
    sectionTitle(i18nT("reports.sectionAttention", "Points d'attention"));
    report.alerts.forEach(a => bulletLine(a.message, a.level === "critical" ? "🔴" : "🟡"));
    y += 3;
  }

  // --- Performance ---
  if (report.performance) {
    const p = report.performance;
    sectionTitle(i18nT("reports.pdfPerformanceTitle", "Analyse des performances"));
    keyValueLine(i18nT("reports.average", "Moyenne"), `${p.avgGrade20 ?? "—"}/20`);
    keyValueLine(i18nT("reports.median", "Médiane"), `${p.median20 ?? "—"}/20`);
    keyValueLine(i18nT("reports.bestGrade", "Meilleure note"), `${p.bestGrade20 ?? "—"}/20`);
    keyValueLine(i18nT("reports.worstGrade", "Plus faible note"), `${p.worstGrade20 ?? "—"}/20`);
    keyValueLine(i18nT("reports.successRateLabel", "Taux de réussite"), `${p.successRate}%`);
    if (Array.isArray(p.distribution)) {
      y += 2;
      const studentsWord = i18nT("reports.pdfStudentsCount", "étudiant(s)");
      p.distribution.forEach(d => keyValueLine(`  ${d.range}/20`, `${d.count} ${studentsWord}`));
    }
    keyValueLine(i18nT("reports.pdfStrugglingCount", "Étudiants en difficulté"), p.strugglingCount);
    keyValueLine(i18nT("reports.pdfExcellentCount", "Étudiants excellents"), p.excellentCount);
    y += 3;
  }

  // --- Engagement ---
  if (report.engagement) {
    const e = report.engagement;
    sectionTitle(i18nT("reports.pdfEngagementTitle", "Engagement"));
    keyValueLine(i18nT("reports.pdfParticipationRate", "Taux de participation"), `${e.participationRate}%`);
    keyValueLine(i18nT("reports.avgActivityLabel", "Activité moyenne"), `${e.avgActionsPerStudent} ${i18nT("reports.actionsPerStudentSuffix", "action(s)/étudiant")}`);
    keyValueLine(i18nT("reports.activitiesCompletedLabel", "Activités complétées"), `${e.activitiesCompletedRate}%`);
    y += 3;
  }

  // --- Points de blocage ---
  if (Array.isArray(report.bottlenecks) && report.bottlenecks.length > 0) {
    sectionTitle(i18nT("reports.sectionBottlenecks", "Points de blocage"));
    const stuckWord = i18nT("reports.pdfStuckSuffix", "des étudiants bloqués");
    report.bottlenecks.forEach(b => bulletLine(`${b.name} — ${b.stuckPct}% ${stuckWord}`, "🚧"));
    y += 3;
  }

  // --- Étudiants à risque ---
  if (Array.isArray(report.atRiskStudents) && report.atRiskStudents.length > 0) {
    sectionTitle(i18nT("reports.sectionAtRisk", "Étudiants à risque ({n})").replace("{n}", report.atRiskStudents.length));
    report.atRiskStudents.forEach(s => bulletLine(`${s.name} — ${s.reasons.join(", ")}`, "🔍"));
    y += 3;
  }

  // --- Comparaison inter-cours ---
  if (report.benchmark && report.benchmark.available) {
    const b = report.benchmark;
    const deltaLabel = (v) => (v > 0 ? `+${v}` : `${v}`);
    sectionTitle(i18nT("reports.sectionBenchmark", "Comparaison aux autres cours"));
    const vsAvg = i18nT("reports.pdfVsAverage", "pts vs moyenne");
    keyValueLine(i18nT("reports.pdfCompletionVsAvg", "Complétion vs moyenne"), `${deltaLabel(b.completionDelta)} ${vsAvg}`);
    keyValueLine(i18nT("reports.pdfDropoutVsAvg", "Abandon vs moyenne"), `${deltaLabel(b.dropoutDelta)} ${vsAvg}`);
    keyValueLine(i18nT("reports.pdfQuizVsAvg", "Score quiz vs moyenne"), `${deltaLabel(b.quizDelta)} ${vsAvg}`);
    y += 3;
  }

  // --- Plan d'action ---
  if (Array.isArray(report.actionPlan) && report.actionPlan.length > 0) {
    sectionTitle(i18nT("reports.sectionActionPlan", "Plan d'action"));
    report.actionPlan.forEach(item => bulletLine(`[${item.priorityLabel || item.priority}] ${item.action}`));
    y += 3;
  }

  // --- Étudiant en tête de classement ---
  if (report.topStudent) {
    sectionTitle(i18nT("reports.topStudentSection", "Étudiant en tête de classement"));
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    ensureSpace(7);
    doc.text(
      i18nT("reports.topStudentLine", "{name} — moyenne de {grade}%")
        .replace("{name}", report.topStudent.name)
        .replace("{grade}", Number(report.topStudent.avgGrade).toFixed(1)),
      marginX, y
    );
  }

  doc.save(`rapport-${report.courseId}.pdf`);

  createNotification(
    "report",
    i18nT("notifications.reportReadyTitle", "Rapport prêt"),
    i18nT("notifications.reportReadyText", "Le rapport de {course} a été téléchargé.").replace("{course}", report.courseName)
  );
}

/* ---------------------------------------------------------
   9. MODAL GÉNÉRIQUE
   --------------------------------------------------------- */
function openModal(innerHtml) {
  document.getElementById("modalContent").innerHTML = innerHtml;
  document.getElementById("modalOverlay").classList.add("visible");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  document.getElementById("modalOverlay").classList.remove("visible");
  document.body.style.overflow = "";
}

function initModal() {
  const overlay = document.getElementById("modalOverlay");
  document.getElementById("modalClose").addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
}

/* ---------------------------------------------------------
   9bis. STATUT DE CONNEXION IA (bannière Recherche IA)
   -----------------------------------------------------------
   Met à jour le badge "Connecté / Déconnecté" affiché dans la
   bannière hero. Utilise l'endpoint /health.php s'il existe ;
   à défaut, considère la connexion active dès qu'une session
   utilisateur valide est confirmée (fallback simple).
   --------------------------------------------------------- */
function setAiConnectionStatus(isConnected) {
  const badge = document.getElementById("aiConnectionStatus");
  const text = document.getElementById("aiConnectionText");
  if (!badge || !text) return;
  badge.classList.toggle("connected", isConnected);
  text.textContent = isConnected ? "Connecté" : "Déconnecté";
}

async function updateAiConnectionStatus() {
  try {
    // Remplacer par un vrai endpoint de santé backend/Gemini si disponible,
    // ex: await apiGet("/health.php");
    setAiConnectionStatus(!!CURRENT_USER);
  } catch {
    setAiConnectionStatus(false);
  }
}

/* ---------------------------------------------------------
   10. DIVERS
   --------------------------------------------------------- */
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(date) {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "long", year: "numeric" }).format(date);
}

function formatIsoDate(isoDateString) {
  const [year, month, day] = isoDateString.split("-").map(Number);
  return formatDate(new Date(year, month - 1, day));
}

function formatDateTime(isoString) {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
  }).format(new Date(isoString));
}

/* ---------------------------------------------------------
   INITIALISATION
   --------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  initDashboard();
  initSidebarNav();
  initBrandHomeLink();
  initModal();
  initClearHistory();
  initLoginForm();
  initLogoutButton();
  initProfilePanel();
  checkSession();
});