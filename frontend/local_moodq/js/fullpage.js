/**
 * js/fullpage.js
 * -----------------------------------------------------------
 * Logique de la page /local/moodq/index.php (recherche IA en
 * pleine page, intégrée au thème Moodle natif). Même endpoint
 * ajax.php que la bulle.
 * -----------------------------------------------------------
 */
(function () {
  const config = window.MOODQ_BUBBLE_CONFIG;
  if (!config) return;

  const form = document.getElementById('moodq-fullpage-form');
  const input = document.getElementById('moodq-fullpage-input');
  const answerBox = document.getElementById('moodq-fullpage-answer');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const question = input.value.trim();
    if (!question) return;

    answerBox.classList.remove('hidden');
    answerBox.textContent = '…';
    input.disabled = true;

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
      answerBox.textContent = data.error || data.answer;
    } catch (err) {
      answerBox.textContent = String(err);
    } finally {
      input.disabled = false;
      input.focus();
    }
  });
})();
