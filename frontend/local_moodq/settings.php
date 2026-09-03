<?php
/**
 * settings.php
 * -----------------------------------------------------------
 * Apparaît automatiquement dans Site administration > Plugins >
 * Local plugins > MoodQ — Moodle liste tout plugin ayant ce fichier
 * sans configuration supplémentaire.
 * -----------------------------------------------------------
 */

defined('MOODLE_INTERNAL') || die();

if ($hassiteconfig) {
    $settings = new admin_settingpage('local_moodq', get_string('pluginname', 'local_moodq'));
    $ADMIN->add('localplugins', $settings);

    $settings->add(new admin_setting_configpasswordunmask(
        'local_moodq/gemini_api_key',
        get_string('geminiapikey', 'local_moodq'),
        get_string('geminiapikey_desc', 'local_moodq'),
        ''
    ));

    $settings->add(new admin_setting_configtext(
        'local_moodq/gemini_model',
        get_string('geminimodel', 'local_moodq'),
        get_string('geminimodel_desc', 'local_moodq'),
        'gemini-3.5-flash-lite',
        PARAM_TEXT
    ));

    $settings->add(new admin_setting_configcheckbox(
        'local_moodq/enable_bubble',
        get_string('enablebubble', 'local_moodq'),
        get_string('enablebubble_desc', 'local_moodq'),
        1
    ));
}
