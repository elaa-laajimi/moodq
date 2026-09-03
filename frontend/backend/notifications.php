<?php
/**
 * notifications.php
 * -----------------------------------------------------------
 * GET  /notifications.php
 *      Détecte les nouveaux événements Moodle (inscriptions,
 *      cours terminés) depuis le dernier appel, les enregistre,
 *      puis retourne l'historique complet + le nombre non lu.
 *
 * POST /notifications.php  Body:
 *      { "action": "create", "type": "report"|"enrollment"|"activity",
 *        "title": "...", "message": "..." }
 *          -> crée une notification manuelle (ex: rapport téléchargé).
 *      { "action": "mark_read", "id": 12 }
 *          -> marque une notification comme lue.
 *      { "action": "mark_all_read" }
 *          -> marque toutes les notifications comme lues.
 * -----------------------------------------------------------
 */
require_once __DIR__ . '/bootstrap.php';

require_login();

$pdo = moodq_pdo();
ensure_notifications_table($pdo);

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    detect_moodle_notifications($pdo);

    $notifications = $pdo->query("
        SELECT id, type, title, message, is_read, created_at
        FROM moodq_notifications
        ORDER BY created_at DESC, id DESC
        LIMIT 30
    ")->fetchAll();

    $unreadCount = (int) $pdo->query("SELECT COUNT(*) FROM moodq_notifications WHERE is_read = 0")->fetchColumn();

    respond(200, [
        'notifications' => $notifications,
        'unread_count' => $unreadCount,
    ]);
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = read_json_body();
    $action = (string) ($body['action'] ?? '');

    if ($action === 'create') {
        $allowedTypes = ['enrollment', 'report', 'activity'];
        $type = (string) ($body['type'] ?? 'report');
        if (!in_array($type, $allowedTypes, true)) {
            $type = 'report';
        }

        $title = trim((string) ($body['title'] ?? ''));
        $message = trim((string) ($body['message'] ?? ''));
        if ($title === '' || $message === '') {
            respond(400, ['error' => 'title et message sont requis.']);
        }

        $stmt = $pdo->prepare("
            INSERT INTO moodq_notifications (type, title, message)
            VALUES (:type, :title, :message)
        ");
        $stmt->execute([':type' => $type, ':title' => $title, ':message' => $message]);

        $newId = (int) $pdo->lastInsertId();
        $created = $pdo->prepare("SELECT id, type, title, message, is_read, created_at FROM moodq_notifications WHERE id = :id");
        $created->execute([':id' => $newId]);

        respond(201, ['notification' => $created->fetch()]);
    }

    if ($action === 'mark_read') {
        $id = (int) ($body['id'] ?? 0);
        if ($id <= 0) {
            respond(400, ['error' => 'id requis.']);
        }
        $stmt = $pdo->prepare("UPDATE moodq_notifications SET is_read = 1 WHERE id = :id");
        $stmt->execute([':id' => $id]);
        respond(200, ['ok' => true]);
    }

    if ($action === 'mark_all_read') {
        $pdo->exec("UPDATE moodq_notifications SET is_read = 1 WHERE is_read = 0");
        respond(200, ['ok' => true]);
    }

    respond(400, ['error' => 'Action inconnue.']);
}

respond(405, ['error' => 'Méthode non autorisée.']);

/* ---------------------------------------------------------
   Table (auto-créée au premier appel, comme moodq_exercises)
   --------------------------------------------------------- */
function ensure_notifications_table(PDO $pdo): void
{
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS moodq_notifications (
            id INT AUTO_INCREMENT PRIMARY KEY,
            type VARCHAR(30) NOT NULL,
            title VARCHAR(150) NOT NULL,
            message VARCHAR(500) NOT NULL,
            ref_key VARCHAR(100) DEFAULT NULL,
            is_read TINYINT(1) NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_ref_key (ref_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
}

/* ---------------------------------------------------------
   Détection des vrais événements Moodle
   -----------------------------------------------------------
   ref_key évite les doublons : chaque inscription / complétion
   Moodle ne génère qu'UNE seule notification, quel que soit le
   nombre de fois où cette fonction tourne (INSERT IGNORE +
   contrainte UNIQUE sur ref_key). Pas besoin de suivre un
   "dernier timestamp vérifié" séparément.

   Trois sources sont surveillées :
   - mdl_user_enrolments      -> nouvelle inscription à un cours
   - mdl_course_completions   -> cours terminé (complétion globale)
   - mdl_course_modules_completion -> activité terminée (quiz, etc.)
   --------------------------------------------------------- */
function detect_moodle_notifications(PDO $pdo): void
{
    $insertStmt = $pdo->prepare("
        INSERT IGNORE INTO moodq_notifications (type, title, message, ref_key)
        VALUES (:type, :title, :message, :ref_key)
    ");

    // Nouvelles inscriptions à un cours (mdl_user_enrolments).
    $enrolments = $pdo->query("
        SELECT ue.id AS ref_id, u.firstname, u.lastname, c.fullname AS course_name
        FROM mdl_user_enrolments ue
        JOIN mdl_enrol e ON e.id = ue.enrolid
        JOIN mdl_course c ON c.id = e.courseid
        JOIN mdl_user u ON u.id = ue.userid
        ORDER BY ue.id DESC
        LIMIT 50
    ")->fetchAll();

    foreach ($enrolments as $row) {
        $insertStmt->execute([
            ':type' => 'enrollment',
            ':title' => 'Nouvel élève inscrit',
            ':message' => trim($row['firstname'] . ' ' . $row['lastname']) . ' a rejoint ' . $row['course_name'] . '.',
            ':ref_key' => 'enrollment:' . $row['ref_id'],
        ]);
    }

    // Cours terminés (mdl_course_completions — complétion au niveau
    // du cours entier).
    $completions = $pdo->query("
        SELECT cc.id AS ref_id, u.firstname, u.lastname, c.fullname AS course_name
        FROM mdl_course_completions cc
        JOIN mdl_user u ON u.id = cc.userid
        JOIN mdl_course c ON c.id = cc.course
        WHERE cc.timecompleted IS NOT NULL
        ORDER BY cc.id DESC
        LIMIT 50
    ")->fetchAll();

    foreach ($completions as $row) {
        $insertStmt->execute([
            ':type' => 'activity',
            ':title' => 'Cours terminé',
            ':message' => trim($row['firstname'] . ' ' . $row['lastname']) . ' a terminé ' . $row['course_name'] . '.',
            ':ref_key' => 'activity:' . $row['ref_id'],
        ]);
    }

    // Activités terminées (mdl_course_modules_completion — complétion
    // par activité individuelle : quiz, devoir, forum...). Le nom de
    // l'activité n'est résolu que pour les quiz (seule table d'activité
    // présente dans MOODQ_SCHEMA) ; les autres types affichent un
    // libellé générique plutôt que d'exposer une table hors whitelist.
    $activityCompletions = $pdo->query("
        SELECT cmc.id AS ref_id, u.firstname, u.lastname, c.fullname AS course_name,
               m.name AS module_type, q.name AS quiz_name
        FROM mdl_course_modules_completion cmc
        JOIN mdl_course_modules cm ON cm.id = cmc.coursemoduleid
        JOIN mdl_modules m ON m.id = cm.module
        JOIN mdl_course c ON c.id = cm.course
        JOIN mdl_user u ON u.id = cmc.userid
        LEFT JOIN mdl_quiz q ON m.name = 'quiz' AND q.id = cm.instance
        WHERE cmc.completionstate IN (1, 2)
        ORDER BY cmc.id DESC
        LIMIT 50
    ")->fetchAll();

    foreach ($activityCompletions as $row) {
        $activityLabel = $row['quiz_name'] ?? 'une activité';
        $insertStmt->execute([
            ':type' => 'activity',
            ':title' => 'Activité terminée',
            ':message' => trim($row['firstname'] . ' ' . $row['lastname']) . ' a terminé ' . $activityLabel . ' dans ' . $row['course_name'] . '.',
            ':ref_key' => 'modcomplete:' . $row['ref_id'],
        ]);
    }
}