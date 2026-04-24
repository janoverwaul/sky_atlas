// ── Config ────────────────────────────────────────────────────────────────────
const API_URL         = 'api/images.php';
const IMAGES_DIR      = 'images/';
const OVERLAY_MAX_FOV = 15;
const MARKER_SMALL_FOV = 30;
const PAN_SPEED       = 2.0;
const SAVE_DEBOUNCE_MS = 500;

// ── State ─────────────────────────────────────────────────────────────────────
let aladin        = null;
let allImages     = [];
let currentMode   = 'markers';
let currentMarkerSize = null;
let aladinCatalog = null;
let isPanning     = false;
let adminMode     = false;
let selectedImgId = null;

const overlayCache = new Map();
const saveTimers   = new Map();

const skyOverlay = document.getElementById('sky-overlay');
const aladinDiv  = document.getElementById('aladin-lite-div');

// ── Init ──────────────────────────────────────────────────────────────────────
A.init.then(() => {
	aladin = A.aladin('#aladin-lite-div', {
		survey:                   'P/DSS2/color',
		projection:               'SIN',
		fov:                      220,
		target:                   '03 32 54.03 +14 27 41.5',
		cooFrame:                 'icrs',
		showCooGridControl:       true,
		showSimbadPointerControl: true,
		showCooGrid:              true,
		reticleColor:             '#5b9cf6',
		reticleSize:              24,
	});

	fetchAllImages().then(() => {
		setupAladinListeners();
		setupFastPan();
		update();
		scheduleSimbad();
	});
});

async function submitAdminLogin() {
    const pw  = document.getElementById('admin-pass-input').value;
    const err = document.getElementById('admin-login-error');
    try {
        const res  = await fetch('api/auth.php', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ password: pw }),
        });
        const data = await res.json();
        if (data.success) {
            hideLoginModal();
            enterAdminMode();
        } else {
            err.textContent = 'Falsches Passwort';
            document.getElementById('admin-pass-input').select();
        }
    } catch (e) {
        err.textContent = 'Login-Fehler: ' + e.message;
    }
}

// Sky-Overlay Klick (Normal: Info-Panel | Admin: Selektion)
document.getElementById('sky-overlay').addEventListener('click', (e) => {
	const border = e.target.closest('.img-border');
	if (!border || !border.dataset.imgId) return;
	const img = allImages.find(i => String(i.id) === String(border.dataset.imgId));
	if (!img) return;
	e.stopPropagation();
	if (adminMode) {
		selectedImgId = String(img.id);
		renderAdminHandles();
		updateAdminPanel(img);
	} else {
		showInfoPanel(img);
	}
});

// Wheel IMMER an das tatsächlich darunterliegende Aladin-Element weiterleiten
skyOverlay.addEventListener('wheel', (e) => {
    // SVG kurz für hit-testing transparent schalten
    const prev = skyOverlay.style.pointerEvents;
    skyOverlay.style.pointerEvents = 'none';
    const under = document.elementFromPoint(e.clientX, e.clientY);
    skyOverlay.style.pointerEvents = prev;

    if (!under || !aladinDiv.contains(under)) return;

    e.preventDefault();

    // Vollständiger WheelEvent – Properties müssen EXPLIZIT gesetzt werden,
    // `new WheelEvent('wheel', e)` kopiert sie NICHT.
    under.dispatchEvent(new WheelEvent('wheel', {
        deltaX:    e.deltaX,
        deltaY:    e.deltaY,
        deltaZ:    e.deltaZ,
        deltaMode: e.deltaMode,
        clientX:   e.clientX,
        clientY:   e.clientY,
        screenX:   e.screenX,
        screenY:   e.screenY,
        ctrlKey:   e.ctrlKey,
        shiftKey:  e.shiftKey,
        altKey:    e.altKey,
        metaKey:   e.metaKey,
        bubbles:    true,
        cancelable: true,
        composed:   true,
        view:       window,
    }));
}, { passive: false });

skyOverlay.addEventListener('mousedown', (e) => {
	if (adminMode) return; // Admin-Modus: Drag wird in bindDrag gehandelt
	if (e.button === 2) return;
	aladinDiv.dispatchEvent(new MouseEvent('mousedown', e));
});

// Info-Panel schließen
document.getElementById('info-close').addEventListener('click', () => {
	document.getElementById('info-panel').classList.remove('visible');
});

// Klick auf Aladin-Div: Info-Panel schließen / Admin-Selektion aufheben
document.getElementById('aladin-lite-div').addEventListener('click', () => {
	if (adminMode) {
		selectedImgId = null;
		clearAdminHandles();
		document.getElementById('admin-selected-section').style.display = 'none';
		return;
	}
	document.getElementById('info-panel').classList.remove('visible');
});

// Opacity-Slider
const slider  = document.getElementById('opacity-slider');
const valSpan = document.getElementById('opacity-val');
const svgEl   = document.getElementById('sky-overlay');
const applyOpacity = (v) => { svgEl.style.opacity = v / 100; valSpan.textContent = v + '%'; };
applyOpacity(slider.value);
slider.addEventListener('input', () => applyOpacity(slider.value));

// Admin-Buttons
document.getElementById('admin-btn').addEventListener('click', () => {
	if (!adminMode) showLoginModal();
});
document.getElementById('admin-logout-btn').addEventListener('click', exitAdminMode);

// Login-Modal
document.getElementById('admin-login-submit').addEventListener('click', submitAdminLogin);
document.getElementById('admin-login-cancel').addEventListener('click', hideLoginModal);
document.getElementById('admin-pass-input').addEventListener('keydown', (e) => {
	if (e.key === 'Enter')  submitAdminLogin();
	if (e.key === 'Escape') hideLoginModal();
});

// Upload & Delete
document.getElementById('upload-submit').addEventListener('click', handleUpload);
document.getElementById('admin-delete-btn').addEventListener('click', () => {
	if (selectedImgId) adminDeleteImage(selectedImgId);
});


// ── API ───────────────────────────────────────────────────────────────────────
async function fetchAllImages() {
	try {
		const res  = await fetch(API_URL + '?all=1');
		const data = await res.json();
		allImages  = data.images || [];
		document.getElementById('pill-total').textContent = allImages.length + ' Objekte';
		setStatus('Katalog: ' + allImages.length + ' Bilder');
	} catch (e) {
		setStatus('API-Fehler: ' + e.message);
	}
}

// ── Listeners ─────────────────────────────────────────────────────────────────
function setupAladinListeners() {
	let rafId = null;
	const scheduleUpdate = () => {
		if (rafId) cancelAnimationFrame(rafId);
		rafId = requestAnimationFrame(() => { rafId = null; update(); });
	};
	aladin.on('zoomChanged', scheduleUpdate);
	new ResizeObserver(scheduleUpdate).observe(document.getElementById('aladin-lite-div'));
	aladin.on('positionChanged', () => {
		if (!isPanning) scheduleUpdate();
	});
	aladin.on('zoomChanged', () => {
		scheduleUpdate();
		scheduleSimbad();        // ← NEU
	});
	new ResizeObserver(scheduleUpdate).observe(document.getElementById('aladin-lite-div'));
	aladin.on('positionChanged', () => {
		if (!isPanning) scheduleUpdate();
		scheduleSimbad();        // ← NEU
	});
}

// ── Update ────────────────────────────────────────────────────────────────────
function update() {
	const fov = aladin.getFov()[0];
	document.getElementById('fov-badge').textContent = 'FOV: ' + fov.toFixed(2) + '°';

	if (fov > OVERLAY_MAX_FOV) {
		if (currentMode !== 'markers') { currentMode = 'markers'; setModeBadge('markers'); }
		renderMarkers();
	} else {
		if (currentMode !== 'overlay') { currentMode = 'overlay'; setModeBadge('overlay'); }
		renderOverlays();
	}
}

// ── Marker-Modus ──────────────────────────────────────────────────────────────
function renderMarkers() {
	document.getElementById('sky-overlay').style.display = 'none';

	const fov        = aladin.getFov()[0];
	const sourceSize = fov > MARKER_SMALL_FOV ? 10 : 18;

	// Katalog nur neu aufbauen, wenn Größe sich geändert hat
	// (aladinCatalog === null → wurde von renderOverlays entfernt → neu bauen)
	if (aladinCatalog && currentMarkerSize === sourceSize) {
		document.getElementById('pill-visible').textContent = allImages.length + ' Marker';
		return;
	}

	if (aladinCatalog) {
		try { aladin.removeLayer(aladinCatalog); } catch(e) {}
		aladinCatalog = null;
	}

	currentMarkerSize = sourceSize;

	aladinCatalog = A.catalog({
		name:       'Meine Aufnahmen',
		sourceSize,
		color:      '#f0a040',
		onClick:    'showPopup',
		shape:      'cross',
	});
	aladin.addCatalog(aladinCatalog);

	const sources = allImages.map(img =>
		A.source(img.ra, img.dec, { name: img.object_name, description: buildPopupHTML(img) })
	);
	aladinCatalog.addSources(sources);
	document.getElementById('pill-visible').textContent = sources.length + ' Marker';
	dbg(`● Marker-Modus  (${sources.length} Quellen, size=${sourceSize}px, FOV=${fov.toFixed(1)}°)`);
}

// ── Overlay-Modus ─────────────────────────────────────────────────────────────
function renderOverlays() {
	if (aladinCatalog) {
		try { aladin.removeLayer(aladinCatalog); } catch(e) {}
		aladinCatalog = null;
	}

	const svg = document.getElementById('sky-overlay');
	svg.style.display = '';

	const el = document.getElementById('aladin-lite-div');
	const W  = el.clientWidth;
	const H  = el.clientHeight;
	svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
	svg.setAttribute('width',   W);
	svg.setAttribute('height',  H);

	const fov       = aladin.getFov();
	const pxPerDegW = W / fov[0];
	const pxPerDegH = H / fov[1];
	let   visible   = 0;
	const dbgLines  = [`Overlay  FOV=${fov[0].toFixed(2)}°  ${W}×${H}px  px/°=${pxPerDegW.toFixed(1)}`];

	for (const img of allImages) {
		const key    = String(img.id);
		const center = aladin.world2pix(img.ra, img.dec);
		const imgW   = parseFloat(img.fov_width)  * pxPerDegW;
		const imgH   = parseFloat(img.fov_height) * pxPerDegH;

		dbgLines.push(
			img.object_name.substring(0, 10).padEnd(10) +
			'  ' + (center ? `px=(${Math.round(center[0])},${Math.round(center[1])})  ${Math.round(imgW)}×${Math.round(imgH)}px` : 'world2pix=null')
		);

		if (!center) { setGroupVisible(key, false); continue; }

		const pad = Math.max(imgW, imgH) * 0.5 + 50;
		if (center[0] < -pad || center[0] > W + pad || center[1] < -pad || center[1] > H + pad) {
			setGroupVisible(key, false);
			continue;
		}

		let g = overlayCache.get(key);
		if (!g) {
			g = createSVGGroup(img);
			overlayCache.set(key, g);
		}
		if (g.parentNode !== svg) svg.appendChild(g);

		const x = center[0] - imgW / 2;
		const y = center[1] - imgH / 2;
		updateSVGGroup(g, img, x, y, imgW, imgH, center[0], center[1]);
		setGroupVisible(key, true);
		visible++;
	}

	document.getElementById('pill-visible').textContent = visible + ' sichtbar';
	setStatus(visible > 0 ? '' : 'Keine Bilder in diesem Bereich');

	// Admin-Handles nach jedem Render neu zeichnen (Zoom/Pan)
	if (adminMode) renderAdminHandles();
	const hl = document.getElementById('admin-handles-layer');
	if (hl && hl.parentNode) hl.parentNode.appendChild(hl);

	dbg(dbgLines.join('\n'));
}

// ── SVG Gruppe erstellen ──────────────────────────────────────────────────────
function createSVGGroup(img) {
	const ns = 'http://www.w3.org/2000/svg';
	const g  = document.createElementNS(ns, 'g');
	g.setAttribute('class', 'sky-img-group');

	const image = document.createElementNS(ns, 'image');
	image.setAttribute('preserveAspectRatio', 'none');
	image.setAttribute('class', 'sky-img');
	image.setAttribute('href', IMAGES_DIR + img.filename);

	const fallback = document.createElementNS(ns, 'rect');
	fallback.setAttribute('class', 'sky-img-fallback');
	fallback.setAttribute('fill',         'rgba(40,60,120,0.45)');
	fallback.setAttribute('stroke',       'rgba(91,156,246,0.6)');
	fallback.setAttribute('stroke-width', '1');
	fallback.setAttribute('rx', '2');
	fallback.style.display = 'none';

	image.addEventListener('error', () => { image.style.display = 'none'; fallback.style.display = ''; });
	image.addEventListener('load',  () => { fallback.style.display = 'none'; });

	const border = document.createElementNS(ns, 'rect');
	border.setAttribute('class', 'img-border');
	border.setAttribute('rx', '3');
	border.dataset.imgId = img.id;
	border.setAttribute('pointer-events', 'stroke');
	border.setAttribute('fill', 'transparent');

	const label = document.createElementNS(ns, 'text');
	label.setAttribute('class',       'sky-img-label');
	label.setAttribute('text-anchor', 'middle');
	label.setAttribute('fill',        'rgba(200,216,248,0.85)');
	label.setAttribute('font-size',   '11');
	label.setAttribute('font-family', 'system-ui, sans-serif');
	label.textContent = img.object_name;

	g.appendChild(image);
	g.appendChild(fallback);
	g.appendChild(border);
	g.appendChild(label);
	return g;
}

// ── SVG Gruppe aktualisieren ──────────────────────────────────────────────────
function updateSVGGroup(g, img, x, y, w, h, cx, cy) {
	const rot        = parseFloat(img.rotation) || 0;
	const northAngle = getCelestialNorthAngle(img.ra, img.dec);
	const screenRot  = rot + northAngle;

	g.setAttribute('transform', `rotate(${screenRot}, ${cx}, ${cy})`);
	g.setAttribute('data-cx',    cx);
	g.setAttribute('data-cy',    cy);
	g.setAttribute('data-bx',    cx);
	g.setAttribute('data-by',    cy);
	g.setAttribute('data-img-x', x);
	g.setAttribute('data-img-y', y);
	g.setAttribute('data-rot',   rot); // himmels-PA, für Debugging

	for (const el of [g.querySelector('.sky-img'), g.querySelector('.sky-img-fallback'), g.querySelector('.img-border')]) {
		el.setAttribute('x', x);
		el.setAttribute('y', y);
		el.setAttribute('width',  w);
		el.setAttribute('height', h);
	}
	const label = g.querySelector('.sky-img-label');
	label.setAttribute('x', cx);
	label.setAttribute('y', y + h + 14);
	label.style.display = w > 60 ? '' : 'none';
}

function setGroupVisible(key, vis) {
	const g = overlayCache.get(key);
	if (g) g.style.display = vis ? '' : 'none';
}

// ── Info panel ────────────────────────────────────────────────────────────────
function showInfoPanel(img) {
	document.getElementById('info-title').textContent = img.object_name;
	document.getElementById('info-meta').textContent  =
		(img.captured_at ? img.captured_at + ' · ' : '') +
		`RA ${parseFloat(img.ra).toFixed(4)}°  Dec ${parseFloat(img.dec).toFixed(4)}°  ·  ` +
		`FOV ${img.fov_width}° × ${img.fov_height}°`;
	document.getElementById('info-desc').textContent = img.description || '–';
	const imgEl = document.getElementById('info-img');
	imgEl.src = IMAGES_DIR + img.filename;
	imgEl.style.display = 'block';
	imgEl.onerror = () => { imgEl.style.display = 'none'; };
	document.getElementById('info-panel').classList.add('visible');
}

// ── Popup HTML für Marker ─────────────────────────────────────────────────────
function buildPopupHTML(img) {
	const desc = img.description ? `<div style="font-size:11px;margin-top:4px">${img.description}</div>` : '';
	return `<div style="max-width:220px">
		<img src="${IMAGES_DIR}${img.filename}" style="width:100%;border-radius:4px;margin-bottom:6px" onerror="this.style.display='none'">
		<div style="font-size:11px;color:#8899bb">${img.captured_at ?? ''}</div>${desc}
	</div>`;
}

// ── Fast Pan ──────────────────────────────────────────────────────────────────
function setupFastPan() {
    const div = document.getElementById('aladin-lite-div');
    const svg = document.getElementById('sky-overlay');

    let startX = 0, startY = 0, startRa = 0, startDec = 0;

    div.addEventListener('mousedown', (e) => {
        if (adminMode) return;
        if (e.button !== 0) return;

        isPanning = true;
        startX = e.clientX;
        startY = e.clientY;

        const pos = aladin.getRaDec();
        startRa  = pos[0];
        startDec = pos[1];

        e.stopPropagation();
    }, true);

    window.addEventListener('mousemove', (e) => {
        if (!isPanning) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        const fov      = aladin.getFov();
        const deltaRa  = dx / div.clientWidth  * fov[0] * PAN_SPEED;
        const deltaDec = dy / div.clientHeight * fov[1] * PAN_SPEED;

        const newRa  = ((startRa + deltaRa) % 360 + 360) % 360;
        const newDec = Math.max(-90, Math.min(90, startDec + deltaDec));

        aladin.gotoRaDec(newRa, newDec);

        // Overlay synchron per CSS-Transform mitbewegen — kein world2pix-Lag.
        // Aladin verschiebt den Inhalt um -dx*PAN_SPEED (steigender RA → Sterne
        // wandern nach links), das SVG muss entsprechend transformiert werden.
        if (currentMode === 'overlay') {
            svg.style.transform = `translate(${dx * PAN_SPEED}px, ${dy * PAN_SPEED}px)`;
        }
    });

    window.addEventListener('mouseup', () => {
        if (!isPanning) return;
        isPanning = false;
        svg.style.transform = '';   // Transform zurücksetzen …
        update();                   // … und einmal exakt neu rendern
    });

    svg.addEventListener('contextmenu', openAladinContextMenuFromOverlay, true);

    div.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
    }, false);
}

function openAladinContextMenuFromOverlay(e) {
	e.preventDefault();
	e.stopPropagation();

	const svg = document.getElementById('sky-overlay');
	const div = document.getElementById('aladin-lite-div');

	const oldPointerEvents = svg.style.pointerEvents;
	const oldZIndex        = svg.style.zIndex;
	const oldVisibility    = svg.style.visibility;

	svg.style.pointerEvents = 'none';
	svg.style.zIndex        = '0';
	svg.style.visibility    = 'hidden';

	const evt = new MouseEvent('contextmenu', {
		bubbles: true, cancelable: true, view: window,
		clientX: e.clientX, clientY: e.clientY,
		screenX: e.screenX, screenY: e.screenY,
		ctrlKey: e.ctrlKey, shiftKey: e.shiftKey,
		altKey:  e.altKey,  metaKey: e.metaKey,
		button: 2, buttons: 2,
	});
	div.dispatchEvent(evt);

	requestAnimationFrame(() => {
		const menus = document.querySelectorAll('.aladin-context-menu, .aladin-popup-container, .aladin-box');
		menus.forEach(menu => {
			menu.style.zIndex       = '999999';
			menu.style.pointerEvents = 'auto';
			menu.style.position     = menu.style.position || 'absolute';
		});
	});

	let restored = false;
	const restoreOverlay = () => {
		if (restored) return;
		restored = true;
		svg.style.pointerEvents = oldPointerEvents;
		svg.style.zIndex        = oldZIndex;
		svg.style.visibility    = oldVisibility;
		window.removeEventListener('mousedown',   restoreOverlay, true);
		window.removeEventListener('contextmenu', restoreOverlay, true);
		window.removeEventListener('scroll',      restoreOverlay, true);
		window.removeEventListener('blur',        restoreOverlay, true);
	};
	window.addEventListener('mousedown',   restoreOverlay, true);
	window.addEventListener('contextmenu', restoreOverlay, true);
	window.addEventListener('scroll',      restoreOverlay, true);
	window.addEventListener('blur',        restoreOverlay, true);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function setStatus(msg)  { document.getElementById('status-text').textContent = msg; }
function setModeBadge(mode) {
	const el = document.getElementById('mode-badge');
	el.textContent = mode === 'overlay' ? 'Overlay' : '◉ Marker';
	el.className   = 'mode-badge mode-' + mode;
}
function dbg(msg) { document.getElementById('debug-log').textContent = msg; }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ── Celestial North Angle ─────────────────────────────────────────────────────
// Gibt zurück, um wie viel Grad die himmels-Nord-Richtung gegenüber
// Screen-Oben (negativer Y-Achse) im Uhrzeigersinn gedreht ist.
function getCelestialNorthAngle(ra, dec) {
	const p0 = aladin.world2pix(ra, dec);
	const p1 = aladin.world2pix(ra, Math.min(dec + 0.01, 89.9));
	if (!p0 || !p1) return 0;
	// atan2(dx, −dy): Winkel von Screen-Oben, positiv = im Uhrzeigersinn
	return Math.atan2(p1[0] - p0[0], p0[1] - p1[1]) * 180 / Math.PI;
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Admin: Auth ───────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

function showLoginModal() {
	document.getElementById('admin-login-modal').classList.add('visible');
	document.getElementById('admin-pass-input').value = '';
	document.getElementById('admin-login-error').textContent = '';
	setTimeout(() => document.getElementById('admin-pass-input').focus(), 60);
}

function hideLoginModal() {
	document.getElementById('admin-login-modal').classList.remove('visible');
}

function enterAdminMode() {
    adminMode = true;
    document.getElementById('admin-btn').classList.add('active');
    document.getElementById('admin-logout-btn').style.display = '';
    document.getElementById('admin-panel').classList.add('visible');
    document.getElementById('sky-overlay').classList.add('admin-active');
    if (aladin) update(); // ← null-Guard
}

function exitAdminMode() {
	fetch('api/auth.php', { method: 'DELETE' }); 
	adminMode     = false;
	selectedImgId = null;
	clearAdminHandles();
	document.getElementById('admin-btn').classList.remove('active');
	document.getElementById('admin-logout-btn').style.display = 'none';
	document.getElementById('admin-panel').classList.remove('visible');
	document.getElementById('sky-overlay').classList.remove('admin-active');
	document.getElementById('admin-selected-section').style.display = 'none';
	update();
}

function updateAdminPanel(img) {
	document.getElementById('admin-selected-section').style.display = '';
	document.getElementById('admin-selected-title').textContent = img.object_name;
	document.getElementById('admin-selected-info').textContent =
		`RA ${parseFloat(img.ra).toFixed(4)}°  Dec ${parseFloat(img.dec).toFixed(4)}°\n` +
		`FOV ${parseFloat(img.fov_width).toFixed(3)}° × ${parseFloat(img.fov_height).toFixed(3)}°  ` +
		`Rot ${parseFloat(img.rotation || 0).toFixed(1)}°`;
}


// ══════════════════════════════════════════════════════════════════════════════
// ── Admin: Handles ────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

function getHandlesLayer() {
	const svg = document.getElementById('sky-overlay');
	let layer = document.getElementById('admin-handles-layer');
	if (!layer) {
		layer    = document.createElementNS('http://www.w3.org/2000/svg', 'g');
		layer.id = 'admin-handles-layer';
	}
	svg.appendChild(layer); // immer ganz oben
	return layer;
}

function clearAdminHandles() {
	const layer = document.getElementById('admin-handles-layer');
	if (layer) layer.innerHTML = '';
}

function renderAdminHandles() {
	clearAdminHandles();
	if (!adminMode || !selectedImgId || currentMode !== 'overlay') return;

	const img = allImages.find(i => String(i.id) === selectedImgId);
	if (!img) return;

	const divEl  = document.getElementById('aladin-lite-div');
	const fov    = aladin.getFov();
	const ppdW   = divEl.clientWidth  / fov[0];
	const ppdH   = divEl.clientHeight / fov[1];
	const center = aladin.world2pix(img.ra, img.dec);
	if (!center) return;

	const cx         = center[0];
	const cy         = center[1];
	const w          = parseFloat(img.fov_width)  * ppdW;
	const h          = parseFloat(img.fov_height) * ppdH;
	const northAngle = getCelestialNorthAngle(img.ra, img.dec);  // ← NEU
	const screenRot  = (parseFloat(img.rotation) || 0) + northAngle;  // ← NEU
	const rad        = screenRot * Math.PI / 180;  // ← war: rot * PI/180

	const ns    = 'http://www.w3.org/2000/svg';
	const layer = getHandlesLayer();

	const rotPt = (lx, ly) => ({
		x: cx + (lx - cx) * Math.cos(rad) - (ly - cy) * Math.sin(rad),
		y: cy + (lx - cx) * Math.sin(rad) + (ly - cy) * Math.cos(rad),
	});

	const sel = document.createElementNS(ns, 'rect');
	sel.setAttribute('x',      cx - w / 2);
	sel.setAttribute('y',      cy - h / 2);
	sel.setAttribute('width',  w);
	sel.setAttribute('height', h);
	sel.setAttribute('transform', `rotate(${screenRot},${cx},${cy})`);  // ← NEU
	sel.setAttribute('class', 'admin-sel-rect');
	layer.appendChild(sel);

	const body = document.createElementNS(ns, 'rect');
	body.setAttribute('x',      cx - w / 2);
	body.setAttribute('y',      cy - h / 2);
	body.setAttribute('width',  w);
	body.setAttribute('height', h);
	body.setAttribute('transform', `rotate(${screenRot},${cx},${cy})`);  // ← NEU
	body.setAttribute('fill',  'transparent');
	body.setAttribute('class', 'admin-body-drag');
	layer.appendChild(body);
	bindDrag(body, 'move', img, cx, cy, w, h, screenRot, ppdW, ppdH);  // ← NEU: screenRot

	const corners = [
		{ lx: cx - w / 2, ly: cy - h / 2, type: 'corner-tl' },
		{ lx: cx + w / 2, ly: cy - h / 2, type: 'corner-tr' },
		{ lx: cx - w / 2, ly: cy + h / 2, type: 'corner-bl' },
		{ lx: cx + w / 2, ly: cy + h / 2, type: 'corner-br' },
	];
	for (const c of corners) {
		const sp = rotPt(c.lx, c.ly);
		const el = document.createElementNS(ns, 'rect');
		el.setAttribute('x',      sp.x - 7);
		el.setAttribute('y',      sp.y - 7);
		el.setAttribute('width',  14);
		el.setAttribute('height', 14);
		el.setAttribute('rx', 2);
		el.setAttribute('class', `admin-handle admin-handle-${c.type}`);
		layer.appendChild(el);
		bindDrag(el, c.type, img, cx, cy, w, h, screenRot, ppdW, ppdH);  // ← NEU: screenRot
	}

	const rotDist = h / 2 + 32;
	const rhx     = cx + rotDist * Math.sin(rad);
	const rhy     = cy - rotDist * Math.cos(rad);
	const topC    = rotPt(cx, cy - h / 2);

	const rotLine = document.createElementNS(ns, 'line');
	rotLine.setAttribute('x1', topC.x);
	rotLine.setAttribute('y1', topC.y);
	rotLine.setAttribute('x2', rhx);
	rotLine.setAttribute('y2', rhy);
	rotLine.setAttribute('class', 'admin-rot-line');
	layer.appendChild(rotLine);

	const rotH = document.createElementNS(ns, 'circle');
	rotH.setAttribute('cx', rhx);
	rotH.setAttribute('cy', rhy);
	rotH.setAttribute('r',  8);
	rotH.setAttribute('class', 'admin-handle admin-handle-rotate');
	layer.appendChild(rotH);
	bindDrag(rotH, 'rotate', img, cx, cy, w, h, screenRot, ppdW, ppdH);  // ← NEU: screenRot

	updateAdminPanel(img);
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Admin: Drag-Logik ─────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
function bindDrag(el, type, img, cx, cy, w, h, rot, ppdW, ppdH) {
    el.addEventListener('mousedown', (e) => {
        if (!adminMode) return;
        e.stopPropagation();
        e.preventDefault();

        // ── NEU: Aladin-Div während Drag unsichtbar für Maus-Events ──────────
        const aladinEl = document.getElementById('aladin-lite-div');
        aladinEl.style.pointerEvents = 'none';
        // ─────────────────────────────────────────────────────────────────────

        const rect     = aladinEl.getBoundingClientRect(); // ← jetzt von aladinEl
        const startRot = parseFloat(img.rotation) || 0;
        const startX   = e.clientX;
        const startY   = e.clientY;
        const startAng = Math.atan2(
            (e.clientY - rect.top)  - cy,
            (e.clientX - rect.left) - cx
        ) * 180 / Math.PI;
        const invRad = -rot * Math.PI / 180;
		const rad    =  rot * Math.PI / 180;

        const onMove = (me) => {
            const mx = me.clientX - rect.left;
            const my = me.clientY - rect.top;

            if (type === 'move') {
                const coords = aladin.pix2world(cx + (me.clientX - startX), cy + (me.clientY - startY));
                if (coords) { img.ra = coords[0]; img.dec = coords[1]; img.declination = coords[1];}
			} else if (type.startsWith('corner')) {
				// Gegenüberliegende (fixe) Ecke in lokalem (un-rotierten) Raum
				const fixedLocal = {
					'corner-tl': { lx: cx + w / 2, ly: cy + h / 2 },
					'corner-tr': { lx: cx - w / 2, ly: cy + h / 2 },
					'corner-bl': { lx: cx + w / 2, ly: cy - h / 2 },
					'corner-br': { lx: cx - w / 2, ly: cy - h / 2 },
				}[type];

				// Mausposition → lokaler un-rotierter Raum (relativ zum originalen Zentrum)
				const lx = cx + (mx - cx) * Math.cos(invRad) - (my - cy) * Math.sin(invRad);
				const ly = cy + (mx - cx) * Math.sin(invRad) + (my - cy) * Math.cos(invRad);

				// Neue Größe = Abstand zwischen gezogener und fixer Ecke
				const newW = Math.max(0.01 * ppdW, Math.abs(lx - fixedLocal.lx));
				const newH = Math.max(0.01 * ppdH, Math.abs(ly - fixedLocal.ly));

				// Neues Zentrum = Mittelpunkt der beiden Ecken (lokal → Screen)
				const newLCx = (lx + fixedLocal.lx) / 2;
				const newLCy = (ly + fixedLocal.ly) / 2;
				const newScreenCx = cx + (newLCx - cx) * Math.cos(rad) - (newLCy - cy) * Math.sin(rad);
				const newScreenCy = cy + (newLCx - cx) * Math.sin(rad) + (newLCy - cy) * Math.cos(rad);

				// Neues RA/Dec aus dem verschobenen Zentrum
				const coords = aladin.pix2world(newScreenCx, newScreenCy);
				if (coords) { img.ra = coords[0]; img.dec = coords[1]; img.declination = coords[1];}

				img.fov_width  = newW / ppdW;
				img.fov_height = newH / ppdH;
			} else if (type === 'rotate') {
                const curAng = Math.atan2(my - cy, mx - cx) * 180 / Math.PI;
                img.rotation = ((startRot + (curAng - startAng)) % 360 + 360) % 360;
            }

            renderOverlays();
            scheduleSave(img);
        };

        const onUp = () => {
            // ── NEU: Aladin wieder aktivieren ─────────────────────────────────
            aladinEl.style.pointerEvents = '';
            // ─────────────────────────────────────────────────────────────────
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup',   onUp);
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup',   onUp);
    });
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Admin: Auto-Save ──────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

function scheduleSave(img) {
	const id = String(img.id);
	if (saveTimers.has(id)) clearTimeout(saveTimers.get(id));
	setSaveIndicator('saving');
	saveTimers.set(id, setTimeout(async () => {
		saveTimers.delete(id);
		try {
			const res  = await fetch(API_URL, {
				method:  'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body:    JSON.stringify({
					id:         img.id,
					ra:         img.ra,
					dec:        img.dec,
					rotation:   img.rotation,
					fov_width:  img.fov_width,
					fov_height: img.fov_height,
				}),
			});
			const data = await res.json();
			setSaveIndicator(data.success ? 'saved' : 'error');
		} catch {
			setSaveIndicator('error');
		}
	}, SAVE_DEBOUNCE_MS));
}

function setSaveIndicator(state) {
	const el = document.getElementById('save-indicator');
	el.className   = 'save-indicator ' + state;
	el.textContent = { saving: '⏳ Speichern…', saved: '✓ Gespeichert', error: '✗ Fehler' }[state];
	el.style.display = '';
	if (state === 'saved') setTimeout(() => { el.style.display = 'none'; }, 2000);
}


// ══════════════════════════════════════════════════════════════════════════════
// ── Admin: Upload & Delete ────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

async function handleUpload() {
    const name = document.getElementById('upload-name').value.trim();
    const file = document.getElementById('upload-file').files[0];
    const stat = document.getElementById('upload-status');

    if (!name || !file) { stat.textContent = 'Name und Datei erforderlich.'; return; }

    const pos = aladin.getRaDec();
    const fd  = new FormData();
    fd.append('object_name', name);
    fd.append('ra',  pos[0]);   // Fallback-Position
    fd.append('dec', pos[1]);
    fd.append('image', file);

    // Solving kann 30–120 s dauern → Nutzer informieren
    stat.innerHTML = '<span style="color:#f0a040">⏳ Plate Solving läuft… (bis zu 2 min)</span>';
    document.getElementById('upload-submit').disabled = true;

    try {
        const res  = await fetch(API_URL, { method: 'POST', body: fd });
        const data = await res.json();

        if (!data.success) {
            stat.textContent = '✗ ' + (data.error || 'Fehler');
            return;
        }

        // Bild in lokale Liste aufnehmen
        // images.php liefert 'dec' noch nicht direkt – Alias setzen
        data.image.dec = data.image.dec ?? data.image.declination;
        allImages.push(data.image);
        document.getElementById('pill-total').textContent = allImages.length + ' Objekte';

        // Cache-Eintrag für altes SVG-Objekt entfernen (frische Darstellung)
        overlayCache.delete(String(data.image.id));

        // Upload-Felder zurücksetzen
        document.getElementById('upload-name').value = '';
        document.getElementById('upload-file').value = '';

        if (data.plate_solved) {
            stat.innerHTML =
                `✓ <strong>${data.image.object_name}</strong> gelöst – ` +
                `RA ${parseFloat(data.image.ra).toFixed(3)}°  ` +
                `Dec ${parseFloat(data.image.dec).toFixed(3)}°  ` +
                `FOV ${parseFloat(data.image.fov_width).toFixed(3)}° × ` +
                `${parseFloat(data.image.fov_height).toFixed(3)}°`;

            // Karte zur Bildmitte navigieren, FOV = 3× die längere Bildseite
            const targetFov = Math.max(
                parseFloat(data.image.fov_width),
                parseFloat(data.image.fov_height)
            ) * 3;

            aladin.gotoRaDec(parseFloat(data.image.ra), parseFloat(data.image.dec));
            aladin.setFov(targetFov);

        } else {
            stat.innerHTML =
                `✓ <strong>${data.image.object_name}</strong> hinzugefügt` +
                (data.solve_msg
                    ? ` <span style="color:#8b949e;font-size:.85em">(kein Plate-Solve: ${data.solve_msg.substring(0, 80)})</span>`
                    : '');
        }

        // Auswahl auf neues Bild setzen und Karte aktualisieren
        selectedImgId = String(data.image.id);
        update();

    } catch (err) {
        stat.textContent = '✗ Upload-Fehler: ' + err.message;
    } finally {
        document.getElementById('upload-submit').disabled = false;
    }
}

async function adminDeleteImage(imgId) {
    const img = allImages.find(i => String(i.id) === String(imgId));
    if (!confirm(`"${img?.object_name ?? imgId}" wirklich löschen?\nDiese Aktion kann nicht rückgängig gemacht werden.`)) return;

    try {
        const res  = await fetch(API_URL + '?id=' + imgId, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            // SVG-Element direkt aus dem DOM entfernen
            const g = overlayCache.get(String(imgId));
            if (g && g.parentNode) g.parentNode.removeChild(g);

            overlayCache.delete(String(imgId));
            allImages     = allImages.filter(i => String(i.id) !== String(imgId));
            selectedImgId = null;
            clearAdminHandles();
            document.getElementById('admin-selected-section').style.display = 'none';
            document.getElementById('pill-total').textContent = allImages.length + ' Objekte';
            update();
        } else {
            setStatus('Fehler: ' + (data.error || 'Unbekannt'));
        }
    } catch (err) {
        setStatus('Lösch-Fehler: ' + err.message);
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Objekt-Liste Modal ────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

// Sort-State bleibt über Modal-Öffnen/Schließen hinweg bestehen
let listSortCol = 'object_name';
let listSortDir = 'asc';

// Button-Listener
document.getElementById('list-btn').addEventListener('click', showListModal);
document.getElementById('list-close').addEventListener('click', hideListModal);

// Klick auf Modal-Hintergrund schließt
document.getElementById('list-modal').addEventListener('click', (e) => {
	if (e.target.id === 'list-modal') hideListModal();
});

// Escape schließt
window.addEventListener('keydown', (e) => {
	if (e.key === 'Escape' && document.getElementById('list-modal').classList.contains('visible')) {
		hideListModal();
	}
});

// Header-Klick = Sortierung
document.querySelectorAll('#list-table thead th[data-sort]').forEach(th => {
	th.addEventListener('click', () => {
		const col = th.dataset.sort;
		if (listSortCol === col) {
			listSortDir = listSortDir === 'asc' ? 'desc' : 'asc';
		} else {
			listSortCol = col;
			listSortDir = 'asc';
		}
		renderList();
	});
});

function showListModal() {
	renderList();
	document.getElementById('list-modal').classList.add('visible');
}

function hideListModal() {
	document.getElementById('list-modal').classList.remove('visible');
}

function renderList() {
	const tbody = document.querySelector('#list-table tbody');
	tbody.innerHTML = '';
	document.getElementById('list-count').textContent = allImages.length;

	if (allImages.length === 0) {
		tbody.innerHTML = '<tr><td colspan="6" id="list-empty">Keine Objekte vorhanden</td></tr>';
		return;
	}

	// Header-Pfeile aktualisieren
	document.querySelectorAll('#list-table thead th[data-sort]').forEach(th => {
		th.classList.remove('sort-asc', 'sort-desc');
		if (th.dataset.sort === listSortCol) th.classList.add('sort-' + listSortDir);
	});

	// Sortieren
	const numeric = ['ra', 'dec'];
	const sorted  = [...allImages].sort((a, b) => {
		let va = a[listSortCol];
		let vb = b[listSortCol];
		if (numeric.includes(listSortCol)) {
			va = parseFloat(va) || 0;
			vb = parseFloat(vb) || 0;
			return listSortDir === 'asc' ? va - vb : vb - va;
		}
		va = (va ?? '').toString().toLowerCase();
		vb = (vb ?? '').toString().toLowerCase();
		return listSortDir === 'asc' ? va.localeCompare(vb, 'de') : vb.localeCompare(va, 'de');
	});

	// Zeilen rendern
	for (const img of sorted) {
		const tr = document.createElement('tr');
		tr.innerHTML = `
			<td><img class="list-preview" src="${IMAGES_DIR}${escapeAttr(img.filename)}" alt="" onerror="this.style.visibility='hidden'"></td>
			<td class="list-name">${escapeHtml(img.object_name)}</td>
			<td class="list-num">${parseFloat(img.ra).toFixed(3)}°</td>
			<td class="list-num">${parseFloat(img.dec).toFixed(3)}°</td>
			<td class="list-desc" title="${escapeAttr(img.description || '')}">${escapeHtml(img.description || '–')}</td>
			<td class="col-action"><button class="list-jump-btn" data-id="${img.id}" title="Zum Objekt springen und zoomen">𖦏 GoTo</button></td>
		`;
		tbody.appendChild(tr);
	}

	// Jump-Buttons
	tbody.querySelectorAll('.list-jump-btn').forEach(btn => {
		btn.addEventListener('click', () => jumpToObject(btn.dataset.id));
	});
}

function jumpToObject(imgId) {
	const img = allImages.find(i => String(i.id) === String(imgId));
	if (!img) return;

	const ra        = parseFloat(img.ra);
	const dec       = parseFloat(img.dec);
	const targetFov = Math.max(parseFloat(img.fov_width), parseFloat(img.fov_height)) * 2;

	aladin.gotoRaDec(ra, dec);
	aladin.setFov(targetFov);

	hideListModal();
}

// ── HTML-Escape-Helper ────────────────────────────────────────────────────────
function escapeHtml(str) {
	const div = document.createElement('div');
	div.textContent = str ?? '';
	return div.innerHTML;
}
function escapeAttr(str) {
	return String(str ?? '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ══════════════════════════════════════════════════════════════════════════════
// ── SIMBAD Identifikation ─────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

const SIMBAD_TAP_URL        = 'https://simbad.cds.unistra.fr/simbad/sim-tap/sync';
const SIMBAD_DEBOUNCE_MS    = 500;
const SIMBAD_MIN_RADIUS_DEG = 0.003;   // ~11″
const SIMBAD_MAX_RADIUS_DEG = 0.5;     // 30′
const SIMBAD_MAX_FOV_DEG    = 30;      // Darüber kein Sinn
const SIMBAD_MAX_RESULTS    = 20;

let simbadAbort     = null;
let simbadLastQuery = null;

// Aufklappen / Zuklappen
document.getElementById('simbad-header').addEventListener('click', toggleSimbadPanel);

function toggleSimbadPanel() {
	const panel = document.getElementById('simbad-panel');
	panel.classList.toggle('collapsed');
	document.getElementById('simbad-toggle').title =
		panel.classList.contains('collapsed') ? 'Aufklappen' : 'Zuklappen';
}

// Debounced Scheduler
const scheduleSimbad = debounce(() => {
	if (!aladin) return;
	const pos = aladin.getRaDec();
	const fov = aladin.getFov()[0];

	if (fov > SIMBAD_MAX_FOV_DEG) {
		setSimbadSummary('◈ Identifikation', '', 'idle');
		clearSimbadResults();
		document.getElementById('simbad-coords').textContent = 'Zu große Ansicht';
		return;
	}

	const radius = Math.min(
		SIMBAD_MAX_RADIUS_DEG,
		Math.max(SIMBAD_MIN_RADIUS_DEG, fov / 40)
	);

	// Skip wenn Position ~gleich (innerhalb 20 % des Radius)
	if (simbadLastQuery) {
		const dRa  = Math.abs(pos[0] - simbadLastQuery.ra);
		const dDec = Math.abs(pos[1] - simbadLastQuery.dec);
		if (dRa < radius * 0.2 && dDec < radius * 0.2 &&
			Math.abs(radius - simbadLastQuery.radius) / radius < 0.2) return;
	}

	simbadLastQuery = { ra: pos[0], dec: pos[1], radius };
	querySimbad(pos[0], pos[1], radius);
}, SIMBAD_DEBOUNCE_MS);

async function querySimbad(ra, dec, radius) {
	if (simbadAbort) simbadAbort.abort();
	simbadAbort = new AbortController();

	setSimbadSummary('⏳ Suche …', '', 'loading');
	document.getElementById('simbad-coords').textContent =
		formatCoords(ra, dec) + `  ·  r=${(radius * 3600).toFixed(0)}″`;

	const adql =
		`SELECT TOP ${SIMBAD_MAX_RESULTS} main_id, otype, ra, dec, ` +
		`DISTANCE(POINT('ICRS', ra, dec), POINT('ICRS', ${ra}, ${dec})) * 3600 AS dist ` +
		`FROM basic ` +
		`WHERE 1 = CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', ${ra}, ${dec}, ${radius})) ` +
		`ORDER BY dist`;

	const body = new URLSearchParams({
		request: 'doQuery',
		lang:    'adql',
		format:  'json',
		query:   adql,
	});

	try {
		const res = await fetch(SIMBAD_TAP_URL, {
			method:  'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body,
			signal:  simbadAbort.signal,
		});
		if (!res.ok) throw new Error('HTTP ' + res.status);
		const data = await res.json();
		renderSimbadResults(data);
	} catch (e) {
		if (e.name === 'AbortError') return;
		setSimbadSummary('✗ ' + e.message, '', 'error');
		clearSimbadResults();
	}
}

function renderSimbadResults(data) {
	const rows  = Array.isArray(data?.data) ? data.data : [];
	const tbody = document.querySelector('#simbad-table tbody');
	tbody.innerHTML = '';

	const panel = document.getElementById('simbad-panel');
	if (rows.length === 0) {
		panel.classList.add('empty');
		setSimbadSummary('◈ Nichts gefunden', '', 'idle');
		return;
	}
	panel.classList.remove('empty');

	// Collapsed-Summary = bestes Ergebnis (erstes, da nach dist sortiert)
	const [bestName, bestType] = rows[0];
	setSimbadSummary('◈ ' + bestName, bestType || '', 'idle');

	// Tabelle
	for (const row of rows) {
		const [name, otype, rRa, rDec, dist] = row;
		const tr = document.createElement('tr');
		tr.innerHTML = `
			<td class="simbad-name">${escapeHtml(name)}</td>
			<td class="simbad-type">${escapeHtml(otype || '')}</td>
			<td class="simbad-dist">${dist != null ? dist.toFixed(1) : '–'}</td>
		`;
		tr.title = `RA ${parseFloat(rRa).toFixed(4)}°  Dec ${parseFloat(rDec).toFixed(4)}°  ·  klicken zum Zentrieren`;
		tr.addEventListener('click', () => {
			aladin.gotoRaDec(parseFloat(rRa), parseFloat(rDec));
		});
		tbody.appendChild(tr);
	}
}

function setSimbadSummary(text, type, state) {
	const el = document.getElementById('simbad-summary');
	el.innerHTML = escapeHtml(text) + (type ? ` <span class="simbad-type">${escapeHtml(type)}</span>` : '');
	el.classList.remove('loading', 'error');
	if (state === 'loading' || state === 'error') el.classList.add(state);
}

function clearSimbadResults() {
	document.querySelector('#simbad-table tbody').innerHTML = '';
	document.getElementById('simbad-panel').classList.remove('empty');
}

function formatCoords(ra, dec) {
	// HH MM SS.s  ±DD MM SS
	const raH  = ra / 15;
	const rH   = Math.floor(raH);
	const rM   = Math.floor((raH - rH) * 60);
	const rS   = ((raH - rH) * 60 - rM) * 60;
	const sign = dec < 0 ? '-' : '+';
	const ad   = Math.abs(dec);
	const dD   = Math.floor(ad);
	const dM   = Math.floor((ad - dD) * 60);
	const dS   = Math.round(((ad - dD) * 60 - dM) * 60);
	return `${String(rH).padStart(2,'0')}ʰ${String(rM).padStart(2,'0')}ᵐ${rS.toFixed(1).padStart(4,'0')}ˢ  ` +
	       `${sign}${String(dD).padStart(2,'0')}°${String(dM).padStart(2,'0')}′${String(dS).padStart(2,'0')}″`;
}

