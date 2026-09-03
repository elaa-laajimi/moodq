<?php
/**
 * students.php
 * -----------------------------------------------------------
 * GET /students.php?course=CS101
 *     → liste des étudiants inscrits à ce cours (progression, statut, moyenne)
 *
 * GET /students.php?course=CS101&sort=fastest
 *     → même liste, triée. Valeurs possibles pour "sort" :
 *       alpha | first-finished | fastest | best-grade | progress-desc
 *
 * GET /students.php?course=CS101&student=3
 *     → détail complet d'un étudiant dans ce cours (examens, exercices)
 * -----------------------------------------------------------
 */

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/lib.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    respond(405, ['error' => 'Méthode non autorisée. Utilisez GET.']);
}

require_login();

$courseShortname = $_GET['course'] ?? null;
if (!$courseShortname) {
    respond(400, ['error' => "Le paramètre 'course' est requis (ex: ?course=CS101)."]);
}

try {
    $pdo = moodq_pdo();

    $courseId = get_course_id_from_shortname($pdo, $courseShortname);
    if (!$courseId) {
        respond(404, ['error' => "Cours '{$courseShortname}' introuvable."]);
    }

    if (isset($_GET['student'])) {
        $detail = fetch_student_detail($pdo, $courseId, (int) $_GET['student']);
        if (!$detail) {
            respond(404, ['error' => "Étudiant introuvable dans ce cours."]);
        }
        respond(200, $detail);
    }

    $sort = $_GET['sort'] ?? 'alpha';
    respond(200, ['students' => fetch_enrolled_students($pdo, $courseId, $sort)]);
} catch (Throwable $e) {
    error_log('[MoodQ students.php] ' . $e->getMessage());
    respond(500, ['error' => 'Une erreur interne est survenue.']);
}