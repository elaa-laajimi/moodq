<?php
/**
 * lib.php
 * -----------------------------------------------------------
 * Fonctions de lecture partagées entre courses.php, students.php
 * et reports.php — pour éviter de dupliquer les requêtes SQL.
 * -----------------------------------------------------------
 */

/**
 * ---------------------------------------------------------
 * I18N — partagé par tous les endpoints backend (ai-search.php,
 * reports.php, courses.php, students.php...). Réutilise les
 * mêmes fichiers lang/*.json que le frontend comme source
 * unique de vérité.
 * ---------------------------------------------------------
 */
const MOODQ_SUPPORTED_LANGS = ['fr', 'en', 'de', 'es', 'pt', 'ko', 'ar', 'zh', 'hi', 'ru'];
const MOODQ_LANG_NAMES = [
    'fr' => 'French', 'en' => 'English', 'de' => 'German',
    'es' => 'Spanish', 'pt' => 'Portuguese', 'ko' => 'Korean',
    'ar' => 'Arabic', 'zh' => 'Simplified Chinese', 'hi' => 'Hindi', 'ru' => 'Russian',
];

/**
 * Charge (et met en cache pour la requête courante) le dictionnaire de
 * traduction correspondant, à partir des fichiers lang/*.json utilisés
 * par le frontend. lib.php vit dans backend/, lang/ est à la racine
 * de frontend/, d'où le "../lang/".
 */
function moodq_lang_dict(string $lang): array
{
    static $cache = [];
    if (isset($cache[$lang])) {
        return $cache[$lang];
    }
    $path = __DIR__ . "/../lang/{$lang}.json";
    $dict = is_file($path) ? (json_decode(file_get_contents($path), true) ?: []) : [];
    return $cache[$lang] = $dict;
}

/**
 * Traduction simple (sans variables).
 */
function moodq_t(string $key, string $lang, string $fallback = ''): string
{
    $dict = moodq_lang_dict($lang);
    if (isset($dict[$key])) {
        return $dict[$key];
    }
    $frDict = moodq_lang_dict('fr');
    return $frDict[$key] ?? $fallback;
}

/**
 * Traduction avec substitution de variables : {nom} dans la chaîne
 * traduite est remplacé par $vars['nom']. Utilisé pour les phrases
 * générées par reports.php (alertes, recommandations...) qui
 * combinent texte traduit et données dynamiques (noms, pourcentages).
 */
function moodq_t_vars(string $key, string $lang, array $vars, string $fallback = ''): string
{
    $template = moodq_t($key, $lang, $fallback);
    $replacements = [];
    foreach ($vars as $name => $value) {
        $replacements['{' . $name . '}'] = $value;
    }
    return strtr($template, $replacements);
}

/**
 * Résout et valide la langue à partir d'une valeur brute quelconque
 * (query string, corps JSON...). Retombe sur 'fr' si absente/invalide.
 */
function moodq_resolve_lang(?string $raw): string
{
    return in_array($raw, MOODQ_SUPPORTED_LANGS, true) ? $raw : 'fr';
}

/**
 * Calcule les statistiques de chaque cours à partir des tables Moodle.
 */
function fetch_all_courses(PDO $pdo): array
{
    $courseRows = $pdo->query("SELECT id, fullname, shortname, category FROM mdl_course ORDER BY id")->fetchAll();
    $result = [];

    foreach ($courseRows as $course) {
        $courseId = (int) $course['id'];

        $enrols = (int) $pdo->query("
            SELECT COUNT(*) FROM mdl_user_enrolments ue
            JOIN mdl_enrol e ON e.id = ue.enrolid
            WHERE e.courseid = {$courseId}
        ")->fetchColumn();

        $avgGrade = (float) $pdo->query("
            SELECT AVG(gg.finalgrade) FROM mdl_grade_grades gg
            JOIN mdl_grade_items gi ON gi.id = gg.itemid
            WHERE gi.courseid = {$courseId} AND gi.itemtype = 'course'
        ")->fetchColumn();

        $completedCount = (int) $pdo->query("
            SELECT COUNT(*) FROM mdl_course_completions WHERE course = {$courseId} AND timecompleted IS NOT NULL
        ")->fetchColumn();
        $completion = $enrols > 0 ? round(($completedCount / $enrols) * 100) : 0;

        $avgCompletionDays = $pdo->query("
            SELECT AVG((cc.timecompleted - ue.timestart) / 86400.0)
            FROM mdl_course_completions cc
            JOIN mdl_enrol e ON e.courseid = cc.course
            JOIN mdl_user_enrolments ue ON ue.enrolid = e.id AND ue.userid = cc.userid
            WHERE cc.course = {$courseId} AND cc.timecompleted IS NOT NULL
        ")->fetchColumn();
        $avgCompletionDays = $avgCompletionDays ? (int) round((float) $avgCompletionDays) : null;

        // Taux d'abandon (heuristique pour la démo : inscrits non terminés,
        // considérés comme probablement décrocheurs). À affiner avec de
        // vraies données Moodle plus tard.
        $strugglingCount = (int) $pdo->query("
            SELECT COUNT(*) FROM mdl_user_enrolments ue
            JOIN mdl_enrol e ON e.id = ue.enrolid
            LEFT JOIN mdl_course_completions cc ON cc.userid = ue.userid AND cc.course = {$courseId}
            WHERE e.courseid = {$courseId} AND cc.id IS NULL
        ")->fetchColumn();
        $dropoutRate = $enrols > 0 ? round(($strugglingCount / $enrols) * 100) : 0;

        // Score moyen aux quiz, normalisé en pourcentage (0-100) quel que
        // soit le barème réel configuré sur chaque quiz (ex: /10, /20...).
        $avgQuizScore = $pdo->query("
            SELECT AVG(100.0 * qg.grade / q.grade) FROM mdl_quiz_grades qg
            JOIN mdl_quiz q ON q.id = qg.quiz
            WHERE q.course = {$courseId} AND q.grade > 0
        ")->fetchColumn();
        $avgQuizScore = $avgQuizScore ? round((float) $avgQuizScore, 1) : 0;

        $activityEvents = (int) $pdo->query("
            SELECT COUNT(*) FROM mdl_logstore_standard_log WHERE courseid = {$courseId}
        ")->fetchColumn();

        $effectivenessCode = 'low';
        if ($completion >= 80 && $avgQuizScore >= 75) $effectivenessCode = 'high';
        elseif ($completion >= 55 && $avgQuizScore >= 60) $effectivenessCode = 'medium';
        // Valeur française conservée pour compatibilité avec le code existant
        // (courses.php...) qui affiche déjà ce champ tel quel.
        $effectiveness = ['low' => 'Faible', 'medium' => 'Moyenne', 'high' => 'Élevée'][$effectivenessCode];

        $result[] = [
            'id' => $course['shortname'],
            'name' => $course['fullname'],
            'category' => $course['category'],
            'enrols' => $enrols,
            'avgGrade' => round($avgGrade, 1),
            'completion' => $completion,
            'completedCount' => $completedCount,
            'avgCompletionDays' => $avgCompletionDays,
            'dropoutRate' => $dropoutRate,
            'avgQuizScore' => $avgQuizScore,
            'activityEvents' => $activityEvents,
            'effectiveness' => $effectiveness,           // conservé (français) pour compatibilité
            'effectivenessCode' => $effectivenessCode,    // 'low' | 'medium' | 'high' — utilisable pour traduire
        ];
    }

    return $result;
}

function get_course_id_from_shortname(PDO $pdo, string $shortname): ?int
{
    $stmt = $pdo->prepare("SELECT id FROM mdl_course WHERE shortname = :shortname");
    $stmt->execute([':shortname' => $shortname]);
    $id = $stmt->fetchColumn();
    return $id !== false ? (int) $id : null;
}

function fetch_enrolled_students(PDO $pdo, int $courseId, string $sort = 'alpha'): array
{
    $orderBy = match ($sort) {
        'first-finished' => 'cc.timecompleted IS NULL, cc.timecompleted ASC',
        'fastest'        => '(cc.timecompleted - ue.timestart) IS NULL, (cc.timecompleted - ue.timestart) ASC',
        'best-grade'     => 'gg.finalgrade DESC',
        'progress-desc'  => 'cc.timecompleted IS NOT NULL DESC, gg.finalgrade DESC',
        default          => 'u.lastname ASC, u.firstname ASC',
    };

    // MySQL/MariaDB : CONCAT() remplace l'opérateur || (SQLite) pour
    // concaténer des chaînes. En MySQL, || est un OU logique et non
    // une concaténation — d'où le bug "name": "0" observé avant ce fix.
    $stmt = $pdo->prepare("
        SELECT
            u.id AS studentId,
            CONCAT(u.firstname, ' ', u.lastname) AS name,
            u.email,
            CASE WHEN cc.timecompleted IS NOT NULL THEN 100 ELSE COALESCE(gg.finalgrade, 0) END AS progress,
            gg.finalgrade AS avgGrade,
            cc.timecompleted,
            ue.timestart
        FROM mdl_user_enrolments ue
        JOIN mdl_enrol e ON e.id = ue.enrolid
        JOIN mdl_user u ON u.id = ue.userid
        LEFT JOIN mdl_grade_grades gg ON gg.userid = u.id
            AND gg.itemid = (SELECT id FROM mdl_grade_items WHERE courseid = :courseId AND itemtype = 'course')
        LEFT JOIN mdl_course_completions cc ON cc.userid = u.id AND cc.course = :courseId2
        WHERE e.courseid = :courseId3
        ORDER BY {$orderBy}
    ");
    $stmt->execute([':courseId' => $courseId, ':courseId2' => $courseId, ':courseId3' => $courseId]);
    $rows = $stmt->fetchAll();

    return array_map(function ($row, $i) {
        $completed = $row['timecompleted'] !== null;
        $daysToComplete = $completed ? (int) round(($row['timecompleted'] - $row['timestart']) / 86400) : null;

        return [
            'rank' => $i + 1,
            'studentId' => (int) $row['studentId'],
            'name' => $row['name'],
            'email' => $row['email'],
            'progress' => (int) $row['progress'],
            'avgGrade' => round((float) $row['avgGrade'], 1),
            'completed' => $completed,
            'daysToComplete' => $daysToComplete,
        ];
    }, $rows, array_keys($rows));
}

function fetch_student_detail(PDO $pdo, int $courseId, int $studentId): ?array
{
    // MySQL/MariaDB : CONCAT() au lieu de || (voir commentaire ci-dessus).
    $stmt = $pdo->prepare("
        SELECT CONCAT(u.firstname, ' ', u.lastname) AS name, u.email,
               CASE WHEN cc.timecompleted IS NOT NULL THEN 100 ELSE COALESCE(gg.finalgrade, 0) END AS progress,
               gg.finalgrade AS avgGrade, cc.timecompleted, ue.timestart
        FROM mdl_user_enrolments ue
        JOIN mdl_enrol e ON e.id = ue.enrolid
        JOIN mdl_user u ON u.id = ue.userid
        LEFT JOIN mdl_grade_grades gg ON gg.userid = u.id
            AND gg.itemid = (SELECT id FROM mdl_grade_items WHERE courseid = :courseId AND itemtype = 'course')
        LEFT JOIN mdl_course_completions cc ON cc.userid = u.id AND cc.course = :courseId2
        WHERE e.courseid = :courseId3 AND u.id = :studentId
    ");
    $stmt->execute([':courseId' => $courseId, ':courseId2' => $courseId, ':courseId3' => $courseId, ':studentId' => $studentId]);
    $student = $stmt->fetch();
    if (!$student) return null;

    $examsStmt = $pdo->prepare("
        SELECT qg.grade, qg.timemodified FROM mdl_quiz_grades qg
        JOIN mdl_quiz q ON q.id = qg.quiz
        WHERE q.course = :courseId AND qg.userid = :studentId
        ORDER BY qg.timemodified ASC
    ");
    $examsStmt->execute([':courseId' => $courseId, ':studentId' => $studentId]);
    $examRows = $examsStmt->fetchAll();
    $exams = array_map(fn($e, $i) => ['name' => "Évaluation " . ($i + 1), 'score' => round((float) $e['grade'])], $examRows, array_keys($examRows));

    $exercisesStmt = $pdo->prepare("SELECT name, status FROM moodq_exercises WHERE courseid = :courseId AND userid = :studentId");
    $exercisesStmt->execute([':courseId' => $courseId, ':studentId' => $studentId]);
    $exercises = $exercisesStmt->fetchAll();

    $completed = $student['timecompleted'] !== null;

    return [
        'name' => $student['name'],
        'email' => $student['email'],
        'progress' => (int) $student['progress'],
        'avgGrade' => round((float) $student['avgGrade'], 1),
        'completed' => $completed,
        'daysToComplete' => $completed ? (int) round(($student['timecompleted'] - $student['timestart']) / 86400) : null,
        'exams' => $exams,
        'exercises' => $exercises,
    ];
}

/**
 * Top étudiant d'un cours (utilisé par reports.php).
 */
function fetch_top_student(PDO $pdo, int $courseId): ?array
{
    $students = fetch_enrolled_students($pdo, $courseId, 'best-grade');
    return $students[0] ?? null;
}

/**
 * ---------------------------------------------------------
 * AIDE À LA DÉCISION — fonctions utilisées par reports.php
 * pour transformer les chiffres bruts en signaux actionnables.
 * ---------------------------------------------------------
 */

// Seuils utilisés pour qualifier un étudiant "à risque" ou déclencher
// une alerte. Centralisés ici pour être faciles à ajuster.
const RISK_GRADE_THRESHOLD = 60;      // moyenne en dessous de laquelle on considère l'étudiant en difficulté
const RISK_ACTIVITY_RATIO = 0.5;      // activité < 50% de la moyenne du cours = signal de désengagement
const ALERT_DROPOUT_CRITICAL = 30;    // taux d'abandon (%) déclenchant une alerte critique
const ALERT_DROPOUT_WARNING = 20;     // taux d'abandon (%) déclenchant une alerte de surveillance
const ALERT_COMPLETION_WARNING = 50;  // taux de complétion (%) en dessous duquel on alerte
const ALERT_QUIZ_WARNING = 60;        // score moyen aux quiz (%) en dessous duquel on alerte
const ALERT_BOTTLENECK_WARNING = 30;  // % d'étudiants bloqués sur un exercice = "à surveiller"
const ALERT_BOTTLENECK_CRITICAL = 50; // % d'étudiants bloqués sur un exercice = "critique"
const ALERT_BENCHMARK_GAP = 15;       // écart en points vs la moyenne des autres cours jugé significatif

// Seuils de l'analyse de performance (échelle Moodle 0-100%, affichée en /20).
const PERF_PASS_THRESHOLD_PCT = 50;       // seuil de réussite : 50% = 10/20
const PERF_STRUGGLING_THRESHOLD_PCT = 40; // en dessous : étudiant "en difficulté" = 8/20
const PERF_EXCELLENT_THRESHOLD_PCT = 80;  // au-dessus ou égal : étudiant "excellent" = 16/20

/**
 * Convertit une note en pourcentage (0-100, échelle interne de MoodQ)
 * vers l'échelle /20 utilisée dans l'affichage des rapports.
 */
function moodq_pct_to_20(?float $pct): ?float
{
    if ($pct === null) return null;
    return round($pct / 5, 1);
}

function compute_median(array $values): ?float
{
    if (empty($values)) return null;
    sort($values);
    $count = count($values);
    $mid = intdiv($count, 2);
    if ($count % 2 === 0) {
        return round(($values[$mid - 1] + $values[$mid]) / 2, 1);
    }
    return round($values[$mid], 1);
}

/**
 * Nombre d'événements d'activité (vues, soumissions, commentaires,
 * notations) par étudiant dans un cours donné. Sert de proxy
 * d'engagement pour repérer un désengagement précoce.
 */
function fetch_activity_counts_by_student(PDO $pdo, int $courseId): array
{
    $stmt = $pdo->prepare("
        SELECT userid, COUNT(*) AS eventCount
        FROM mdl_logstore_standard_log
        WHERE courseid = :courseId
        GROUP BY userid
    ");
    $stmt->execute([':courseId' => $courseId]);
    $counts = [];
    foreach ($stmt->fetchAll() as $row) {
        $counts[(int) $row['userid']] = (int) $row['eventCount'];
    }
    return $counts;
}

/**
 * Identifie, pour un cours donné, sur quel(s) exercice(s) précis les
 * étudiants bloquent le plus (statut "En cours" ou "Non commencé"
 * dans moodq_exercises). Retourne la liste triée du plus bloquant
 * au moins bloquant.
 */
function fetch_exercise_bottlenecks(PDO $pdo, int $courseId): array
{
    $stmt = $pdo->prepare("
        SELECT
            name,
            COUNT(*) AS total,
            SUM(CASE WHEN status != 'Terminé' THEN 1 ELSE 0 END) AS notDone
        FROM moodq_exercises
        WHERE courseid = :courseId
        GROUP BY name
    ");
    $stmt->execute([':courseId' => $courseId]);

    $bottlenecks = array_map(function ($row) {
        $total = (int) $row['total'];
        $notDone = (int) $row['notDone'];
        return [
            'name' => $row['name'],
            'total' => $total,
            'notDone' => $notDone,
            'stuckPct' => $total > 0 ? round(($notDone / $total) * 100) : 0,
        ];
    }, $stmt->fetchAll());

    usort($bottlenecks, fn($a, $b) => $b['stuckPct'] <=> $a['stuckPct']);
    return $bottlenecks;
}

/**
 * Liste nominative des étudiants à risque d'un cours, avec la ou les
 * raisons (note basse et/ou faible activité relative au cours).
 * L'activité est jugée "faible" par comparaison à la moyenne du
 * cours (proportionnelle), pas à un seuil absolu, pour rester juste
 * quel que soit le niveau d'engagement général du cours.
 */
function compute_at_risk_students(PDO $pdo, int $courseId, string $lang = 'fr'): array
{
    $students = fetch_enrolled_students($pdo, $courseId, 'alpha');
    $activityCounts = fetch_activity_counts_by_student($pdo, $courseId);

    $avgActivity = count($activityCounts) > 0
        ? array_sum($activityCounts) / count($activityCounts)
        : 0;
    $activityFloor = $avgActivity * RISK_ACTIVITY_RATIO;

    $atRisk = [];
    foreach ($students as $student) {
        $reasons = [];

        if ($student['avgGrade'] > 0 && $student['avgGrade'] < RISK_GRADE_THRESHOLD) {
            $reasons[] = moodq_t('atRisk.lowGrade', $lang, 'note basse');
        }

        $activity = $activityCounts[$student['studentId']] ?? 0;
        if ($avgActivity > 0 && $activity < $activityFloor) {
            $reasons[] = moodq_t('atRisk.lowActivity', $lang, 'faible activité');
        }

        if (!empty($reasons)) {
            $atRisk[] = [
                'studentId' => $student['studentId'],
                'name' => $student['name'],
                'avgGrade' => $student['avgGrade'],
                'activityCount' => $activity,
                'reasons' => $reasons,
            ];
        }
    }

    return $atRisk;
}

/**
 * Compare les indicateurs d'un cours à la moyenne de l'ensemble des
 * cours (calculée sur $allCourses, déjà produit par fetch_all_courses).
 * Un chiffre isolé ("30% d'abandon") ne dit rien tant qu'on ne sait
 * pas si c'est normal ou anormal pour la plateforme.
 */
function compute_course_benchmark(array $course, array $allCourses): array
{
    $others = array_values(array_filter($allCourses, fn($c) => $c['id'] !== $course['id']));
    if (empty($others)) {
        return ['available' => false];
    }

    $avg = fn(string $key) => array_sum(array_column($others, $key)) / count($others);

    return [
        'available' => true,
        'avgCompletion' => round($avg('completion'), 1),
        'avgDropoutRate' => round($avg('dropoutRate'), 1),
        'avgQuizScore' => round($avg('avgQuizScore'), 1),
        'completionDelta' => round($course['completion'] - $avg('completion'), 1),
        'dropoutDelta' => round($course['dropoutRate'] - $avg('dropoutRate'), 1),
        'quizDelta' => round($course['avgQuizScore'] - $avg('avgQuizScore'), 1),
    ];
}

/**
 * Génère les alertes à seuils pour un cours : le cœur de "l'aide à la
 * décision" — transforme les chiffres en signaux classés par gravité.
 */
function build_course_alerts(array $course, array $benchmark, array $bottlenecks, string $lang = 'fr'): array
{
    $alerts = [];

    if ($course['dropoutRate'] >= ALERT_DROPOUT_CRITICAL) {
        $alerts[] = ['level' => 'critical', 'message' => moodq_t_vars('alerts.dropoutCritical', $lang, ['rate' => $course['dropoutRate']], "Taux d'abandon critique : {$course['dropoutRate']}% des inscrits n'ont pas terminé le cours.")];
    } elseif ($course['dropoutRate'] >= ALERT_DROPOUT_WARNING) {
        $alerts[] = ['level' => 'warning', 'message' => moodq_t_vars('alerts.dropoutWarning', $lang, ['rate' => $course['dropoutRate']], "Taux d'abandon élevé : {$course['dropoutRate']}% des inscrits n'ont pas terminé le cours.")];
    }

    if ($course['completion'] < ALERT_COMPLETION_WARNING) {
        $alerts[] = ['level' => 'warning', 'message' => moodq_t_vars('alerts.completionWarning', $lang, ['rate' => $course['completion']], "Taux de complétion faible : seulement {$course['completion']}% des inscrits ont terminé le cours.")];
    }

    if ($course['avgQuizScore'] > 0 && $course['avgQuizScore'] < ALERT_QUIZ_WARNING) {
        $alerts[] = ['level' => 'warning', 'message' => moodq_t_vars('alerts.quizWarning', $lang, ['score' => $course['avgQuizScore']], "Score moyen aux quiz faible : {$course['avgQuizScore']}%, signe possible d'un contenu mal assimilé.")];
    }

    if (!empty($bottlenecks) && $bottlenecks[0]['stuckPct'] >= ALERT_BOTTLENECK_WARNING) {
        $worst = $bottlenecks[0];
        $level = $worst['stuckPct'] >= ALERT_BOTTLENECK_CRITICAL ? 'critical' : 'warning';
        $alerts[] = ['level' => $level, 'message' => moodq_t_vars('alerts.bottleneck', $lang, ['pct' => $worst['stuckPct'], 'name' => $worst['name']], "{$worst['stuckPct']}% des étudiants sont bloqués ou n'ont pas commencé « {$worst['name']} ».")];
    }

    if (($benchmark['available'] ?? false) && $benchmark['dropoutDelta'] >= ALERT_BENCHMARK_GAP) {
        $delta = round($benchmark['dropoutDelta']);
        $alerts[] = ['level' => 'warning', 'message' => moodq_t_vars('alerts.benchmarkGap', $lang, ['delta' => $delta], "Ce cours décroche {$delta} points de plus que la moyenne des autres cours.")];
    }

    return $alerts;
}

/**
 * Notes finales de chaque étudiant d'un cours, avec leur nom — base de
 * l'analyse de performance (médiane, distribution, difficulté/excellence).
 */
function fetch_course_grades_with_names(PDO $pdo, int $courseId): array
{
    $stmt = $pdo->prepare("
        SELECT CONCAT(u.firstname, ' ', u.lastname) AS name, gg.finalgrade AS grade
        FROM mdl_grade_grades gg
        JOIN mdl_grade_items gi ON gi.id = gg.itemid
        JOIN mdl_user u ON u.id = gg.userid
        WHERE gi.courseid = :courseId AND gi.itemtype = 'course' AND gg.finalgrade IS NOT NULL
        ORDER BY gg.finalgrade DESC
    ");
    $stmt->execute([':courseId' => $courseId]);
    return $stmt->fetchAll();
}

/**
 * Répond à "est-ce que mes étudiants comprennent le cours ?" : moyenne,
 * médiane, meilleure/plus faible note, taux de réussite, distribution
 * par tranche, et liste nominative des étudiants en difficulté / excellents.
 */
function compute_performance_analysis(PDO $pdo, int $courseId): array
{
    $grades = fetch_course_grades_with_names($pdo, $courseId);
    $values = array_map(fn($g) => (float) $g['grade'], $grades);
    $total = count($values);

    $avg = $total > 0 ? array_sum($values) / $total : 0;
    $median = compute_median($values);
    $best = $total > 0 ? max($values) : null;
    $worst = $total > 0 ? min($values) : null;

    $successCount = count(array_filter($values, fn($v) => $v >= PERF_PASS_THRESHOLD_PCT));
    $successRate = $total > 0 ? round(($successCount / $total) * 100) : 0;

    $buckets = ['0-5' => 0, '5-10' => 0, '10-15' => 0, '15-20' => 0];
    foreach ($values as $v) {
        if ($v < 25) $buckets['0-5']++;
        elseif ($v < 50) $buckets['5-10']++;
        elseif ($v < 75) $buckets['10-15']++;
        else $buckets['15-20']++;
    }
    $distribution = [];
    foreach ($buckets as $range => $count) {
        $distribution[] = ['range' => $range, 'count' => $count];
    }

    $strugglingStudents = array_values(array_filter($grades, fn($g) => (float) $g['grade'] < PERF_STRUGGLING_THRESHOLD_PCT));
    $excellentStudents = array_values(array_filter($grades, fn($g) => (float) $g['grade'] >= PERF_EXCELLENT_THRESHOLD_PCT));

    return [
        'avgGrade20' => moodq_pct_to_20($avg),
        'median20' => moodq_pct_to_20($median),
        'bestGrade20' => moodq_pct_to_20($best),
        'worstGrade20' => moodq_pct_to_20($worst),
        'successRate' => $successRate,
        'distribution' => $distribution,
        'strugglingCount' => count($strugglingStudents),
        'excellentCount' => count($excellentStudents),
        'strugglingStudents' => array_map(
            fn($g) => ['name' => $g['name'], 'grade20' => moodq_pct_to_20((float) $g['grade'])],
            $strugglingStudents
        ),
        'excellentStudents' => array_map(
            fn($g) => ['name' => $g['name'], 'grade20' => moodq_pct_to_20((float) $g['grade'])],
            $excellentStudents
        ),
    ];
}

/**
 * Répond à "est-ce que mes étudiants sont engagés ?" : participation,
 * intensité d'activité, et taux d'activités réellement complétées.
 *
 * NB : "temps moyen d'étude" n'est volontairement pas inclus — les logs
 * actuels (un timestamp par action, sans début/fin de session) ne
 * permettent pas de le mesurer honnêtement. `avgActionsPerStudent` sert
 * de proxy d'engagement à la place.
 */
function compute_engagement_analysis(PDO $pdo, int $courseId, int $enrols): array
{
    $activityCounts = fetch_activity_counts_by_student($pdo, $courseId);
    $activeStudents = count($activityCounts);
    $participationRate = $enrols > 0 ? round(($activeStudents / $enrols) * 100) : 0;
    $avgActionsPerStudent = $activeStudents > 0 ? round(array_sum($activityCounts) / $activeStudents, 1) : 0;

    $stmt = $pdo->prepare("
        SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'Terminé' THEN 1 ELSE 0 END) AS done
        FROM moodq_exercises WHERE courseid = :courseId
    ");
    $stmt->execute([':courseId' => $courseId]);
    $ex = $stmt->fetch();
    $activitiesCompletedRate = ($ex && $ex['total'] > 0) ? round(($ex['done'] / $ex['total']) * 100) : 0;

    return [
        'participationRate' => $participationRate,
        'avgActionsPerStudent' => $avgActionsPerStudent,
        'activitiesCompletedRate' => $activitiesCompletedRate,
    ];
}

/**
 * Plan d'action priorisé : opérationnalise les alertes et signaux en
 * une liste triée (Haute → Moyenne → Basse), distincte des
 * recommandations en texte libre.
 */
function build_action_plan(array $alerts, array $atRiskStudents, array $performance, string $lang = 'fr'): array
{
    $plan = [];
    $labels = [
        'high' => moodq_t('actionPlan.priorityHigh', $lang, 'Haute'),
        'medium' => moodq_t('actionPlan.priorityMedium', $lang, 'Moyenne'),
        'low' => moodq_t('actionPlan.priorityLow', $lang, 'Basse'),
    ];

    foreach ($alerts as $alert) {
        $priority = $alert['level'] === 'critical' ? 'high' : 'medium';
        $plan[] = ['priority' => $priority, 'priorityLabel' => $labels[$priority], 'action' => $alert['message']];
    }

    if ($performance['strugglingCount'] > 0) {
        $priority = $performance['strugglingCount'] >= 3 ? 'high' : 'medium';
        $plan[] = [
            'priority' => $priority,
            'priorityLabel' => $labels[$priority],
            'action' => moodq_t_vars('actionPlan.struggling', $lang, [
                'n' => $performance['strugglingCount'],
                'threshold' => PERF_STRUGGLING_THRESHOLD_PCT / 5,
            ], "Mettre en place un accompagnement pour les {$performance['strugglingCount']} étudiant(s) en difficulté (note < " . (PERF_STRUGGLING_THRESHOLD_PCT / 5) . "/20)."),
        ];
    }

    if (!empty($atRiskStudents)) {
        $n = count($atRiskStudents);
        $plan[] = [
            'priority' => 'high',
            'priorityLabel' => $labels['high'],
            'action' => moodq_t_vars('actionPlan.atRisk', $lang, ['n' => $n], "Prendre contact individuellement avec les {$n} étudiant(s) à risque avant qu'ils ne décrochent."),
        ];
    }

    if (empty($plan)) {
        $plan[] = ['priority' => 'low', 'priorityLabel' => $labels['low'], 'action' => moodq_t('actionPlan.none', $lang, 'Aucune action urgente — maintenir le suivi habituel.')];
    }

    $order = ['high' => 0, 'medium' => 1, 'low' => 2];
    usort($plan, fn($a, $b) => $order[$a['priority']] <=> $order[$b['priority']]);

    return $plan;
}

/**
 * Traduit les alertes en actions concrètes suggérées. Une alerte
 * dit "quoi ne va pas" ; une recommandation dit "que faire".
 */
function build_course_recommendations(array $course, array $bottlenecks, array $atRiskStudents, string $lang = 'fr'): array
{
    $recommendations = [];

    if (!empty($bottlenecks) && $bottlenecks[0]['stuckPct'] >= ALERT_BOTTLENECK_WARNING) {
        $worst = $bottlenecks[0];
        $recommendations[] = moodq_t_vars('recommendations.bottleneck', $lang, ['name' => $worst['name'], 'pct' => $worst['stuckPct']], "Organiser une session de soutien ciblée sur « {$worst['name']} », où {$worst['stuckPct']}% des étudiants sont en difficulté.");
    }

    if (!empty($atRiskStudents)) {
        $n = count($atRiskStudents);
        $recommendations[] = moodq_t_vars('recommendations.atRisk', $lang, ['n' => $n], "Contacter individuellement les {$n} étudiant(s) identifié(s) à risque avant qu'ils ne décrochent définitivement.");
    }

    if ($course['dropoutRate'] >= ALERT_DROPOUT_WARNING) {
        $duration = $course['avgCompletionDays']
            ? moodq_t_vars('reports.daysCount', $lang, ['n' => $course['avgCompletionDays']], "{$course['avgCompletionDays']} jours")
            : moodq_t('reports.notDetermined', $lang, 'non déterminée');
        $recommendations[] = moodq_t_vars('recommendations.dropoutAnalysis', $lang, ['duration' => $duration],
            "Analyser le moment où les étudiants décrochent (durée moyenne de complétion : {$duration}) pour identifier un point de rupture dans le parcours.");
    }

    if ($course['avgQuizScore'] > 0 && $course['avgQuizScore'] < ALERT_QUIZ_WARNING) {
        $recommendations[] = moodq_t('recommendations.quizContent', $lang, "Revoir le contenu pédagogique couvert par le quiz, ou proposer un support de révision supplémentaire.");
    }

    if (empty($recommendations)) {
        $recommendations[] = moodq_t('recommendations.none', $lang, "Aucune action urgente identifiée — le cours se maintient dans les standards attendus.");
    }

    return $recommendations;
}

/**
 * ---------------------------------------------------------
 * AUDIT — journalisation de chaque requête envoyée à la
 * Recherche IA, quel que soit son résultat (succès, rejet de
 * sécurité, ou erreur technique). Utilisée par ai-search.php.
 *
 * Cette fonction ne doit JAMAIS faire échouer la requête
 * principale : une erreur de journalisation est capturée et
 * simplement envoyée aux logs serveur (error_log), sans jamais
 * interrompre la réponse à l'utilisateur.
 * ---------------------------------------------------------
 */
function log_ai_query(
    PDO $pdo,
    ?array $user,
    string $question,
    ?string $generatedSql,
    string $status,
    ?string $errorMessage = null,
    ?int $rowCount = null
): void {
    try {
        $stmt = $pdo->prepare("
            INSERT INTO moodq_ai_query_log
                (userid, username, role, question, generated_sql, status, error_message, row_count, ip_address)
            VALUES
                (:userid, :username, :role, :question, :generated_sql, :status, :error_message, :row_count, :ip_address)
        ");
        $stmt->execute([
            ':userid'        => $user['id'] ?? null,
            ':username'      => $user['username'] ?? $user['name'] ?? null,
            ':role'          => $user['role'] ?? null,
            ':question'      => $question,
            ':generated_sql' => $generatedSql,
            ':status'        => $status,
            ':error_message' => $errorMessage,
            ':row_count'     => $rowCount,
            ':ip_address'    => $_SERVER['REMOTE_ADDR'] ?? null,
        ]);
    } catch (Throwable $e) {
        // La journalisation ne doit jamais casser la Recherche IA elle-même.
        error_log('[MoodQ audit] Échec de journalisation : ' . $e->getMessage());
    }
}