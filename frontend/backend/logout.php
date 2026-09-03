<?php
/**
 * logout.php
 * -----------------------------------------------------------
 * POST /logout.php — détruit la session MoodQ en cours.
 * -----------------------------------------------------------
 */
require_once __DIR__ . '/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(405, ['error' => 'Méthode non autorisée. Utilisez POST.']);
}

$_SESSION = [];
session_destroy();

respond(200, ['message' => 'Déconnecté avec succès.']);