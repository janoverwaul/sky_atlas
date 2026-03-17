<?php
session_start();
header('Content-Type: application/json');
require_once __DIR__ . '/config.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true);
    $pw   = $data['password'] ?? '';

    if (password_verify($pw, AdminHASH)) {
        $_SESSION['sky_admin'] = true;
        echo json_encode(['success' => true]);
    } else {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'Falsches Passwort']);
    }
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    session_destroy();
    echo json_encode(['success' => true]);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);
