<?php
/**
 * config.php
 * -----------------------------------------------------------
 * Connexion à la base Moodle réelle (Docker) — bitnami_moodle.
 * Contient le vrai schéma Moodle 4.5 + la table custom
 * moodq_exercises créée manuellement pour MoodQ.
 * -----------------------------------------------------------
 */

// ---- Connexion MySQL (Moodle en Docker) ----
define('DB_HOST', '127.0.0.1');
define('DB_PORT', '3307');
define('DB_NAME', 'bitnami_moodle');
define('DB_USER', 'bn_moodle');
define('DB_PASS', 'MyS1r0nGP@ss123!');

// ---- Clé API pour l'IA (Gemini — Google AI Studio) — voir env.php (à créer, voir env.example.php) ----
if (file_exists(__DIR__ . '/env.php')) {
    require_once __DIR__ . '/env.php';
}
if (!defined('MOODQ_AI_API_KEY')) {
    define('MOODQ_AI_API_KEY', '');
}
define('MOODQ_AI_API_KEY_PLACEHOLDER', 'YOUR_GEMINI_API_KEY_HERE');

define('AI_API_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta/models');
define('AI_MODEL', 'gemini-3.5-flash-lite');

/**
 * ---- Schéma "Schema-Only" exposé à l'IA ----
 * Conformément à l'énoncé du projet (Privacy by Design / Loi 25) :
 * on n'envoie JAMAIS de données réelles à l'IA, uniquement la
 * structure (noms de tables + colonnes) nécessaire pour qu'elle
 * traduise la question en SQL.
 *
 * Cette liste sert aussi de WHITELIST de sécurité : toute requête
 * générée par l'IA qui référence une table absente d'ici sera
 * rejetée par validate_sql() dans ai-search.php.
 *
 * Noms de tables vérifiés contre le vrai schéma Moodle 4.5
 * (docker exec moodle-mariadb ... SHOW TABLES LIKE 'mdl_%').
 */
define('MOODQ_SCHEMA', [
    'mdl_course' => ['id', 'fullname', 'shortname', 'category', 'startdate', 'enddate', 'visible'],
    'mdl_user' => ['id', 'firstname', 'lastname', 'username', 'email'],
    'mdl_enrol' => ['id', 'courseid', 'enrol', 'status'],
    'mdl_user_enrolments' => ['id', 'userid', 'enrolid', 'timestart', 'timeend', 'progress'],
    'mdl_grade_items' => ['id', 'courseid', 'itemname', 'itemtype', 'grademax'],
    'mdl_grade_grades' => ['id', 'itemid', 'userid', 'rawgrade', 'finalgrade', 'timemodified'],
    'mdl_course_completions' => ['id', 'userid', 'course', 'timecompleted'],
    'mdl_course_modules_completion' => ['id', 'coursemoduleid', 'userid', 'completionstate', 'timemodified'],
    'mdl_course_modules' => ['id', 'course', 'module', 'instance'],
    'mdl_modules' => ['id', 'name'],
    'mdl_quiz' => ['id', 'course', 'name'],
    'mdl_quiz_grades' => ['id', 'quiz', 'userid', 'grade', 'timemodified'],
    'mdl_logstore_standard_log' => ['id', 'userid', 'courseid', 'action', 'timecreated'],
    'moodq_exercises' => ['id', 'courseid', 'userid', 'name', 'status'],
]);

/**
 * ---- Colonnes interdites même sur les tables autorisées ----
 * Ex: mdl_user.password ne doit jamais apparaître dans une requête
 * générée par l'IA (elle n'existe même pas dans notre whitelist,
 * mais on double-vérifie ici par sécurité).
 *
 * Cette liste va au-delà des colonnes actuellement présentes dans
 * MOODQ_SCHEMA : elle sert de filet de sécurité si le schéma exposé
 * à l'IA venait à être élargi plus tard (ex: ajout de mdl_user.phone1
 * pour un futur rapport), afin qu'un oubli de whitelist ne suffise
 * pas à exposer une donnée personnelle.
 */
define('SENSITIVE_COLUMNS', [
    // Identité / authentification — jamais exposées, quel que soit
    // le demandeur : ces colonnes ne doivent JAMAIS apparaître dans
    // une requête générée dynamiquement, même vers un utilisateur
    // authentifié.
    'password', 'secret', 'token', 'auth', 'lastip',
    // Coordonnées personnelles — email retiré : ce n'est pas une donnée
    // sensible vis-à-vis de Gemini (qui ne voit que le nom de colonne,
    // jamais les vraies valeurs) et MoodQ l'affiche déjà normalement
    // dans la vue Étudiants. Les autres champs restent bloqués tant
    // qu'ils ne sont pas explicitement ajoutés à MOODQ_SCHEMA.
    'phone1', 'phone2', 'address', 'city', 'country',
    // Identifiants administratifs / institutionnels
    'idnumber', 'institution', 'department',
]);

/**
 * ---- Mots-clés SQL strictement interdits ----
 * Seul le SELECT est autorisé.
 */
define('FORBIDDEN_SQL_KEYWORDS', [
    'UPDATE', 'DELETE', 'DROP', 'INSERT', 'ALTER', 'TRUNCATE',
    'CREATE', 'REPLACE', 'GRANT', 'REVOKE', 'EXEC', 'EXECUTE',
    'CALL', 'MERGE', 'ATTACH', 'DETACH', 'PRAGMA', '--', '/*', ';--'
]);

/**
 * Connexion PDO à la base MoodQ 
 */
function moodq_pdo(): PDO
{
    $dsn = 'mysql:host=' . DB_HOST . ';port=' . DB_PORT . ';dbname=' . DB_NAME . ';charset=utf8mb4';

    try {
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
    } catch (PDOException $e) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode([
            'error' => "Connexion à la base MySQL (Moodle Docker) impossible. Vérifie que le conteneur " .
                       "moodle-mariadb tourne (docker ps -a) et que le port 3307 est bien exposé. " .
                       "Détail : " . $e->getMessage()
        ]);
        exit;
    }

    return $pdo;
}