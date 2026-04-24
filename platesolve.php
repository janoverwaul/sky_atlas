<?php
/**
 * platesolve.php – Client für den lokalen Plate Solver Microservice.
 *
 * Verwendung:
 *   $result = platesolve('/tmp/upload_xyz.jpg');
 *   // $result['ra'], $result['dec'], $result['rotation'],
 *   // $result['scale_arcsec_per_px'], $result['fov_width_deg'], $result['fov_height_deg']
 *
 * Wirft RuntimeException bei Fehler.
 */

const PLATESOLVE_URL     = 'http://127.0.0.1:8011/solve';
const PLATESOLVE_TIMEOUT = 180;  // Sekunden – solve-field braucht bis zu 120 s

/**
 * Schickt eine Bilddatei an den Plate Solver und gibt die Koordinaten zurück.
 *
 * @param  string       $filePath    Absoluter Pfad zur Bilddatei
 * @param  float|null   $scaleLow    Pixelskala min arcsec/px (optional)
 * @param  float|null   $scaleHigh   Pixelskala max arcsec/px (optional)
 * @param  float|null   $raHint      RA-Hinweis in Grad J2000 (optional)
 * @param  float|null   $decHint     Dec-Hinweis in Grad J2000 (optional)
 * @param  float        $radiusHint  Suchradius in Grad (nur mit RA/Dec-Hint)
 * @return array{
 *   ok: bool, original: string,
 *   ra: float, dec: float, rotation: float,
 *   scale_arcsec_per_px: float,
 *   fov_width_deg: float, fov_height_deg: float
 * }
 * @throws RuntimeException  Bei cURL-Fehler, HTTP-Fehler oder Solve-Fehler
 */
 
/**
 * python-API
 * liegt unter /home/users/jan/www/jan-overwaul/platesolve
 * dort auch weitere Infos
 */
function platesolve(
    string $filePath,
    ?float $scaleLow   = null,
    ?float $scaleHigh  = null,
    ?float $raHint     = null,
    ?float $decHint    = null,
    float  $radiusHint = 5.0
): array {
    if (!file_exists($filePath)) {
        throw new RuntimeException("Datei nicht gefunden: $filePath");
    }

    $fields = [
        'file' => new CURLFile(
            $filePath,
            mime_content_type($filePath) ?: 'application/octet-stream',
            basename($filePath)
        ),
    ];

    if ($scaleLow  !== null) $fields['scale_low']    = $scaleLow;
    if ($scaleHigh !== null) $fields['scale_high']   = $scaleHigh;
    if ($raHint    !== null) $fields['ra_hint']      = $raHint;
    if ($decHint   !== null) $fields['dec_hint']     = $decHint;
    if ($raHint !== null && $decHint !== null) {
        $fields['radius_hint'] = $radiusHint;
    }

    $ch = curl_init(PLATESOLVE_URL);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $fields,
        CURLOPT_TIMEOUT        => PLATESOLVE_TIMEOUT,
        CURLOPT_CONNECTTIMEOUT => 5,
    ]);

    $raw      = curl_exec($ch);
    $curlErr  = curl_error($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($raw === false) {
        throw new RuntimeException("Plate Solver nicht erreichbar: $curlErr");
    }

    $data = json_decode($raw, true);

    if (!is_array($data)) {
        throw new RuntimeException("Ungültige Antwort vom Plate Solver.");
    }

    if ($httpCode !== 200 || empty($data['ok'])) {
        $msg = $data['detail'] ?? $data['error'] ?? "HTTP $httpCode";
        throw new RuntimeException("Plate Solving fehlgeschlagen: $msg");
    }

    return $data;
}
