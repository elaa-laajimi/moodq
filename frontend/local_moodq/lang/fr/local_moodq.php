<?php
defined('MOODLE_INTERNAL') || die();

$string['pluginname'] = 'MoodQ';
$string['moodq:use'] = 'Utiliser la recherche IA MoodQ';

$string['geminiapikey'] = 'Clé API Gemini';
$string['geminiapikey_desc'] = 'Votre clé API Gemini (Google AI Studio), utilisée pour traduire les questions en langage naturel en SQL.';
$string['geminimodel'] = 'Modèle Gemini';
$string['geminimodel_desc'] = 'L\'identifiant du modèle Gemini à appeler (ex. gemini-3.5-flash-lite).';
$string['enablebubble'] = 'Activer la bulle de chat';
$string['enablebubble_desc'] = 'Afficher la bulle de recherche IA MoodQ sur toutes les pages Moodle, pour les utilisateurs disposant de la capacité local/moodq:use.';

$string['apikeymissing'] = 'MoodQ n\'est pas encore configuré : aucune clé API Gemini définie (Administration du site > Plugins > Plugins locaux > MoodQ).';
$string['questionrequired'] = 'Le champ question est requis.';
$string['questiontoolong'] = 'Question trop longue (300 caractères max).';
$string['rejected'] = 'Requête refusée : {$a}';
$string['internalerror'] = 'Une erreur interne est survenue. Merci de réessayer.';
