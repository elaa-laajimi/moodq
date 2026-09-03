<?php
/**
 * lib.php
 * -----------------------------------------------------------
 * Callbacks Moodle du plugin :
 * - local_moodq_extend_navigation()               → lien "MoodQ" dans la navigation
 *   (apparaît notamment dans My courses / la nav principale)
 * - local_moodq_before_standard_head_html_generation()
 *   → injecte le CSS/JS de la bulle de chat sur CHAQUE page Moodle.
 *
 * NB : local/moodq:use contrôle qui voit le lien de nav ET la bulle —
 * un visiteur non connecté ou sans la capacité ne voit ni l'un ni l'autre.
 * -----------------------------------------------------------
 */

defined('MOODLE_INTERNAL') || die();

/**
 * Ajoute "MoodQ" à la navigation principale de Moodle.
 * C'est ce lien qui rend le plugin visible dans My courses / la nav globale
 * (Site administration affiche automatiquement le plugin dès qu'il a un
 * settings.php — pas besoin de code supplémentaire pour ça).
 */
function local_moodq_extend_navigation(global_navigation $navigation) {
    if (!isloggedin() || isguestuser()) {
        return;
    }
    if (!has_capability('local/moodq:use', context_system::instance())) {
        return;
    }

    $node = navigation_node::create(
        get_string('pluginname', 'local_moodq'),
        new moodle_url('/local/moodq/index.php'),
        navigation_node::TYPE_CUSTOM,
        null,
        'local_moodq',
        new pix_icon('i/search', '')
    );
    $node->showinflatnavigation = true;
    $navigation->add_node($node);
}

/**
 * HTML à injecter (CSS + JS de la bulle) — factorisé ici pour être
 * appelé par plusieurs noms de callback possibles ci-dessous. Les noms
 * exacts des callbacks d'injection sitewide varient selon les versions
 * Moodle (avant/après la nouvelle Hooks API de 4.4+) ; on couvre donc
 * plusieurs noms connus en parallèle — sans risque, Moodle ignore
 * silencieusement ceux qu'il ne reconnaît pas.
 */
function local_moodq_bubble_html(): string {
    global $PAGE, $CFG, $USER;

    if (!isloggedin() || isguestuser()) {
        return '';
    }
    if (!has_capability('local/moodq:use', context_system::instance())) {
        return '';
    }
    if (!get_config('local_moodq', 'enable_bubble')) {
        return '';
    }
    if (strpos($PAGE->url->out_as_local_url(false), '/local/moodq/') === 0) {
        return '';
    }

    $config = [
        'wwwroot' => $CFG->wwwroot,
        'sesskey' => sesskey(),
        'lang' => current_language(),
        'userFirstName' => $USER->firstname ?? '',
    ];

    $configJson = json_encode($config, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_QUOT);
    $cssUrl = new moodle_url('/local/moodq/styles.css');
    $jsUrl = new moodle_url('/local/moodq/js/bubble.js');

    return <<<HTML
<link rel="stylesheet" href="{$cssUrl}">
<script>window.MOODQ_BUBBLE_CONFIG = {$configJson};</script>
<script src="{$jsUrl}" defer></script>
HTML;
}

function local_moodq_before_standard_head_html_generation() {
    return local_moodq_bubble_html();
}

function local_moodq_before_footer_html_generation() {
    return local_moodq_bubble_html();
}

function local_moodq_standard_footer_html() {
    return local_moodq_bubble_html();
}

function local_moodq_before_footer() {
    echo local_moodq_bubble_html();
}
