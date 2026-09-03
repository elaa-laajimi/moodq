<?php
defined('MOODLE_INTERNAL') || die();

$string['pluginname'] = 'MoodQ';
$string['moodq:use'] = 'Use MoodQ AI search';

$string['geminiapikey'] = 'Gemini API key';
$string['geminiapikey_desc'] = 'Your Google AI Studio Gemini API key, used to translate natural-language questions into SQL.';
$string['geminimodel'] = 'Gemini model';
$string['geminimodel_desc'] = 'The Gemini model identifier to call (e.g. gemini-3.5-flash-lite).';
$string['enablebubble'] = 'Enable chat bubble';
$string['enablebubble_desc'] = 'Show the MoodQ AI search bubble on every Moodle page for users with the local/moodq:use capability.';

$string['apikeymissing'] = 'MoodQ is not configured yet: no Gemini API key set (Site administration > Plugins > Local plugins > MoodQ).';
$string['questionrequired'] = 'The question field is required.';
$string['questiontoolong'] = 'Question too long (300 characters max).';
$string['rejected'] = 'Query rejected: {$a}';
$string['internalerror'] = 'An internal error occurred. Please try again.';
