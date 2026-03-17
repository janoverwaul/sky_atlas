<?php
/**
 * Sky Atlas API – images.php
 *
 * GET    ?all=1                 → alle Bilder (Marker-Layer)
 * GET    ?ra_min=&ra_max=&...   → Bilder im Sichtbereich
 * POST   multipart/form-data    → neues Bild hochladen + einfügen
 * PATCH  application/json       → ra/dec/rotation/fov_width/fov_height updaten
 * DELETE ?id=X                  → Bild + Datei löschen
 */
session_start();
if (in_array($_SERVER['REQUEST_METHOD'], ['POST', 'PATCH', 'DELETE'])) {
    if (empty($_SESSION['sky_admin'])) {
        http_response_code(403);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'Unauthorized']);
        exit;
    }
}

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ── DB-Verbindung ─────────────────────────────────────────────────────────────
require_once __DIR__ . '/config.php';

try {
    $dsn = sprintf(
        'mysql:host=%s;port=%s;dbname=%s;charset=%s',
        DB_HOST, DB_PORT, DB_NAME, DB_CHARSET
    );
    $pdo = new PDO($dsn, DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'DB-Verbindung fehlgeschlagen: ' . $e->getMessage()]);
    exit;
}

// ── Schema (einmalig) ─────────────────────────────────────────────────────────
$pdo->exec("
    CREATE TABLE IF NOT EXISTS skyatlas_images (
        id          INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
        filename    VARCHAR(255) NOT NULL,
        object_name VARCHAR(255) NOT NULL,
        ra          DOUBLE       NOT NULL,
        declination DOUBLE       NOT NULL,
        fov_width   DOUBLE       NOT NULL,
        fov_height  DOUBLE       NOT NULL,
        rotation    DOUBLE       DEFAULT 0,
        description TEXT         DEFAULT '',
        captured_at VARCHAR(50)  DEFAULT '',
        created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP
    )
");

// ── Beispiel-Daten (nur beim ersten Start) ────────────────────────────────────
if ($count == 0) {
    $samples = [
        ['orion_nebula.jpg', 'M42 – Orion Nebula',      83.768910599162,  -5.4624658620473, 2.5873939686001, 2.1651811990043, 35.150006711294,  null, '2024-11-15'],
        ['horsehead.jpg',    'B33 – Horsehead Nebula',  84.929348669142,  -1.7621460113956, 2.6828447457564, 2.561872562745,  27.459863143588,  null, '2024-11-20'],
        ['pleiades.jpg',     'M45 – Pleiades',          56.642768226802,  24.147822926668,  2.11421000362,   2.3222185233041, 306.36251911738,  null, '2024-12-28'],
        ['andromeda.jpg',    'M31 – Andromeda Galaxy',  10.392663600751,  41.260775903824,  3.0994,          1.9582,          55.140401344533,  null, '2024-08-31'],
    ];
    $stmt = $pdo->prepare("
        INSERT INTO skyatlas_images
            (filename, object_name, ra, declination, fov_width, fov_height, rotation, description, captured_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ");
    foreach ($samples as $s) { $stmt->execute($s); }
}

// ── Routing ───────────────────────────────────────────────────────────────────
$method = $_SERVER['REQUEST_METHOD'];

if      ($method === 'GET')    handle_get($pdo);
elseif  ($method === 'POST')   handle_post($pdo);
elseif  ($method === 'PATCH')  handle_patch($pdo);
elseif  ($method === 'DELETE') handle_delete($pdo);
else {
    http_response_code(405);
    echo json_encode(['error' => 'Methode nicht erlaubt']);
}

// ── GET ───────────────────────────────────────────────────────────────────────
function handle_get(PDO $pdo): void
{
    if (isset($_GET['all'])) {
        $rows = $pdo->query("
            SELECT *, declination AS `dec`
            FROM skyatlas_images
            ORDER BY captured_at DESC
        ")->fetchAll();
        echo json_encode(['images' => $rows]);
        return;
    }

    $ra_min  = filter_input(INPUT_GET, 'ra_min',  FILTER_VALIDATE_FLOAT);
    $ra_max  = filter_input(INPUT_GET, 'ra_max',  FILTER_VALIDATE_FLOAT);
    $dec_min = filter_input(INPUT_GET, 'dec_min', FILTER_VALIDATE_FLOAT);
    $dec_max = filter_input(INPUT_GET, 'dec_max', FILTER_VALIDATE_FLOAT);

    if ($ra_min === false || $ra_max === false || $dec_min === false || $dec_max === false) {
        http_response_code(400);
        echo json_encode(['error' => 'Ungültige oder fehlende Bounds']);
        return;
    }

    $margin = 5.0;
    if ($ra_min <= $ra_max) {
        $stmt = $pdo->prepare("
            SELECT *, declination AS `dec` FROM skyatlas_images
            WHERE (ra + fov_width/2  + :m1) >= :ra_min
              AND (ra - fov_width/2  - :m2) <= :ra_max
              AND (declination + fov_height/2 + :m3) >= :dec_min
              AND (declination - fov_height/2 - :m4) <= :dec_max
            ORDER BY captured_at DESC
        ");
        $stmt->execute([':ra_min'=>$ra_min-$margin, ':ra_max'=>$ra_max+$margin,
                        ':dec_min'=>$dec_min-$margin, ':dec_max'=>$dec_max+$margin,
                        ':m1'=>$margin, ':m2'=>$margin, ':m3'=>$margin, ':m4'=>$margin]);
    } else {
        $stmt = $pdo->prepare("
            SELECT *, declination AS `dec` FROM skyatlas_images
            WHERE ((ra + fov_width/2 + :m1) >= :ra_min OR (ra - fov_width/2 - :m2) <= :ra_max)
              AND (declination + fov_height/2 + :m3) >= :dec_min
              AND (declination - fov_height/2 - :m4) <= :dec_max
            ORDER BY captured_at DESC
        ");
        $stmt->execute([':ra_min'=>$ra_min-$margin, ':ra_max'=>$ra_max+$margin,
                        ':dec_min'=>$dec_min-$margin, ':dec_max'=>$dec_max+$margin,
                        ':m1'=>$margin, ':m2'=>$margin, ':m3'=>$margin, ':m4'=>$margin]);
    }
    echo json_encode(['images' => $stmt->fetchAll()]);
}

// ── POST: Datei-Upload ────────────────────────────────────────────────────────
function handle_post(PDO $pdo): void
{
    $name = trim($_POST['object_name'] ?? '');
    $ra   = filter_var($_POST['ra']  ?? '', FILTER_VALIDATE_FLOAT);
    $dec  = filter_var($_POST['dec'] ?? '', FILTER_VALIDATE_FLOAT);

    if (!$name) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'object_name fehlt']);
        return;
    }
    if (empty($_FILES['image']['tmp_name'])) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Keine Datei empfangen']);
        return;
    }

    $allowed = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'tif', 'tiff'];
    $ext     = strtolower(pathinfo($_FILES['image']['name'], PATHINFO_EXTENSION));
    if (!in_array($ext, $allowed)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Dateityp nicht erlaubt: ' . $ext]);
        return;
    }

    // Upload-Verzeichnis sicherstellen
    if (!is_dir(IMAGES_DIR)) {
        mkdir(IMAGES_DIR, 0755, true);
    }

    $filename = uniqid('img_', true) . '.' . $ext;
    $dest     = IMAGES_DIR . $filename;

    if (!move_uploaded_file($_FILES['image']['tmp_name'], $dest)) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'Speichern fehlgeschlagen']);
        return;
    }

    $stmt = $pdo->prepare("
        INSERT INTO skyatlas_images
            (filename, object_name, ra, declination, fov_width, fov_height, rotation, description, captured_at)
        VALUES (:filename, :name, :ra, :dec, 1.0, 1.0, 0, '', :cat)
    ");
    $stmt->execute([
        ':filename' => $filename,
        ':name'     => $name,
        ':ra'       => $ra !== false ? $ra  : 0.0,
        ':dec'      => $dec !== false ? $dec : 0.0,
        ':cat'      => date('Y-m-d'),
    ]);

    $id = $pdo->lastInsertId();
    http_response_code(201);
    echo json_encode([
        'success' => true,
        'image'   => [
            'id'          => $id,
            'object_name' => $name,
            'filename'    => $filename,
            'ra'          => $ra !== false ? $ra  : 0.0,
            'dec'         => $dec !== false ? $dec : 0.0,
            'fov_width'   => 1.0,
            'fov_height'  => 1.0,
            'rotation'    => 0,
            'description' => '',
            'captured_at' => date('Y-m-d'),
        ],
    ]);
}

// ── PATCH: Positionsdaten updaten ─────────────────────────────────────────────
function handle_patch(PDO $pdo): void
{
    $data = json_decode(file_get_contents('php://input'), true);
    $id   = isset($data['id']) ? (int)$data['id'] : 0;

    if (!$id) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'id fehlt']);
        return;
    }

    // Erlaubte Felder + Mapping (Frontend-Key → DB-Spalte)
    $fieldMap = [
        'ra'         => 'ra',
        'dec'        => 'declination',   // Frontend sendet 'dec', DB hat 'declination'
        'rotation'   => 'rotation',
        'fov_width'  => 'fov_width',
        'fov_height' => 'fov_height',
    ];

    $sets   = [];
    $params = [];
    foreach ($fieldMap as $frontKey => $dbCol) {
        if (array_key_exists($frontKey, $data)) {
            $sets[]           = "`$dbCol` = ?";
            $params[]         = (float)$data[$frontKey];
        }
    }

    if (!$sets) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Keine gültigen Felder']);
        return;
    }

    $params[] = $id;
    $pdo->prepare('UPDATE skyatlas_images SET ' . implode(', ', $sets) . ' WHERE id = ?')
        ->execute($params);

    echo json_encode(['success' => true]);
}

// ── DELETE: Bild + Datei entfernen ────────────────────────────────────────────
function handle_delete(PDO $pdo): void
{
    $id = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT);
    if (!$id) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Ungültige oder fehlende id']);
        return;
    }

    $stmt = $pdo->prepare('SELECT filename FROM skyatlas_images WHERE id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();

    if (!$row) {
        http_response_code(404);
        echo json_encode(['success' => false, 'error' => 'Nicht gefunden']);
        return;
    }

    // Datei löschen (kein Fehler wenn sie fehlt)
    $filepath = IMAGES_DIR . $row['filename'];
    if (is_file($filepath)) {
        @unlink($filepath);
    }

    $pdo->prepare('DELETE FROM skyatlas_images WHERE id = ?')->execute([$id]);
    echo json_encode(['success' => true]);
}