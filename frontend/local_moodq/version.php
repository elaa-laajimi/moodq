<?php
/**
 * local_moodq — version.php
 * -----------------------------------------------------------
 * Fichier obligatoire pour tout plugin Moodle. Déclare le
 * composant, la version, et la version minimale de Moodle requise.
 * -----------------------------------------------------------
 */

defined('MOODLE_INTERNAL') || die();

$plugin->component = 'local_moodq';
$plugin->version   = 2026083001;      // YYYYMMDDXX — à incrémenter à chaque mise à jour installée
$plugin->requires  = 2024100700;      // Build minimum Moodle 4.5
$plugin->maturity  = MATURITY_BETA;
$plugin->release   = '1.0.0';
