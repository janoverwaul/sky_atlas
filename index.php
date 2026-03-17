<?php
/**
 * Sky Atlas – index.php
 * Himmelsansicht mit eigenem Bild-Overlay via Aladin Lite v3.
 *
 * Modi:
 *  FOV > OVERLAY_MAX_FOV  → Aladin-Catalog-Marker (oranges Kreuz)
 *  FOV ≤ OVERLAY_MAX_FOV  → SVG-Bild-Overlay, positioniert per world2pix
 */
?>
<!DOCTYPE html>
<html lang="de">
	<head>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, height=device-height, initial-scale=1.0, user-scalable=no">
		<title>Sky Atlas</title>
		<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='6' fill='%230a0a18'/><circle cx='16' cy='16' r='12' fill='%230d1535' stroke='%232a55c4' stroke-width='1.5'/><ellipse cx='16' cy='16' rx='12' ry='3.5' fill='none' stroke='%231e3a7a' stroke-width='0.8'/><line x1='16' y1='4' x2='16' y2='28' stroke='%231e3a7a' stroke-width='0.8'/><circle cx='10' cy='11' r='1.2' fill='%23e8f0ff'/><circle cx='21' cy='9' r='0.9' fill='%23c8d8ff'/><circle cx='23' cy='19' r='1.4' fill='%23f0f4ff'/><circle cx='9' cy='21' r='1' fill='%23d0dcff'/><circle cx='18' cy='24' r='0.8' fill='%23b8c8ff'/><polygon points='16,9.5 16.8,11.8 19.2,11.8 17.2,13.2 18,15.5 16,14.1 14,15.5 14.8,13.2 12.8,11.8 15.2,11.8' fill='%23f0a040'/></svg>">
		<script src="https://aladin.cds.unistra.fr/AladinLite/api/v3/latest/aladin.js" charset="utf-8"></script>
		<link rel="stylesheet" href="static/css/style.css">
		<script src="static/js/script.js" defer></script>
	</head>
	<body>
		<div id="header">
			<h1>✦ Sky <span>Atlas</span></h1>
			<span class="stat-pill" id="pill-total">— Objekte</span>
			<span class="stat-pill" id="pill-visible">— sichtbar</span>
			<label id="opacity-wrap" title="Overlay-Transparenz">
				<input type="range" id="opacity-slider" min="0" max="100" value="75">
				<span id="opacity-val">75%</span>
			</label>
			<button id="admin-btn" title="Admin-Modus">⚙ Admin</button>
			<button id="admin-logout-btn" style="display:none">↩ Logout</button>
			
			<a class="github-link" href="https://github.com/janoverwaul/sky_atlas" target="_blank" rel="noopener" title="GitHub">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
					<path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"/>
				</svg>
				GitHub
			</a>

			<span id="status-text">Initialisierung…</span>
		</div>

		<div id="map-wrap">
			<div id="aladin-lite-div"></div>
			<svg id="sky-overlay" xmlns="http://www.w3.org/2000/svg"></svg>
			<div id="fov-badge">FOV: –</div>
			<div id="mode-badge" class="mode-markers">◉ Marker</div>
			<div id="debug-log"></div>
		</div>

		<div id="info-panel">
			<button id="info-close" title="Schließen">✕</button>
			<h2 id="info-title">–</h2>
			<div class="info-meta" id="info-meta">–</div>
			<img id="info-img" src="" alt="">
			<div class="info-desc" id="info-desc">–</div>
		</div>

		<!-- Login-Modal -->
		<div id="admin-login-modal">
			<div class="admin-modal-box">
				<h3>🔐 Admin-Zugang</h3>
				<input type="password" id="admin-pass-input" placeholder="Passwort" autocomplete="current-password">
				<div id="admin-login-error"></div>
				<div class="admin-modal-actions">
					<button id="admin-login-submit">Anmelden</button>
					<button id="admin-login-cancel">Abbrechen</button>
				</div>
			</div>
		</div>

		<!-- Admin-Panel (Sidebar) -->
		<div id="admin-panel">
			<div class="admin-section">
				<h3>＋ Bild hinzufügen</h3>
				<input type="text" id="upload-name" placeholder="Objektname (z.B. M42)">
				<input type="file" id="upload-file" accept="image/*">
				<button id="upload-submit" class="admin-btn-primary">Hochladen</button>
				<div id="upload-status"></div>
			</div>
			<div class="admin-section" id="admin-selected-section" style="display:none">
				<h3>✎ Ausgewählt</h3>
				<div class="admin-selected-title" id="admin-selected-title">–</div>
				<div class="admin-selected-info"  id="admin-selected-info">–</div>
				<button id="admin-delete-btn" class="btn-danger">🗑 Löschen</button>
			</div>
			<div class="admin-section">
				<h3>💡 Tipps</h3>
				<div class="admin-tips">
					<p>🖱️ Bild klicken → auswählen</p>
					<p>⊹ Körper ziehen → Position (RA/Dec)</p>
					<p>🟦 Ecken ziehen → FOV-Größe</p>
					<p>🟠 Handle → Rotation</p>
					<p>Änderungen werden automatisch gespeichert</p>
				</div>
			</div>
		</div>

		<!-- Speicher-Indikator -->
		<div id="save-indicator" style="display:none"></div>
	</body>
</html>
