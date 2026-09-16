/* Herramientas y maquinaria — flujo móvil de campo: búsqueda principal + QR secundario */
(() => {
  const MOBILE_QUERY = '(max-width: 767px)';
  const SCANNER_ID = 'inventory-mobile-qr-scanner';
  const TRIGGER_ID = 'inventory-mobile-qr-trigger';
  const FINDER_ID = 'inventory-mobile-finder';
  let stream = null;
  let rafId = 0;
  let jsQR = null;
  let busy = false;

  const normalize = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  const escapeHtml = value => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  const isInventoryView = () => window.matchMedia(MOBILE_QUERY).matches && (document.body?.innerText || '').includes('Herramientas y maquinaria');
  const stopCamera = () => { if (rafId) cancelAnimationFrame(rafId); rafId = 0; if (stream) stream.getTracks().forEach(track => track.stop()); stream = null; };
  const closeScanner = () => { stopCamera(); document.getElementById(SCANNER_ID)?.remove(); busy = false; };

  const goToInventoryItem = raw => {
    let itemId = '';
    try {
      const parsed = new URL(raw, window.location.href);
      if (parsed.origin === window.location.origin) itemId = parsed.searchParams.get('inventoryItem') || '';
    } catch {}
    if (!itemId && /^[0-9a-f-]{20,}$/i.test(String(raw || '').trim())) itemId = String(raw).trim();
    if (!itemId) return false;
    const next = new URL(window.location.href);
    next.searchParams.set('inventoryItem', itemId);
    closeScanner();
    window.location.assign(next.toString());
    return true;
  };

  const loadDecoder = async () => {
    if ('BarcodeDetector' in window) {
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats?.();
        if (!formats || formats.includes('qr_code')) return new window.BarcodeDetector({ formats: ['qr_code'] });
      } catch {}
    }
    if (!jsQR) {
      const mod = await import('https://esm.sh/jsqr@1.4.0');
      jsQR = mod.default || mod;
    }
    return null;
  };

  const scanLoop = async (video, canvas, status, nativeDetector) => {
    if (!document.getElementById(SCANNER_ID) || !stream) return;
    try {
      if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
        if (nativeDetector) {
          const found = await nativeDetector.detect(video);
          if (found?.[0]?.rawValue && goToInventoryItem(found[0].rawValue)) return;
        } else if (jsQR) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
            if (code?.data && goToInventoryItem(code.data)) return;
          }
        }
      }
    } catch (error) { console.debug('QR scan frame skipped', error); }
    status.textContent = 'Apunta al código QR del equipo';
    rafId = requestAnimationFrame(() => void scanLoop(video, canvas, status, nativeDetector));
  };

  const openScanner = async () => {
    if (busy || document.getElementById(SCANNER_ID)) return;
    busy = true;
    const overlay = document.createElement('div');
    overlay.id = SCANNER_ID;
    overlay.className = 'inventory-mobile-qr-overlay';
    overlay.innerHTML = `<div class="inventory-mobile-qr-sheet" role="dialog" aria-modal="true" aria-label="Escanear QR de equipo"><div class="inventory-mobile-qr-head"><div><strong>Escanear equipo</strong><span>Opción secundaria para equipos que ya tengan QR</span></div><button type="button" class="inventory-mobile-qr-close" aria-label="Cerrar">×</button></div><div class="inventory-mobile-qr-camera"><video playsinline muted autoplay></video><div class="inventory-mobile-qr-frame"></div><canvas hidden></canvas></div><div class="inventory-mobile-qr-status">Preparando cámara…</div><button type="button" class="inventory-mobile-qr-cancel">Cancelar</button></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.inventory-mobile-qr-close')?.addEventListener('click', closeScanner);
    overlay.querySelector('.inventory-mobile-qr-cancel')?.addEventListener('click', closeScanner);
    overlay.addEventListener('click', event => { if (event.target === overlay) closeScanner(); });
    const video = overlay.querySelector('video');
    const canvas = overlay.querySelector('canvas');
    const status = overlay.querySelector('.inventory-mobile-qr-status');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este dispositivo no permite acceso directo a la cámara.');
      status.textContent = 'Solicitando permiso para la cámara…';
      const nativeDetector = await loadDecoder();
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      video.srcObject = stream;
      await video.play();
      status.textContent = 'Apunta al código QR del equipo';
      rafId = requestAnimationFrame(() => void scanLoop(video, canvas, status, nativeDetector));
    } catch (error) {
      stopCamera();
      status.textContent = error?.message || 'No se pudo iniciar la cámara.';
      status.classList.add('is-error');
      busy = false;
    }
  };

  const chooseOption = (select, option, input, results) => {
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    input.value = option.textContent?.trim() || '';
    results.innerHTML = '';
    results.hidden = true;
    input.blur();
  };

  const renderResults = (select, input, results) => {
    const query = normalize(input.value);
    const options = Array.from(select.options || []).filter(option => option.value && !option.disabled);
    if (!query) { results.innerHTML = ''; results.hidden = true; return; }
    const matched = options.map(option => ({ option, text: option.textContent?.trim() || '', key: normalize(option.textContent) }))
      .filter(item => item.key.includes(query))
      .sort((a, b) => (a.key.startsWith(query) ? 0 : 1) - (b.key.startsWith(query) ? 0 : 1) || a.text.localeCompare(b.text, 'es'))
      .slice(0, 8);
    results.innerHTML = '';
    if (!matched.length) {
      const empty = document.createElement('div'); empty.className = 'inventory-mobile-search-empty'; empty.textContent = 'No se ha encontrado ninguna máquina o herramienta'; results.appendChild(empty); results.hidden = false; return;
    }
    matched.forEach(({ option, text }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'inventory-mobile-search-result';
      button.innerHTML = `<span class="inventory-mobile-search-result-icon" aria-hidden="true">↗</span><span>${escapeHtml(text)}</span>`;
      button.addEventListener('click', () => chooseOption(select, option, input, results));
      results.appendChild(button);
    });
    results.hidden = false;
  };

  const ensureFinder = () => {
    const existingFinder = document.getElementById(FINDER_ID);
    const existingQr = document.getElementById(TRIGGER_ID);
    if (!isInventoryView()) { existingFinder?.remove(); existingQr?.remove(); return; }
    const quickCard = document.querySelector('.md\\:hidden.sticky.top-2.z-30');
    const select = quickCard?.querySelector(':scope > select');
    if (!quickCard || !select) return;

    if (!existingFinder) {
      const finder = document.createElement('div');
      finder.id = FINDER_ID;
      finder.className = 'inventory-mobile-finder';
      finder.innerHTML = `<label for="inventory-mobile-search"><strong>Buscar máquina o herramienta</strong><small>Escribe nombre, código, matrícula o referencia</small></label><div class="inventory-mobile-search-wrap"><span class="inventory-mobile-search-icon" aria-hidden="true">⌕</span><input id="inventory-mobile-search" type="search" inputmode="search" autocomplete="off" placeholder="Ej.: compresor, andamio, Z6-COMP-001…" /><button type="button" class="inventory-mobile-search-clear" aria-label="Borrar búsqueda" hidden>×</button></div><div class="inventory-mobile-search-results" hidden></div>`;
      quickCard.prepend(finder);
      const input = finder.querySelector('input');
      const results = finder.querySelector('.inventory-mobile-search-results');
      const clear = finder.querySelector('.inventory-mobile-search-clear');
      input.addEventListener('input', () => { clear.hidden = !input.value; renderResults(select, input, results); });
      input.addEventListener('focus', () => { if (input.value) renderResults(select, input, results); });
      input.addEventListener('keydown', event => { if (event.key === 'Enter') { const first = results.querySelector('.inventory-mobile-search-result'); if (first) { event.preventDefault(); first.click(); } } });
      clear.addEventListener('click', () => { input.value = ''; clear.hidden = true; results.innerHTML = ''; results.hidden = true; input.focus(); });
      select.addEventListener('change', () => { const option = select.options[select.selectedIndex]; if (option?.value) input.value = option.textContent?.trim() || ''; });
    }

    if (!existingQr) {
      const button = document.createElement('button');
      button.id = TRIGGER_ID;
      button.type = 'button';
      button.className = 'inventory-mobile-qr-trigger inventory-mobile-qr-trigger-secondary';
      button.innerHTML = '<span class="inventory-mobile-qr-icon" aria-hidden="true">⌗</span><span><strong>Escanear QR</strong><small>Solo si el equipo ya dispone de código</small></span>';
      button.addEventListener('click', openScanner);
      document.getElementById(FINDER_ID)?.insertAdjacentElement('afterend', button);
    }
  };

  const observer = new MutationObserver(ensureFinder);
  const start = () => { ensureFinder(); observer.observe(document.body, { childList: true, subtree: true }); window.matchMedia(MOBILE_QUERY).addEventListener?.('change', ensureFinder); window.addEventListener('popstate', ensureFinder); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
