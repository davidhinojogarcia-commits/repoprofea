/* Herramientas y maquinaria — flujo móvil de campo con escáner QR */
(() => {
  const MOBILE_QUERY = '(max-width: 767px)';
  const SCANNER_ID = 'inventory-mobile-qr-scanner';
  const TRIGGER_ID = 'inventory-mobile-qr-trigger';
  let stream = null;
  let rafId = 0;
  let jsQR = null;
  let busy = false;

  const isInventoryView = () => {
    if (!window.matchMedia(MOBILE_QUERY).matches) return false;
    const text = document.body?.innerText || '';
    return text.includes('Herramientas y maquinaria');
  };

  const stopCamera = () => {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
  };

  const closeScanner = () => {
    stopCamera();
    document.getElementById(SCANNER_ID)?.remove();
    busy = false;
  };

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
    } catch (error) {
      console.debug('QR scan frame skipped', error);
    }
    status.textContent = 'Apunta al código QR del equipo';
    rafId = requestAnimationFrame(() => void scanLoop(video, canvas, status, nativeDetector));
  };

  const openScanner = async () => {
    if (busy || document.getElementById(SCANNER_ID)) return;
    busy = true;
    const overlay = document.createElement('div');
    overlay.id = SCANNER_ID;
    overlay.className = 'inventory-mobile-qr-overlay';
    overlay.innerHTML = `
      <div class="inventory-mobile-qr-sheet" role="dialog" aria-modal="true" aria-label="Escanear QR de equipo">
        <div class="inventory-mobile-qr-head">
          <div><strong>Escanear equipo</strong><span>Lee el QR para abrir directamente su ficha</span></div>
          <button type="button" class="inventory-mobile-qr-close" aria-label="Cerrar">×</button>
        </div>
        <div class="inventory-mobile-qr-camera">
          <video playsinline muted autoplay></video>
          <div class="inventory-mobile-qr-frame"></div>
          <canvas hidden></canvas>
        </div>
        <div class="inventory-mobile-qr-status">Preparando cámara…</div>
        <button type="button" class="inventory-mobile-qr-cancel">Cancelar</button>
      </div>`;
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
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
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

  const ensureTrigger = () => {
    const existing = document.getElementById(TRIGGER_ID);
    if (!isInventoryView()) {
      existing?.remove();
      return;
    }
    if (existing) return;
    const quickCard = document.querySelector('.md\\:hidden.sticky.top-2.z-30');
    if (!quickCard) return;
    const button = document.createElement('button');
    button.id = TRIGGER_ID;
    button.type = 'button';
    button.className = 'inventory-mobile-qr-trigger';
    button.innerHTML = '<span class="inventory-mobile-qr-icon" aria-hidden="true">⌗</span><span><strong>Escanear QR</strong><small>Abrir equipo con la cámara</small></span>';
    button.addEventListener('click', openScanner);
    quickCard.prepend(button);
  };

  const observer = new MutationObserver(() => ensureTrigger());
  const start = () => {
    ensureTrigger();
    observer.observe(document.body, { childList: true, subtree: true });
    window.matchMedia(MOBILE_QUERY).addEventListener?.('change', ensureTrigger);
    window.addEventListener('popstate', ensureTrigger);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
