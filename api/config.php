<?php
// ── Datenbank-Konfiguration ───────────────────────────────────────────────────
define('DB_HOST',    '');
define('DB_PORT',    '');
define('DB_NAME',    '');
define('DB_USER',    '');
define('DB_PASS',    '');
define('DB_CHARSET', 'utf8mb4');
define('IMAGES_DIR', __DIR__ . '/../images/');

define('AdminHASH', '');

/*
 * Passwort-Hash erzeugen:
 * php -r "echo password_hash('DEIN_PASSWORT', PASSWORD_BCRYPT) . PHP_EOL;"
*/
