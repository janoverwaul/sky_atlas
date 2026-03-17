// ── Config ────────────────────────────────────────────────────────────────────
const API_URL         = 'api/images.php';
const IMAGES_DIR      = 'images/';
const OVERLAY_MAX_FOV = 15;
const PAN_SPEED       = 2.0;
const SAVE_DEBOUNCE_MS = 500;

// ── State ─────────────────────────────────────────────────────────────────────
let aladin        = null;
let allImages     = [];
let currentMode   = 'markers';
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
		showSimbadPointerControl: false,
		showCooGrid:              true,
		reticleColor:             '#5b9cf6',
		reticleSize:              24,
	});

	fetchAllImages().then(() => {
		setupAladinListeners();
		setupFastPan();
		update();
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

// Wheel & Mousedown an Aladin weiterleiten (nur wenn nicht Admin-Drag)
skyOverlay.addEventListener('wheel', (e) => {
	aladinDiv.dispatchEvent(new WheelEvent('wheel', e));
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

	if (aladinCatalog) {
		try { aladin.removeLayer(aladinCatalog); } catch(e) {}
		aladinCatalog = null;
	}

	aladinCatalog = A.catalog({ name: 'Meine Aufnahmen', sourceSize: 18, color: '#f0a040', onClick: 'showPopup', shape: 'cross' });
	aladin.addCatalog(aladinCatalog);

	const sources = allImages.map(img =>
		A.source(img.ra, img.dec, { name: img.object_name, description: buildPopupHTML(img) })
	);
	aladinCatalog.addSources(sources);
	document.getElementById('pill-visible').textContent = sources.length + ' Marker';
	dbg('● Marker-Modus  (' + sources.length + ' Quellen)');
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
	border.setAttribute('pointer-events', 'all');
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
	let panRafId = null;

	div.addEventListener('mousedown', (e) => {
		if (adminMode) return; // Admin-Modus: kein Panning
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

		const fov      = aladin.getFov();
		const deltaRa  = (e.clientX - startX) / div.clientWidth  * fov[0] * PAN_SPEED;
		const deltaDec = (e.clientY - startY) / div.clientHeight * fov[1] * PAN_SPEED;

		const newRa  = ((startRa + deltaRa) % 360 + 360) % 360;
		const newDec = Math.max(-90, Math.min(90, startDec + deltaDec));

		aladin.gotoRaDec(newRa, newDec);

		if (currentMode === 'overlay') {
			if (panRafId) cancelAnimationFrame(panRafId);
			panRafId = requestAnimationFrame(() => {
				panRafId = null;
				renderOverlays();
			});
		}
	});

	window.addEventListener('mouseup', () => {
		if (isPanning) {
			isPanning = false;
			panRafId  = null;
			requestAnimationFrame(update);
		}
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

	// Aktuelles Kartenzentrum als Startposition
	const pos = aladin.getRaDec();
	const fd  = new FormData();
	fd.append('object_name', name);
	fd.append('ra',  pos[0]);
	fd.append('dec', pos[1]);
	fd.append('image', file);

	stat.textContent = 'Lade hoch…';
	try {
		const res  = await fetch(API_URL, { method: 'POST', body: fd });
		const data = await res.json();
		if (data.success) {
			allImages.push(data.image);
			document.getElementById('pill-total').textContent = allImages.length + ' Objekte';
			document.getElementById('upload-name').value = '';
			document.getElementById('upload-file').value = '';
			stat.textContent = '✓ ' + data.image.object_name + ' hinzugefügt';
			selectedImgId = String(data.image.id);
			update();
		} else {
			stat.textContent = '✗ ' + (data.error || 'Fehler');
		}
	} catch (err) {
		stat.textContent = '✗ Upload-Fehler: ' + err.message;
	}
}

async function adminDeleteImage(imgId) {
	const img = allImages.find(i => String(i.id) === String(imgId));
	if (!confirm(`"${img?.object_name ?? imgId}" wirklich löschen?\nDiese Aktion kann nicht rückgängig gemacht werden.`)) return;

	try {
		const res  = await fetch(API_URL + '?id=' + imgId, { method: 'DELETE' });
		const data = await res.json();
		if (data.success) {
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