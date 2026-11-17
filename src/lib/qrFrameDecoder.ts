import jsQR from 'jsqr';

// Preserve the pixels around the aiming area instead of reducing a small,
// dense carnet QR with the entire camera frame (which may be 4K).
export function decodeQrFrame(source: CanvasImageSource, width: number, height: number, canvas: HTMLCanvasElement, attempt?: number): string | null {
  if (!width || !height) return null;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  const side = Math.min(width, height) * .65;
  const regions = [
    { x: (width-side)/2, y: (height-side)/2, width: side, height: side, max: 1280 },
    { x: 0, y: 0, width, height, max: 1280 },
    { x: 0, y: 0, width, height, max: 1920 },
  ];
  // Live video spreads the passes over successive frames to keep the UI responsive.
  const candidates = attempt === undefined ? regions : [regions[attempt % regions.length]];
  for (const region of candidates) {
    const scale = Math.min(1, region.max / Math.max(region.width, region.height));
    canvas.width = Math.max(1, Math.round(region.width * scale));
    canvas.height = Math.max(1, Math.round(region.height * scale));
    try {
      context.drawImage(source, region.x, region.y, region.width, region.height, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const decoded = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' });
      if (decoded?.data) return decoded.data;
    } catch {
      // A video frame can disappear during rotation, focus or camera startup.
      // Keep trying other resolutions/frames; never terminate the reader.
    }
  }
  return null;
}
