# ✦ Sky Atlas

Ein interaktiver Himmelskarten-Viewer auf Basis von **Aladin Lite v3**, mit dem du eigene Astrofotoaufnahmen direkt auf die Himmelskarte legen, positionieren und verwalten kannst.

![Sky Atlas Screenshot](docs/screenshot.png)

---

## Features

- 🌌 **Aladin Lite v3** als Kartengrundlage (DSS, 2MASS, u.v.m.)
- 🖼️ **Eigene Bilder als Overlay** – positionierbar per RA/Dec, skalierbar und rotierbar
- 🎯 **Automatisches Plate Solving** (optional) – beim Upload werden RA/Dec, Rotation und FOV automatisch aus dem Bildinhalt bestimmt (lokaler Astrometry.net-Microservice, siehe unten)
- 🔍 **SIMBAD-Live-Identifikation** – aufklappbares Panel unten rechts, zeigt das Objekt unter dem Fadenkreuz sowie eine Liste aller nahegelegenen Objekte aus dem SIMBAD-Katalog (CDS Strasbourg)
- 📋 **Objekt-Übersichtsliste** – sortierbares Modal mit allen eigenen Aufnahmen (Name, RA, Dec, Beschreibung, Vorschaubild), Sprung-Button pro Objekt (Modal schließt, Karte zoomt mit 2× FOV auf das Objekt)
- 🔀 **Drei Ansichtsmodi** (gestaffelt nach Sichtfeld)
  - `FOV > 30°` → kompakte Marker (kleiner, dünner)
  - `15° < FOV ≤ 30°` → Standard-Catalog-Marker (oranges Kreuz)
  - `FOV ≤ 15°` → präzises SVG-Bild-Overlay via `world2pix`
- ✏️ **Admin-Modus** – Bilder hochladen, per Drag & Drop repositionieren, Ecken und Rotationshandle ziehen, automatisches Speichern
- 🔐 **Passwortgeschützter Admin-Zugang** (bcrypt, serverseitige Session)
- 📊 **Objekt-Infopanel** mit Bild, Beschreibung, Aufnahmedatum
- 💾 **MySQL-Datenbank** – vollständige CRUD-API in PHP
- 🗂️ **Beispieldatensatz** wird beim ersten Start automatisch eingefügt

---

## Voraussetzungen

| Komponente | Version |
|---|---|
| PHP | ≥ 8.0 |
| MySQL / MariaDB | ≥ 5.7 / 10.3 |
| Webserver | Apache / Nginx |
| Modernes Browser | Chrome, Firefox, Edge, Safari |

### Optional: Plate Solver

Wer beim Upload automatische Positionsbestimmung möchte, benötigt zusätzlich einen lokalen Plate-Solver-Microservice auf Basis von **Astrometry.net** + **FastAPI**. Siehe Abschnitt [Plate Solving](#plate-solving-optional) weiter unten.

---

## Installation

### 1. Repository klonen

```bash
git clone https://github.com/DEIN-USERNAME/sky-atlas.git
cd sky-atlas
```

### 2. Verzeichnisstruktur

```
sky-atlas/
├── api/
│   ├── config.php          ← ⚠️ Konfiguration anpassen (siehe unten)
│   ├── images.php
│   └── auth.php
├── images/                 ← Hochgeladene Astrofotos (muss schreibbar sein)
├── platesolve.php          ← Client für den Plate-Solver-Microservice
├── static/
│   ├── css/style.css
│   └── js/script.js
└── index.php
```

### 3. `api/config.php` anpassen ⚠️

```php
define('DB_HOST',    'localhost');
define('DB_PORT',    '3306');
define('DB_NAME',    'sky_atlas');   // Datenbankname
define('DB_USER',    'db_user');     // Datenbankbenutzer
define('DB_PASS',    'db_pass');     // Datenbankpasswort
define('DB_CHARSET', 'utf8mb4');
define('IMAGES_DIR', __DIR__ . '/../images/');
define('AdminHASH',  '$2y$...');     // bcrypt-Hash des Admin-Passworts
```

#### Admin-Passwort-Hash erzeugen

```bash
php -r "echo password_hash('DEIN_PASSWORT', PASSWORD_BCRYPT) . PHP_EOL;"
```

Den ausgegebenen Hash in `AdminHASH` eintragen.

### 4. Datenbank anlegen

```sql
CREATE DATABASE sky_atlas CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Das Tabellenschema wird beim ersten API-Aufruf automatisch angelegt.

### 5. Verzeichnisrechte setzen

```bash
chmod 755 images/
# oder falls nötig:
chown www-data:www-data images/
```

### 6. Webserver konfigurieren

Der Webserver muss PHP-Anfragen verarbeiten und `api/` als erreichbaren Pfad bereitstellen. Für Apache genügt in der Regel eine `.htaccess` oder VirtualHost-Konfiguration, die auf das Projektverzeichnis zeigt.

> **Hinweis für Plate Solving:** `max_execution_time` in der PHP-Konfiguration sowie das Apache-`Timeout` müssen mindestens **180 Sekunden** betragen, da Solves bei ungünstigen Hints bis zu 2 Minuten dauern können.

---

## Plate Solving (optional)

Beim Upload eines Bildes im Admin-Modus versucht Sky Atlas automatisch, die Position des Bildes astrometrisch zu bestimmen. Der PHP-Client (`platesolve.php`) schickt die Datei per HTTP an einen lokalen FastAPI-Microservice unter `http://127.0.0.1:8011/solve`, der intern `solve-field` von Astrometry.net aufruft.

**Verhalten beim Upload:**

| Ergebnis | RA/Dec | Rotation | FOV |
|---|---|---|---|
| ✅ Solve erfolgreich | aus Bildinhalt | aus Bildinhalt | aus Bildinhalt |
| ❌ Kein Match | aktuelle Kartenposition | `0°` | `1° × 1°` (manuell anpassbar) |
| ❌ Service nicht erreichbar | aktuelle Kartenposition | `0°` | `1° × 1°` (manuell anpassbar) |

Der Upload schlägt in keinem Fall fehl – ohne erfolgreiches Solve wird das Bild an der aktuellen Kartenposition platziert und kann per Admin-Drag-&-Drop manuell korrigiert werden.

**Installation des Microservice** ist nicht Teil dieses Repositories. Kurzfassung: Ubuntu-Paket `astrometry.net` + Index-Dateien (`astrometry-data-2mass-*`, `astrometry-data-tycho2-*`), FastAPI-App unter systemd. Die Installation wird separat dokumentiert.

---

## Beispielbilder

Im Repository sind **Beispiel-Datenbankeinträge** für folgende Objekte hinterlegt:

| Objekt | Bezeichnung |
|---|---|
| M42 | Orion Nebula |
| B33 | Horsehead Nebula |
| M45 | Pleiades |
| M31 | Andromeda Galaxy |
| M33 | Triangulum Galaxy |
| M1 | Crab Nebula |
| M51 | Whirlpool Galaxy |

> **Hinweis:** Die zugehörigen Bilddateien (`orion_nebula.jpg` etc.) sind **nicht** im Repository enthalten. Lege eigene Aufnahmen mit diesen Dateinamen im `images/`-Verzeichnis ab oder lade sie über den Admin-Modus hoch – die Datenbank-Einträge werden dann automatisch damit verknüpft.

---

## Nutzung

### Normalmodus

- Karte navigieren per Maus/Touch (ziehen, scrollen, pinchen)
- Objekt-Marker anklicken → Infopanel öffnet sich rechts
- Zoom rein → Marker wechseln automatisch zum Bild-Overlay (≤ 15° FOV)
- **☰ Liste**-Button (oben rechts) → Modal mit allen Aufnahmen
  - Spalten per Klick sortierbar (Sortierung bleibt zwischen Öffnen/Schließen erhalten)
  - **⎔ Springen**-Button → zentriert und zoomt auf das Objekt
- **SIMBAD-Panel** (unten rechts) → zeigt das Objekt unter dem Fadenkreuz
  - Kollabiert: nächstes Objekt als Pill, Pfeil zum Aufklappen
  - Aufgeklappt: Liste der nächsten Objekte mit Typ und Distanz; Klick → zentrieren

### Admin-Modus

1. Oben rechts **⚙ Admin** anklicken
2. Passwort eingeben
3. Bild per Upload-Formular hochladen (Name + Datei)
   - ⏳ Während der Upload läuft, wird versucht, das Bild zu solven (bis zu 2 min)
   - ✅ Bei Erfolg wird die Karte automatisch auf das gelöste Bild zentriert
4. Im Overlay:
   - **Körper ziehen** → RA/Dec verschieben
   - **Ecken ziehen** → FOV-Breite/-Höhe anpassen
   - **Oranger Handle** → Rotation
5. Änderungen werden automatisch per `PATCH` gespeichert

---

## API-Endpunkte

| Methode | Pfad | Parameter | Beschreibung |
|---|---|---|---|
| `GET` | `/api/images.php?all=1` | – | Alle Bilder |
| `GET` | `/api/images.php` | `ra_min`, `ra_max`, `dec_min`, `dec_max` | Bilder im Sichtbereich |
| `POST` | `/api/images.php` | `object_name`, `image` (File), optional `ra`, `dec` | Bild hochladen (+ Plate Solve) |
| `PATCH` | `/api/images.php` | JSON: `id`, `ra`, `dec`, `rotation`, `fov_width`, `fov_height` | Position updaten |
| `DELETE` | `/api/images.php?id=X` | – | Bild + Datei löschen |
| `POST` | `/api/auth.php` | JSON: `password` | Admin-Login |
| `DELETE` | `/api/auth.php` | – | Admin-Logout |

### POST-Antwort beim Upload

```json
{
  "success": true,
  "plate_solved": true,
  "solve_msg": "",
  "image": {
    "id": 42,
    "object_name": "M42",
    "filename": "img_xyz.jpg",
    "ra": 83.8221,
    "dec": -5.3911,
    "fov_width": 0.7204,
    "fov_height": 1.2808,
    "rotation": 12.34,
    "description": "",
    "captured_at": "2025-04-24"
  }
}
```

Bei `plate_solved: false` enthält `solve_msg` die Meldung aus dem Solver (z. B. `"Kein Match gefunden"`), und `ra`/`dec` entsprechen der vom Frontend mitgeschickten Kartenposition.

---

## Externe Dienste

Sky Atlas nutzt zur Laufzeit folgende externe Dienste:

- **CDS SIMBAD TAP** (`simbad.cds.unistra.fr`) – für die Live-Objektidentifikation. Abfragen sind auf 6 Queries/Sekunde begrenzt (SIMBAD-Richtlinie); das Frontend debounced und bricht laufende Anfragen per `AbortController` ab.
- **Aladin Lite Tile-Server** (CDS) – für Himmelshintergrund-Bilddaten

Keine Accounts, keine API-Keys erforderlich.

---

## Sicherheitshinweise

- `api/config.php` enthält Zugangsdaten – **niemals** in öffentliche Repositories committen. In `.gitignore` aufnehmen:
  ```
  api/config.php
  images/
  ```
- Der Admin-Zugang ist durch bcrypt und serverseitige Sessions gesichert. Für Produktivumgebungen wird HTTPS empfohlen.
- Upload-Verzeichnis sollte nicht direkt per PHP ausführbar sein (z. B. per `.htaccess` `php_flag engine off` absichern).
- Der Plate-Solver-Microservice bindet ausschließlich an `127.0.0.1` – Zugriff von außen ist nicht möglich.

---

## Lizenz

MIT – Details siehe [LICENSE](LICENSE).

---

## Credits

- [Aladin Lite v3](https://aladin.cds.unistra.fr/AladinLite/) – CDS Strasbourg
- [SIMBAD Astronomical Database](https://simbad.cds.unistra.fr/simbad/) – CDS Strasbourg
- [Astrometry.net](https://astrometry.net/) – Dustin Lang et al. (Plate Solving)
