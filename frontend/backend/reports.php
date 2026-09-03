<?php
/**
 * reports.php
 * -----------------------------------------------------------
 * GET /reports.php            → un rapport résumé par cours
 * GET /reports.php?id=CS101   → rapport d'un seul cours
 *
 * Croise les stats de cours (lib.php::fetch_all_courses) et le
 * meilleur étudiant de chaque cours pour générer un résumé texte,
 * comme dans la vue "Reports" du frontend.
 * -----------------------------------------------------------
 */

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/lib.php';

$lang = moodq_resolve_lang($_GET['lang'] ?? null);

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    respond(405, ['error' => moodq_t('search.methodNotAllowed', $lang, 'Méthode non autorisée. Utilisez GET.')]);
}

require_login();

try {
    $pdo = moodq_pdo();
    $allCourses = fetch_all_courses($pdo); // toujours complet : sert de base au benchmark inter-cours
    $courses = $allCourses;

    $shortnameFilter = $_GET['id'] ?? null;
    if ($shortnameFilter) {
        $courses = array_values(array_filter($courses, fn($c) => $c['id'] === $shortnameFilter));
        if (empty($courses)) {
            respond(404, ['error' => moodq_t_vars('reports.courseNotFound', $lang, ['id' => $shortnameFilter], "Cours '{$shortnameFilter}' introuvable.")]);
        }
    }

    $reports = array_map(function ($course) use ($pdo, $allCourses, $lang) {
        $courseId = get_course_id_from_shortname($pdo, $course['id']);
        $topStudent = fetch_top_student($pdo, $courseId);

        // --- Signaux d'aide à la décision ---
        $performance = compute_performance_analysis($pdo, $courseId);
        $engagement = compute_engagement_analysis($pdo, $courseId, $course['enrols']);
        $bottlenecks = fetch_exercise_bottlenecks($pdo, $courseId);
        $atRiskStudents = compute_at_risk_students($pdo, $courseId, $lang);
        $benchmark = compute_course_benchmark($course, $allCourses);
        $alerts = build_course_alerts($course, $benchmark, $bottlenecks, $lang);
        $recommendations = build_course_recommendations($course, $bottlenecks, $atRiskStudents, $lang);
        $actionPlan = build_action_plan($alerts, $atRiskStudents, $performance, $lang);

        // Cartes de synthèse (vue rapide en haut du rapport).
        $cards = [
            ['key' => 'avgGrade', 'label' => moodq_t('reports.cardAvgGrade', $lang, 'Note moyenne'), 'value' => $performance['avgGrade20'] . '/20', 'icon' => '📊'],
            ['key' => 'participation', 'label' => moodq_t('reports.cardParticipation', $lang, 'Taux de participation'), 'value' => $engagement['participationRate'] . '%', 'icon' => '👥'],
            ['key' => 'success', 'label' => moodq_t('reports.cardSuccess', $lang, 'Taux de réussite'), 'value' => $performance['successRate'] . '%', 'icon' => '📝'],
            ['key' => 'progression', 'label' => moodq_t('reports.cardProgression', $lang, 'Progression du cours'), 'value' => $course['completion'] . '%', 'icon' => '📈'],
            ['key' => 'engagement', 'label' => moodq_t('reports.cardEngagement', $lang, 'Engagement moyen'), 'value' => moodq_t_vars('reports.actionsPerStudent', $lang, ['n' => $engagement['avgActionsPerStudent']], "{$engagement['avgActionsPerStudent']} actions/étudiant"), 'icon' => '⚡'],
            ['key' => 'activities', 'label' => moodq_t('reports.cardActivities', $lang, 'Activités complétées'), 'value' => $engagement['activitiesCompletedRate'] . '%', 'icon' => '🎯'],
        ];

        // Verdict d'un coup d'œil : le niveau d'alerte le plus grave présent.
        $headlineLevel = 'ok';
        foreach ($alerts as $alert) {
            if ($alert['level'] === 'critical') { $headlineLevel = 'critical'; break; }
            if ($alert['level'] === 'warning') { $headlineLevel = 'warning'; }
        }
        $headline = match ($headlineLevel) {
            'critical' => moodq_t('reports.headlineCritical', $lang, 'Attention requise — au moins un point critique identifié.'),
            'warning'  => moodq_t('reports.headlineWarning', $lang, 'À surveiller — quelques points nécessitent une action.'),
            default    => moodq_t('reports.headlineOk', $lang, 'Cours en bonne santé — aucune action urgente.'),
        };

        $effectivenessLabel = moodq_t('reports.effectiveness' . ucfirst($course['effectivenessCode']), $lang, $course['effectiveness']);
        $durationText = $course['avgCompletionDays']
            ? moodq_t_vars('reports.daysCount', $lang, ['n' => $course['avgCompletionDays']], "{$course['avgCompletionDays']} jours")
            : moodq_t('reports.notDetermined', $lang, 'non déterminée');
        $topStudentSentence = $topStudent
            ? moodq_t_vars('reports.summaryTopStudent', $lang, ['name' => $topStudent['name'], 'grade' => $topStudent['avgGrade']], " L'étudiant en tête de classement est {$topStudent['name']} avec une moyenne de {$topStudent['avgGrade']}%.")
            : '';

        $summary = moodq_t_vars('reports.summaryTemplate', $lang, [
            'name' => $course['name'],
            'enrols' => $course['enrols'],
            'completedCount' => $course['completedCount'],
            'completion' => $course['completion'],
            'duration' => $durationText,
            'dropoutRate' => $course['dropoutRate'],
            'effectiveness' => mb_strtolower($effectivenessLabel),
            'avgQuizScore' => $course['avgQuizScore'],
            'topStudentSentence' => $topStudentSentence,
        ], sprintf(
            "Le cours %s compte %d étudiants inscrits, dont %d l'ont terminé " .
            "(taux de complétion de %d%%). La durée moyenne pour terminer le cours est de %s, " .
            "avec un taux d'abandon de %d%%. L'efficacité globale du cours est jugée %s, " .
            "avec un score moyen aux quiz de %s%%.%s",
            $course['name'], $course['enrols'], $course['completedCount'], $course['completion'],
            $durationText, $course['dropoutRate'], mb_strtolower($effectivenessLabel), $course['avgQuizScore'], $topStudentSentence
        ));

        return [
            'courseId' => $course['id'],
            'courseName' => $course['name'],
            'generatedAt' => date('Y-m-d'),
            'headlineLevel' => $headlineLevel,
            'headline' => $headline,
            'cards' => $cards,
            'summary' => $summary,
            'stats' => [
                'avgGrade' => $course['avgGrade'],
                'completion' => $course['completion'],
                'dropoutRate' => $course['dropoutRate'],
                'avgCompletionDays' => $course['avgCompletionDays'],
            ],
            'performance' => $performance,
            'engagement' => $engagement,
            'benchmark' => $benchmark,
            'alerts' => $alerts,
            'bottlenecks' => array_slice($bottlenecks, 0, 3),
            'atRiskStudents' => $atRiskStudents,
            'recommendations' => $recommendations,
            'actionPlan' => $actionPlan,
            'topStudent' => $topStudent,
        ];
    }, $courses);

    respond(200, ['reports' => $reports]);
} catch (Throwable $e) {
    error_log('[MoodQ reports.php] ' . $e->getMessage());
    respond(500, ['error' => moodq_t('search.internalErrorPrefix', $lang, 'Une erreur interne est survenue : ') . $e->getMessage()]);
}