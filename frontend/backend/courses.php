<?php
/**
 * courses.php
 * -----------------------------------------------------------
 * GET /courses.php            → liste des cours + stats résumées
 * GET /courses.php?id=CS101   → détail complet d'un cours
 *
 * Utilisé par les vues "Courses" et "AI Analytics" du frontend.
 * -----------------------------------------------------------
 */
require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/lib.php';
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    respond(405, ['error' => 'Méthode non autorisée. Utilisez GET.']);
}
require_login();
try {
    $pdo = moodq_pdo();
    $courses = fetch_all_courses($pdo);
    $shortname = $_GET['id'] ?? null;
    if ($shortname) {
        $match = array_values(array_filter($courses, fn($c) => $c['id'] === $shortname));
        if (empty($match)) {
            respond(404, ['error' => "Cours '{$shortname}' introuvable."]);
        }
        respond(200, $match[0]);
    }
    respond(200, ['courses' => $courses]);
} catch (Throwable $e) {
    error_log('[MoodQ courses.php] ' . $e->getMessage());
    respond(500, ['error' => 'Une erreur interne est survenue.']);
}