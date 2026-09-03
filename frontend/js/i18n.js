/**
 * MoodQ i18n engine
 * -------------------------------------------------------
 * Usage dans le HTML :
 *   <span data-i18n="nav.dashboard">Tableau de bord</span>
 *   <input data-i18n-placeholder="search.placeholder" placeholder="...">
 *
 * Usage dans le JS (contenu injecté dynamiquement par le SPA) :
 *   MoodQI18n.t('search.loading')  // retourne la chaîne traduite
 *   MoodQI18n.applyTo(monElementRacine) // ré-applique aux enfants après un re-render
 */

const MoodQI18n = (() => {
  const SUPPORTED_LANGS = ['fr', 'en', 'de', 'es', 'pt', 'ko', 'ar', 'zh', 'hi', 'ru'];
  const RTL_LANGS = ['ar']; // langues s'écrivant de droite à gauche
  const DEFAULT_LANG = 'fr';
  const LOCAL_STORAGE_KEY = 'moodq_lang';

  let currentLang = DEFAULT_LANG;
  let dictionary = {};
  let listeners = [];
  let readyPromise = null;

  /**
   * Charge le JSON de langue depuis /lang/{code}.json
   */
  async function loadLangFile(code) {
    const res = await fetch(`lang/${code}.json`, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`Impossible de charger la langue "${code}"`);
    }
    return res.json();
  }

  /**
   * Détermine la langue initiale :
   * 1. Préférence Moodle (déjà injectée côté PHP dans window.MOODQ_USER_LANG si connue)
   * 2. localStorage (dernier choix connu côté navigateur)
   * 3. Langue du navigateur si supportée
   * 4. Fallback: fr
   */
  function resolveInitialLang() {
    if (window.MOODQ_USER_LANG && SUPPORTED_LANGS.includes(window.MOODQ_USER_LANG)) {
      return window.MOODQ_USER_LANG;
    }
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (stored && SUPPORTED_LANGS.includes(stored)) {
      return stored;
    }
    const browserLang = (navigator.language || 'fr').slice(0, 2);
    if (SUPPORTED_LANGS.includes(browserLang)) {
      return browserLang;
    }
    return DEFAULT_LANG;
  }

  /**
   * Traduit une clé. Retourne la clé elle-même si absente (facilite le debug).
   */
  function t(key, fallback = null) {
    return dictionary[key] || fallback || key;
  }

  /**
   * Applique les traductions à tous les éléments data-i18n* sous root (document par défaut).
   * À rappeler après chaque re-render du SPA (changement de vue).
   */
  function applyTo(root = document) {
    root.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });
    root.querySelectorAll('[data-i18n-title]').forEach(el => {
      el.title = t(el.getAttribute('data-i18n-title'));
    });
    document.documentElement.setAttribute('lang', currentLang);
    document.documentElement.setAttribute('dir', RTL_LANGS.includes(currentLang) ? 'rtl' : 'ltr');
  }

  /**
   * Change la langue active : charge le dictionnaire, ré-applique le DOM,
   * sauvegarde en local + côté Moodle, et notifie les abonnés (ex: pour relancer
   * une recherche IA en cours dans la nouvelle langue).
   */
  async function setLang(code) {
    if (!SUPPORTED_LANGS.includes(code)) {
      console.warn(`Langue non supportée: ${code}`);
      return;
    }
    dictionary = await loadLangFile(code);
    currentLang = code;
    localStorage.setItem(LOCAL_STORAGE_KEY, code);
    applyTo(document);
    savePreferenceToMoodle(code);
    listeners.forEach(cb => cb(code));
  }

  /**
   * Sauvegarde la préférence côté Moodle (user_preferences) via un petit endpoint AJAX.
   * Ne bloque pas l'UI si ça échoue (l'utilisateur reste connecté avec sa langue en localStorage).
   */
  async function savePreferenceToMoodle(code) {
    try {
      await fetch('set_lang.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang: code }),
        credentials: 'same-origin'
      });
    } catch (e) {
      console.warn('Préférence de langue non synchronisée avec Moodle (hors ligne ?)', e);
    }
  }

  /**
   * Permet à d'autres modules (ex: ai-search.js) de réagir à un changement de langue.
   */
  function onChange(callback) {
    listeners.push(callback);
  }

  function getCurrentLang() {
    return currentLang;
  }

  function getSupportedLangs() {
    return SUPPORTED_LANGS;
  }

  /**
   * Initialisation au chargement de la page.
   */
  async function init() {
    const lang = resolveInitialLang();
    dictionary = await loadLangFile(lang);
    currentLang = lang;
    applyTo(document);
  }

  /**
   * Construit et monte le sélecteur de langue (globe + dropdown) dans l'élément
   * dont l'id est passé en paramètre. À appeler une fois le DOM du conteneur prêt
   * (donc après l'élément dans le HTML, ou dans un script placé après lui).
   */
  async function mountLangSelector(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `
      <div class="moodq-lang-selector" id="moodqLangSelector">
        <button type="button" class="theme-mode-toggle moodq-lang-toggle" id="moodqLangToggle" title="Langue / Language" aria-haspopup="true" aria-expanded="false">
          <span class="moodq-lang-flag" id="moodqLangCurrentFlag">🌐</span>
        </button>
        <ul class="moodq-lang-dropdown" id="moodqLangDropdown" role="menu" hidden></ul>
      </div>`;

    const toggle = container.querySelector('#moodqLangToggle');
    const dropdown = container.querySelector('#moodqLangDropdown');
    const currentFlag = container.querySelector('#moodqLangCurrentFlag');

    const dictCache = {};
    async function getDict(code) {
      if (!dictCache[code]) {
        dictCache[code] = await loadLangFile(code);
      }
      return dictCache[code];
    }

    async function buildList() {
      dropdown.innerHTML = '';
      for (const code of SUPPORTED_LANGS) {
        const dict = await getDict(code);
        const li = document.createElement('li');
        li.className = 'moodq-lang-option' + (code === currentLang ? ' active' : '');
        li.setAttribute('role', 'menuitem');
        li.dataset.lang = code;
        li.innerHTML = `<span>${dict['meta.flag']}</span><span>${dict['meta.name']}</span>`;
        li.addEventListener('click', async () => {
          await setLang(code);
          currentFlag.textContent = dict['meta.flag'];
          dropdown.hidden = true;
          buildList();
        });
        dropdown.appendChild(li);
      }
    }

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.hidden = !dropdown.hidden;
      toggle.setAttribute('aria-expanded', String(!dropdown.hidden));
    });
    document.addEventListener('click', (e) => {
      if (!container.contains(e.target)) dropdown.hidden = true;
    });

    if (readyPromise) await readyPromise; // attend que la langue initiale soit résolue avant d'afficher

    const initDict = await getDict(currentLang);
    currentFlag.textContent = initDict['meta.flag'];
    buildList();
  }

  function start() {
    readyPromise = init();
    return readyPromise;
  }

  return { init: start, t, applyTo, setLang, onChange, getCurrentLang, getSupportedLangs, mountLangSelector };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => MoodQI18n.init());
} else {
  MoodQI18n.init();
}