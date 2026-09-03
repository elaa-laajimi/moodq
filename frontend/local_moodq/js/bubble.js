/**
 * js/bubble.js — v2
 * -----------------------------------------------------------
 * Bulle de chat flottante MoodQ, injectée sur chaque page Moodle
 * via local_moodq_before_standard_head_html_generation() (lib.php).
 * JS vanilla (pas de build AMD requis).
 *
 * Nouveautés v2 :
 * - Logo MoodQ à la place de l'icône ✧ (pix/logo.png, avec repli
 *   propre si le fichier n'existe pas encore)
 * - Panneau agrandi
 * - Bouton "Historique" à la place du lien plein écran
 * - Mini-tableau de résultats sous la réponse
 * - Questions suggérées au premier affichage
 * - Historique persistant (localStorage), consultable et effaçable
 * -----------------------------------------------------------
 */
(function () {
  const config = window.MOODQ_BUBBLE_CONFIG;
  if (!config) return;

  const HISTORY_KEY = 'moodq_bubble_history_v1';
  const HISTORY_MAX = 30;
  const LOGO_URL = `${config.wwwroot}/local/moodq/pix/logo.png`;

  let dict = {};
  let open = false;
  let currentView = 'chat'; // 'chat' | 'history'

  function t(key, fallback) {
    return dict[key] || fallback || key;
  }

  function tVars(key, vars, fallback) {
    let str = t(key, fallback);
    for (const [name, value] of Object.entries(vars)) {
      str = str.replace(`{${name}}`, value);
    }
    return str;
  }

  async function loadDict() {
    try {
      const res = await fetch(`${config.wwwroot}/local/moodq/moodqlang/${config.lang}.json`);
      dict = await res.json();
    } catch (e) {
      dict = {};
    }
    render();
  }

  /* ---------- Historique (localStorage) ---------- */

  function loadHistory() {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
    } catch (e) {
      return [];
    }
  }

  function saveHistoryEntry(entry) {
    const history = loadHistory();
    history.unshift(entry); // plus récent en premier
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_MAX)));
  }

  function clearHistory() {
    localStorage.removeItem(HISTORY_KEY);
    renderHistoryList();
  }

  /* ---------- Rendu ---------- */

  function render() {
    if (document.getElementById('moodq-bubble-root')) {
      applyTexts();
      return;
    }

    const root = document.createElement('div');
    root.id = 'moodq-bubble-root';
    root.innerHTML = `
      <button type="button" id="moodq-bubble-toggle" class="moodq-bubble-toggle" aria-label="MoodQ">
        <img src="${LOGO_URL}" alt="MoodQ" class="moodq-bubble-toggle-img" id="moodq-bubble-toggle-img">
        <span class="moodq-bubble-toggle-fallback" id="moodq-bubble-toggle-fallback" hidden>✧</span>
      </button>

      <div id="moodq-bubble-panel" class="moodq-bubble-panel hidden">
        <div class="moodq-bubble-header">
          <div class="moodq-bubble-header-left">
            <img src="${LOGO_URL}" alt="" class="moodq-bubble-avatar" id="moodq-bubble-avatar">
            <div class="moodq-bubble-header-text">
              <span class="moodq-bubble-title" data-moodq-t="bubble.title">MoodQ</span>
              <span class="moodq-bubble-subtitle" id="moodq-bubble-view-label">${t('bubble.subtitleDefault', 'AI Search')}</span>
            </div>
          </div>
          <div class="moodq-bubble-header-actions">
            <button type="button" id="moodq-bubble-history-toggle" class="moodq-bubble-icon-btn" title="${t('bubble.historyTitle', 'Historique')}">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>
            </button>
            <button type="button" id="moodq-bubble-close" class="moodq-bubble-icon-btn" aria-label="${t('bubble.close', 'Fermer')}">✕</button>
          </div>
        </div>

        <div id="moodq-bubble-chat-view">
          <div id="moodq-bubble-messages" class="moodq-bubble-messages">
            <div class="moodq-bubble-msg moodq-bubble-msg-bot" data-moodq-t="bubble.welcome">
              ${t('bubble.welcome', 'Bonjour ! Posez-moi une question sur vos cours et vos étudiants.')}
            </div>
            <div class="moodq-bubble-suggestions" id="moodq-bubble-suggestions"></div>
          </div>
          <form id="moodq-bubble-form" class="moodq-bubble-form">
            <input
              type="text"
              id="moodq-bubble-input"
              class="moodq-bubble-input"
              placeholder="${t('bubble.placeholder', 'Posez votre question...')}"
              autocomplete="off"
            >
            <button type="submit" class="moodq-bubble-send" aria-label="${t('bubble.send', 'Envoyer')}">
              <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>
            </button>
          </form>
        </div>

        <div id="moodq-bubble-history-view" class="hidden">
          <div class="moodq-bubble-history-toolbar">
            <span data-moodq-t="bubble.historyTitle">${t('bubble.historyTitle', 'Historique')}</span>
            <button type="button" id="moodq-bubble-clear-history" class="moodq-bubble-text-btn" data-moodq-t="bubble.clearHistory">${t('bubble.clearHistory', 'Effacer')}</button>
          </div>
          <div id="moodq-bubble-history-list" class="moodq-bubble-history-list"></div>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    document.getElementById('moodq-bubble-toggle').addEventListener('click', togglePanel);
    document.getElementById('moodq-bubble-close').addEventListener('click', togglePanel);
    document.getElementById('moodq-bubble-form').addEventListener('submit', onSubmit);
    document.getElementById('moodq-bubble-history-toggle').addEventListener('click', toggleHistoryView);
    document.getElementById('moodq-bubble-clear-history').addEventListener('click', clearHistory);

    // Logo : si l'image n'existe pas (404), on retombe sur un pictogramme simple.
    document.getElementById('moodq-bubble-toggle-img').addEventListener('error', function () {
      this.hidden = true;
      document.getElementById('moodq-bubble-toggle-fallback').hidden = false;
    });
    document.getElementById('moodq-bubble-avatar').addEventListener('error', function () {
      this.style.display = 'none';
    });

    renderSuggestions();
  }

  function applyTexts() {
    document.querySelectorAll('[data-moodq-t]').forEach(el => {
      el.textContent = t(el.getAttribute('data-moodq-t'));
    });
  }

  function renderSuggestions() {
    const box = document.getElementById('moodq-bubble-suggestions');
    if (!box) return;
    const suggestions = [
      t('bubble.suggestion1', 'Combien de cours ai-je ?'),
      t('bubble.suggestion2', 'Mes 5 meilleurs étudiants'),
      t('bubble.suggestion3', "Taux d'abandon par cours"),
    ];
    box.innerHTML = suggestions.map(s => `<button type="button" class="moodq-bubble-chip">${escapeHtml(s)}</button>`).join('');
    box.querySelectorAll('.moodq-bubble-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.getElementById('moodq-bubble-input').value = chip.textContent;
        submitQuestion(chip.textContent);
      });
    });
  }

  function togglePanel() {
    open = !open;
    document.getElementById('moodq-bubble-panel').classList.toggle('hidden', !open);
    if (open) document.getElementById('moodq-bubble-input').focus();
  }

  function toggleHistoryView() {
    currentView = currentView === 'chat' ? 'history' : 'chat';
    document.getElementById('moodq-bubble-chat-view').classList.toggle('hidden', currentView === 'history');
    document.getElementById('moodq-bubble-history-view').classList.toggle('hidden', currentView === 'chat');
    document.getElementById('moodq-bubble-view-label').textContent =
      currentView === 'history' ? t('bubble.historyTitle', 'Historique') : t('bubble.subtitleDefault', 'AI Search');
    if (currentView === 'history') renderHistoryList();
  }

  function renderHistoryList() {
    const list = document.getElementById('moodq-bubble-history-list');
    const history = loadHistory();
    if (history.length === 0) {
      list.innerHTML = `<p class="moodq-bubble-history-empty">${escapeHtml(t('bubble.historyEmpty', 'Aucune question pour le moment.'))}</p>`;
      return;
    }
    list.innerHTML = history.map(item => `
      <div class="moodq-bubble-history-item">
        <p class="moodq-bubble-history-q">${escapeHtml(item.question)}</p>
        <p class="moodq-bubble-history-a">${escapeHtml(item.answer)}</p>
      </div>
    `).join('');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
  }

  function addMessage(text, who) {
    const messages = document.getElementById('moodq-bubble-messages');
    const el = document.createElement('div');
    el.className = `moodq-bubble-msg moodq-bubble-msg-${who}`;
    el.textContent = text;
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
    return el;
  }

  function addTable(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return;
    const messages = document.getElementById('moodq-bubble-messages');
    const columns = Object.keys(rows[0]);
    const displayRows = rows.slice(0, 8);

    const wrap = document.createElement('div');
    wrap.className = 'moodq-bubble-table-wrap';
    wrap.innerHTML = `
      <p class="moodq-bubble-table-label">${escapeHtml(t('bubble.resultsLabel', 'Résultats'))}</p>
      <div class="moodq-bubble-table-scroll">
        <table class="moodq-bubble-table">
          <thead><tr>${columns.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
          <tbody>
            ${displayRows.map(row => `<tr>${columns.map(c => `<td>${escapeHtml(row[c])}</td>`).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${rows.length > displayRows.length
        ? `<p class="moodq-bubble-table-more">${escapeHtml(tVars('bubble.moreRows', { n: rows.length - displayRows.length }, '+{n} de plus'))}</p>`
        : ''}
    `;
    messages.appendChild(wrap);
    messages.scrollTop = messages.scrollHeight;
  }

  function onSubmit(e) {
    e.preventDefault();
    const input = document.getElementById('moodq-bubble-input');
    const question = input.value.trim();
    if (!question) return;
    input.value = '';
    submitQuestion(question);
  }

  async function submitQuestion(question) {
    const input = document.getElementById('moodq-bubble-input');
    const suggestions = document.getElementById('moodq-bubble-suggestions');
    if (suggestions) suggestions.remove(); // masqués dès la première vraie question

    addMessage(question, 'user');
    input.disabled = true;
    const loadingEl = addMessage(t('bubble.loading', 'Analyse en cours…'), 'bot loading');

    try {
      const body = new URLSearchParams({
        question,
        lang: config.lang,
        sesskey: config.sesskey,
      });
      const res = await fetch(`${config.wwwroot}/local/moodq/ajax.php`, {
        method: 'POST',
        body,
        credentials: 'same-origin',
      });
      const data = await res.json();
      loadingEl.remove();

      const answerText = data.error || data.answer;
      addMessage(answerText, 'bot');
      if (!data.error && Array.isArray(data.rows) && data.rows.length > 0) {
        addTable(data.rows);
      }

      if (!data.error) {
        saveHistoryEntry({ question, answer: answerText, ts: Date.now() });
      }
    } catch (err) {
      loadingEl.remove();
      addMessage(String(err), 'bot');
    } finally {
      input.disabled = false;
      input.focus();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadDict);
  } else {
    loadDict();
  }
})();
