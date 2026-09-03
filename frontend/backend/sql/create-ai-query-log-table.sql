-- =========================================================
-- moodq_ai_query_log — Journalisation des requêtes Recherche IA
-- =========================================================
-- Exigence "Audit complet" : trace chaque question posée à l'IA,
-- le SQL généré (le cas échéant), le résultat (succès / rejeté /
-- erreur), et qui l'a posée, pour traçabilité et conformité.
--
-- À exécuter de la même façon que moodq_exercises (docker cp puis
-- exécution dans le conteneur MariaDB), sur la base bitnami_moodle.
-- =========================================================

CREATE TABLE IF NOT EXISTS moodq_ai_query_log (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    userid         INT NULL,
    username       VARCHAR(191) NULL,
    role           VARCHAR(50) NULL,
    question       TEXT NOT NULL,
    generated_sql  TEXT NULL,
    status         ENUM('success', 'rejected', 'error') NOT NULL,
    error_message  TEXT NULL,
    row_count      INT NULL,
    ip_address     VARCHAR(45) NULL,
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_moodq_ai_log_userid (userid),
    INDEX idx_moodq_ai_log_status (status),
    INDEX idx_moodq_ai_log_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;