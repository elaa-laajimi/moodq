<?php
/**
 * me.php
 * -----------------------------------------------------------
 * GET /me.php — retourne l'utilisateur actuellement connecté
 * (session PHP), ou 401 si personne n'est connecté.
 * -----------------------------------------------------------
 */
require_once __DIR__ . '/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    respond(405, ['error' => 'Méthode non autorisée. Utilisez GET.']);
}

$user = current_user();
if ($user === null) {
    respond(401, ['error' => 'Non authentifié.']);
}

respond(200, ['user' => $user]);