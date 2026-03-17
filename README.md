# ✦ Sky Atlas

Ein interaktiver Himmelskarten-Viewer auf Basis von **Aladin Lite v3**, mit dem du eigene Astrofotoaufnahmen direkt auf die Himmelskarte legen, positionieren und verwalten kannst.

![Sky Atlas Screenshot](docs/screenshot.png)

---

## Features

- 🌌 **Aladin Lite v3** als Kartengrundlage (DSS, 2MASS, u.v.m.)
- 🖼️ **Eigene Bilder als Overlay** – positionierbar per RA/Dec, skalierbar und rotierbar
- 🔀 **Zwei Ansichtsmodi**
  - `FOV > Schwellwert` → Catalog-Marker (oranges Kreuz) für alle Objekte
  - `FOV ≤ Schwellwert` → SVG-Bild-Overlay, präzise via `world2pix` platziert
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
php -r "echo password_verify('DEIN_PASSWORT', PASSWORD_BCRYPT) . PHP_EOL;"
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
- Zoom rein → Marker wechseln automatisch zum Bild-Overlay

### Admin-Modus

1. Oben rechts **⚙ Admin** anklicken
2. Passwort eingeben
3. Bild per Upload-Formular hochladen (Name + Datei)
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
| `POST` | `/api/images.php` | `object_name`, `image` (File), optional `ra`, `dec` | Bild hochladen |
| `PATCH` | `/api/images.php` | JSON: `id`, `ra`, `dec`, `rotation`, `fov_width`, `fov_height` | Position updaten |
| `DELETE` | `/api/images.php?id=X` | – | Bild + Datei löschen |
| `POST` | `/api/auth.php` | JSON: `password` | Admin-Login |
| `DELETE` | `/api/auth.php` | – | Admin-Logout |

---

## Sicherheitshinweise

- `api/config.php` enthält Zugangsdaten – **niemals** in öffentliche Repositories committen. In `.gitignore` aufnehmen:
  ```
  api/config.php
  images/
  ```
- Der Admin-Zugang ist durch bcrypt und serverseitige Sessions gesichert. Für Produktivumgebungen wird HTTPS empfohlen.
- Upload-Verzeichnis sollte nicht direkt per PHP ausführbar sein (z. B. per `.htaccess` `php_flag engine off` absichern).

---

## Lizenz

MIT – Details siehe [LICENSE](LICENSE).

---

## Credits

- [Aladin Lite v3](https://aladin.cds.unistra.fr/AladinLite/) – CDS Strasbourg
