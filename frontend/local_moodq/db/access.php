<?php
/**
 * db/access.php
 * -----------------------------------------------------------
 * Déclare la capacité local/moodq:use, accordée par défaut aux
 * rôles étudiant/enseignant/manager — pas aux invités.
 * -----------------------------------------------------------
 */

defined('MOODLE_INTERNAL') || die();

$capabilities = [
    'local/moodq:use' => [
        'captype' => 'read',
        'contextlevel' => CONTEXT_SYSTEM,
        'archetypes' => [
            'user' => CAP_ALLOW,
            'student' => CAP_ALLOW,
            'teacher' => CAP_ALLOW,
            'editingteacher' => CAP_ALLOW,
            'manager' => CAP_ALLOW,
        ],
    ],
];
