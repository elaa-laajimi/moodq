<?php
/**
 * index.php
 * -----------------------------------------------------------
 * Version "pleine page", intégrée au thème Moodle natif, de la
 * recherche IA MoodQ — c'est la page pointée par le lien de
 * navigation. Utilise le même moteur (classes/nl2sql.php) que
 * la bulle, via le même endpoint ajax.php.
 * -----------------------------------------------------------
 */

require_once(__DIR__ . '/../../config.php');

require_login();
require_capability('local/moodq:use', context_system::instance());

$PAGE->set_url(new moodle_url('/local/moodq/index.php'));
$PAGE->set_context(context_system::instance());
$PAGE->set_title(get_string('pluginname', 'local_moodq'));
$PAGE->set_heading(get_string('pluginname', 'local_moodq'));
$PAGE->set_pagelayout('standard');

$PAGE->requires->css('/local/moodq/styles.css');
$PAGE->requires->js_init_code(
    'window.MOODQ_BUBBLE_CONFIG = ' . json_encode([
        'wwwroot' => $CFG->wwwroot,
        'sesskey' => sesskey(),
        'lang' => current_language(),
        'userFirstName' => $USER->firstname ?? '',
    ], JSON_UNESCAPED_UNICODE) . ';'
);
$PAGE->requires->js(new moodle_url('/local/moodq/js/fullpage.js'));

echo $OUTPUT->header();
?>
<div id="moodq-fullpage-root" class="moodq-fullpage">
  <div class="moodq-fullpage-card">
    <h3 class="moodq-fullpage-title"><?php echo get_string('pluginname', 'local_moodq'); ?></h3>
    <form id="moodq-fullpage-form" class="moodq-fullpage-form">
      <input type="text" id="moodq-fullpage-input" class="moodq-fullpage-input" autocomplete="off">
      <button type="submit" class="moodq-fullpage-submit">➤</button>
    </form>
    <div id="moodq-fullpage-answer" class="moodq-fullpage-answer hidden"></div>
  </div>
</div>
<?php
echo $OUTPUT->footer();
