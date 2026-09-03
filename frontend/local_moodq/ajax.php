<?php
ob_start();

require_once(__DIR__ . '/../../config.php');
require_once($CFG->dirroot . '/local/moodq/classes/nl2sql.php');

require_login();
require_sesskey();
require_capability('local/moodq:use', context_system::instance());

$question = trim(optional_param('question', '', PARAM_TEXT));
$lang = optional_param('lang', current_language(), PARAM_ALPHANUMEXT);

$stray = ob_get_clean();

header('Content-Type: application/json; charset=utf-8');

if ($stray !== '') {
    echo json_encode(['error' => 'STRAY OUTPUT DETECTED: ' . substr($stray, 0, 2000)], JSON_UNESCAPED_UNICODE);
    exit;
}

if ($question === '') {
    http_response_code(400);
    echo json_encode(['error' => get_string('questionrequired', 'local_moodq')]);
    exit;
}
if (core_text::strlen($question) > 300) {
    http_response_code(400);
    echo json_encode(['error' => get_string('questiontoolong', 'local_moodq')]);
    exit;
}

try {
    ob_start();
    $engine = new \local_moodq\nl2sql($lang);
    $result = $engine->answer($question);
    $strayDuring = ob_get_clean();
    if ($strayDuring !== '') {
        echo json_encode(['error' => 'STRAY OUTPUT DURING PROCESSING: ' . substr($strayDuring, 0, 2000)], JSON_UNESCAPED_UNICODE);
        exit;
    }
    echo json_encode($result, JSON_UNESCAPED_UNICODE);
} catch (\local_moodq\sql_validation_exception $e) {
    if (ob_get_level() > 0) ob_end_clean();
    http_response_code(422);
    echo json_encode(['error' => get_string('rejected', 'local_moodq', $e->getMessage())]);
} catch (\moodle_exception $e) {
    if (ob_get_level() > 0) ob_end_clean();
    http_response_code(500);
    echo json_encode(['error' => 'MOODLE EXCEPTION: ' . $e->getMessage() . ' | ' . $e->errorcode]);
} catch (\Throwable $e) {
    if (ob_get_level() > 0) ob_end_clean();
    http_response_code(500);
    echo json_encode(['error' => 'PHP EXCEPTION: ' . get_class($e) . ': ' . $e->getMessage() . ' at ' . $e->getFile() . ':' . $e->getLine()], JSON_UNESCAPED_UNICODE);
}