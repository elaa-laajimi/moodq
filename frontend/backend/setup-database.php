<?php
/**
 * setup-database.php
 * -----------------------------------------------------------
 * À LANCER UNE SEULE FOIS (tu peux le relancer sans risque, il
 * recrée les tables à chaque exécution — pratique pendant les tests).
 *
 * Prérequis :
 *   - XAMPP démarré (Apache + MySQL)
 *   - La base "moodq" créée dans phpMyAdmin (vide, pas besoin
 *     d'y créer de tables toi-même, ce script s'en charge)
 *
 * Comment le lancer :
 *   1. Démarre le serveur PHP (voir README.md) :
 *      php -S localhost:8000 -t backend
 *   2. Ouvre http://localhost:8000/setup-database.php dans ton
 *      navigateur, ou lance en ligne de commande :
 *      php backend/setup-database.php
 *
 * Ce script crée dans la base MySQL "moodq" :
 *   - les tables qui reproduisent la structure Moodle utilisée
 *     par MoodQ (mdl_course, mdl_user, mdl_grade_grades, etc.)
 *   - des données de démonstration COHÉRENTES avec celles déjà
 *     affichées dans le frontend (mêmes 2 cours, mêmes 8 étudiants)
 *     pour que les chiffres se recoupent une fois le frontend
 *     branché sur ces endpoints.
 * -----------------------------------------------------------
 */

require_once __DIR__ . '/config.php';

try {
    // Connexion sans dbname pour pouvoir la créer si besoin, puis on s'y connecte.
    $pdoServer = new PDO('mysql:host=' . DB_HOST . ';port=' . DB_PORT . ';charset=utf8mb4', DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    ]);
    $pdoServer->exec("CREATE DATABASE IF NOT EXISTS `" . DB_NAME . "` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
} catch (PDOException $e) {
    die("❌ Impossible de se connecter à MySQL. Vérifie que XAMPP (MySQL) est démarré.\nDétail : " . $e->getMessage());
}

$pdo = moodq_pdo();
$pdo->exec('SET FOREIGN_KEY_CHECKS = 0;');

// -------------------------------------------------------------
// 0. On repart toujours d'une base de tables propre.
// -------------------------------------------------------------
$dropOrder = [
    'moodq_exercises', 'mdl_logstore_standard_log', 'mdl_quiz_grades', 'mdl_quiz',
    'mdl_course_completion', 'mdl_grade_grades', 'mdl_grade_items',
    'mdl_user_enrolments', 'mdl_enrol', 'mdl_user', 'mdl_course',
];
foreach ($dropOrder as $table) {
    $pdo->exec("DROP TABLE IF EXISTS `$table`");
}

// -------------------------------------------------------------
// 1. SCHÉMA (reproduit les tables Moodle utilisées par MoodQ)
// -------------------------------------------------------------
$createStatements = [

"CREATE TABLE mdl_course (
    id INT AUTO_INCREMENT PRIMARY KEY,
    fullname VARCHAR(255) NOT NULL,
    shortname VARCHAR(100) NOT NULL,
    category VARCHAR(100),
    startdate INT,
    enddate INT,
    visible TINYINT(1) DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

"CREATE TABLE mdl_user (
    id INT AUTO_INCREMENT PRIMARY KEY,
    firstname VARCHAR(100) NOT NULL,
    lastname VARCHAR(100) NOT NULL,
    username VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

"CREATE TABLE mdl_enrol (
    id INT AUTO_INCREMENT PRIMARY KEY,
    courseid INT NOT NULL,
    enrol VARCHAR(50) DEFAULT 'manual',
    status TINYINT DEFAULT 0,
    FOREIGN KEY (courseid) REFERENCES mdl_course(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// 'progress' est une simplification pour la démo : dans un vrai Moodle,
// la progression se calcule à partir des critères de complétion
// (mdl_course_completion_crit_compl). On la stocke ici directement
// pour ne pas avoir à réimplémenter tout ce moteur dans ce projet.
"CREATE TABLE mdl_user_enrolments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    userid INT NOT NULL,
    enrolid INT NOT NULL,
    timestart INT,
    timeend INT,
    progress INT DEFAULT 0,
    FOREIGN KEY (userid) REFERENCES mdl_user(id),
    FOREIGN KEY (enrolid) REFERENCES mdl_enrol(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

"CREATE TABLE mdl_grade_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    courseid INT NOT NULL,
    itemname VARCHAR(255),
    itemtype VARCHAR(50),
    grademax DECIMAL(6,2) DEFAULT 100,
    FOREIGN KEY (courseid) REFERENCES mdl_course(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

"CREATE TABLE mdl_grade_grades (
    id INT AUTO_INCREMENT PRIMARY KEY,
    itemid INT NOT NULL,
    userid INT NOT NULL,
    rawgrade DECIMAL(6,2),
    finalgrade DECIMAL(6,2),
    timemodified INT,
    FOREIGN KEY (itemid) REFERENCES mdl_grade_items(id),
    FOREIGN KEY (userid) REFERENCES mdl_user(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

"CREATE TABLE mdl_course_completion (
    id INT AUTO_INCREMENT PRIMARY KEY,
    userid INT NOT NULL,
    course INT NOT NULL,
    timecompleted INT,
    FOREIGN KEY (userid) REFERENCES mdl_user(id),
    FOREIGN KEY (course) REFERENCES mdl_course(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

"CREATE TABLE mdl_quiz (
    id INT AUTO_INCREMENT PRIMARY KEY,
    course INT NOT NULL,
    name VARCHAR(255),
    FOREIGN KEY (course) REFERENCES mdl_course(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

"CREATE TABLE mdl_quiz_grades (
    id INT AUTO_INCREMENT PRIMARY KEY,
    quiz INT NOT NULL,
    userid INT NOT NULL,
    grade DECIMAL(6,2),
    timemodified INT,
    FOREIGN KEY (quiz) REFERENCES mdl_quiz(id),
    FOREIGN KEY (userid) REFERENCES mdl_user(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

"CREATE TABLE mdl_logstore_standard_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    userid INT NOT NULL,
    courseid INT NOT NULL,
    action VARCHAR(50),
    timecreated INT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

// Table spécifique à MoodQ (pas une vraie table Moodle) : représente
// les exercices pratiques suivis dans le détail étudiant. Moodle n'a
// pas d'équivalent générique unique (ça dépend du module utilisé :
// assign, workshop, h5p...), donc on modélise simplement ici.
"CREATE TABLE moodq_exercises (
    id INT AUTO_INCREMENT PRIMARY KEY,
    courseid INT NOT NULL,
    userid INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",

];

foreach ($createStatements as $sql) {
    $pdo->exec($sql);
}

$pdo->exec('SET FOREIGN_KEY_CHECKS = 1;');

// -------------------------------------------------------------
// 2. DONNÉES DE DÉMONSTRATION
// -------------------------------------------------------------

// -------------------------------------------------------------
// Chronologie relative à AUJOURD'HUI (et non des dates 2025 en dur),
// pour que la démo reste cohérente peu importe quand ce script est
// relancé : le cours a "commencé" il y a 5 mois et se termine dans
// 2 mois (donc toujours "actif" au moment du test), et toutes les
// dates de complétion/activité sont calées par rapport à ce point
// de départ plutôt que sur des dates absolues figées.
// -------------------------------------------------------------
$courseStart = strtotime('-5 months');
$courseEnd   = strtotime('+2 months');

// ---- Cours ----
$courses = [
    ['id' => 1, 'fullname' => 'Introduction to Programming', 'shortname' => 'CS101', 'category' => 'Informatique'],
    ['id' => 2, 'fullname' => 'Calculus I', 'shortname' => 'MA101', 'category' => 'Mathématiques'],
];
$stmt = $pdo->prepare("INSERT INTO mdl_course (id, fullname, shortname, category, startdate, enddate, visible)
                        VALUES (:id, :fullname, :shortname, :category, :startdate, :enddate, 1)");
foreach ($courses as $c) {
    $stmt->execute([
        ':id' => $c['id'], ':fullname' => $c['fullname'], ':shortname' => $c['shortname'],
        ':category' => $c['category'], ':startdate' => $courseStart, ':enddate' => $courseEnd,
    ]);
}

// ---- Étudiants ----
$students = [
    ['id' => 1, 'first' => 'Rania',  'last' => 'Levesque',   'email' => 'rania.levesque45@student.moodq.edu'],
    ['id' => 2, 'first' => 'Tariq',  'last' => 'Lavoie',     'email' => 'tariq.lavoie8@student.moodq.edu'],
    ['id' => 3, 'first' => 'Karim',  'last' => 'Gagnon',     'email' => 'karim.gagnon98@student.moodq.edu'],
    ['id' => 4, 'first' => 'Maya',   'last' => 'El Amrani',  'email' => 'maya.elamrani31@student.moodq.edu'],
    ['id' => 5, 'first' => 'Sofia',  'last' => 'Belkacem',   'email' => 'sofia.belkacem33@student.moodq.edu'],
    ['id' => 6, 'first' => 'Maya',   'last' => 'Cisse',      'email' => 'maya.cisse82@student.moodq.edu'],
    ['id' => 7, 'first' => 'Imane',  'last' => 'Pelletier',  'email' => 'imane.pelletier90@student.moodq.edu'],
    ['id' => 8, 'first' => 'Karim',  'last' => 'Bouzid',     'email' => 'karim.bouzid52@student.moodq.edu'],
];
$stmt = $pdo->prepare("INSERT INTO mdl_user (id, firstname, lastname, username, email)
                        VALUES (:id, :first, :last, :username, :email)");
foreach ($students as $s) {
    $stmt->execute([
        ':id' => $s['id'], ':first' => $s['first'], ':last' => $s['last'],
        ':username' => strtolower($s['first'] . '.' . str_replace(' ', '', $s['last'])), ':email' => $s['email'],
    ]);
}

// ---- Enrolments (une méthode d'inscription "manual" par cours) ----
$pdo->exec("INSERT INTO mdl_enrol (id, courseid, enrol, status) VALUES (1, 1, 'manual', 0), (2, 2, 'manual', 0)");

// ---- Grade items (un item 'course total' par cours) ----
$pdo->exec("INSERT INTO mdl_grade_items (id, courseid, itemname, itemtype, grademax) VALUES
    (1, 1, 'Total du cours', 'course', 100),
    (2, 2, 'Total du cours', 'course', 100)");

// ---- Quiz (un quiz représentatif par cours) ----
$pdo->exec("INSERT INTO mdl_quiz (id, course, name) VALUES
    (1, 1, 'Quiz noté — CS101'),
    (2, 2, 'Quiz noté — MA101')");

// ---- Inscriptions détaillées (= ENROLLMENTS du frontend) ----
// studentId, courseId (1=CS101, 2=MA101), avgGrade, progress, completed,
// completedOffsetDays (jours après $courseStart), daysToComplete
$enrollments = [
    [1, 1, 83.7, 100, true,  93,   33],
    [2, 1, 81.9, 100, true,  97,   37],
    [3, 1, 81.7, 100, true,  101,  41],
    [4, 1, 80.5, 85,  false, null, null],
    [5, 1, 80.1, 60,  false, null, null],
    [6, 2, 80.1, 100, true,  92,   48],
    [7, 2, 79.9, 90,  false, null, null],
    [8, 2, 78.2, 45,  false, null, null],
    [1, 2, 74.3, 70,  false, null, null],
    [3, 2, 76.8, 100, true,  106,  51],
];

$insEnrolment  = $pdo->prepare("INSERT INTO mdl_user_enrolments (userid, enrolid, timestart, timeend, progress) VALUES (:userid, :enrolid, :timestart, 0, :progress)");
$insGrade      = $pdo->prepare("INSERT INTO mdl_grade_grades (itemid, userid, rawgrade, finalgrade, timemodified) VALUES (:itemid, :userid, :grade, :grade, :time)");
$insCompletion = $pdo->prepare("INSERT INTO mdl_course_completion (userid, course, timecompleted) VALUES (:userid, :course, :time)");

$examNames = ['Quiz 1', 'Quiz 2', 'Devoir intermédiaire', 'Examen final'];
$exerciseNames = ['Exercice 1', 'Exercice 2', 'Exercice 3', 'Exercice 4', 'Projet pratique'];
$insExercise = $pdo->prepare("INSERT INTO moodq_exercises (courseid, userid, name, status) VALUES (:courseid, :userid, :name, :status)");
$insExam = $pdo->prepare("INSERT INTO mdl_quiz_grades (quiz, userid, grade, timemodified) VALUES (:quiz, :userid, :grade, :time)");

foreach ($enrollments as [$userid, $courseid, $avgGrade, $progress, $completed, $completedOffsetDays, $daysToComplete]) {
    $enrolid = $courseid; // id d'enrol correspond au courseid ici (1 <-> 1, 2 <-> 2)

    // Pour les inscriptions terminées, la date de complétion est calculée
    // par rapport au début du cours ($courseStart), pas une date figée —
    // et timestart en découle en retirant la durée réelle mise pour
    // terminer, pour que les statistiques de durée moyenne restent réalistes.
    if ($completed && $daysToComplete !== null) {
        $completedAt = $courseStart + ($completedOffsetDays * 86400);
        $timestart = $completedAt - ($daysToComplete * 86400);
    } else {
        $completedAt = null;
        $timestart = $courseStart;
    }

    $insEnrolment->execute([':userid' => $userid, ':enrolid' => $enrolid, ':timestart' => $timestart, ':progress' => $progress]);

    $itemid = $courseid; // grade item id correspond au courseid ici
    $insGrade->execute([':itemid' => $itemid, ':userid' => $userid, ':grade' => $avgGrade, ':time' => time()]);

    if ($completed) {
        $insCompletion->execute([':userid' => $userid, ':course' => $courseid, ':time' => $completedAt]);
    }

    $quizId = $courseid;

    // Examens détaillés + exercices (pour le modal de détail étudiant)
    $examsDoneCount = max(1, (int) round(($progress / 100) * count($examNames)));
    for ($i = 0; $i < $examsDoneCount; $i++) {
        $insExam->execute([':quiz' => $quizId, ':userid' => $userid, ':grade' => rand(65, 95), ':time' => time()]);
    }

    $exercisesDoneCount = max(1, (int) round(($progress / 100) * count($exerciseNames)));
    foreach ($exerciseNames as $i => $name) {
        $status = $i < $exercisesDoneCount ? 'Terminé' : ($i === $exercisesDoneCount ? 'En cours' : 'Non commencé');
        $insExercise->execute([':courseid' => $courseid, ':userid' => $userid, ':name' => $name, ':status' => $status]);
    }
}

// ---- Journal d'activité (mdl_logstore_standard_log) ----
// On génère un nombre d'événements réaliste par cours, répartis
// aléatoirement entre les étudiants inscrits, sur une période de
// ~4,5 mois à partir du début du cours (toujours dans le passé par
// rapport à aujourd'hui, puisque le cours a commencé il y a 5 mois).
$activityTargets = [1 => 412, 2 => 587]; // courseid => nb d'événements
$enrolledByCourse = [1 => [1, 2, 3, 4, 5], 2 => [1, 3, 6, 7, 8]];
$insLog = $pdo->prepare("INSERT INTO mdl_logstore_standard_log (userid, courseid, action, timecreated) VALUES (:userid, :courseid, :action, :time)");
$actions = ['viewed', 'submitted', 'graded', 'commented'];
$startTs = $courseStart;
$endTs = $courseStart + (131 * 86400);

foreach ($activityTargets as $courseid => $count) {
    $courseStudentIds = $enrolledByCourse[$courseid];
    for ($i = 0; $i < $count; $i++) {
        $insLog->execute([
            ':userid' => $courseStudentIds[array_rand($courseStudentIds)],
            ':courseid' => $courseid,
            ':action' => $actions[array_rand($actions)],
            ':time' => rand($startTs, $endTs),
        ]);
    }
}

echo "<pre>";
echo "✅ Base MoodQ (MySQL) créée avec succès : " . DB_NAME . "@" . DB_HOST . ":" . DB_PORT . "\n";
echo "   " . count($courses) . " cours, " . count($students) . " étudiants, " . count($enrollments) . " inscriptions.\n";
echo "   Tu peux maintenant tester les endpoints (voir README.md).\n";
echo "</pre>";