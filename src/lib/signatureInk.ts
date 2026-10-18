// Applied only when capturing a new stroke. Stored/imported images are never recoloured.
export const SIGNATURE_INK_COLOR = '#164B9B';
export const SIGNATURE_INK_RGB = [22, 75, 155] as const;
export const SIGNATURE_LINE_WIDTH = 2.4;

export function exportSignaturePng(canvas: HTMLCanvasElement, trim = false): string {
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    if (data[(y * canvas.width + x) * 4 + 3] <= 20) continue;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  if (maxX < 0) return '';
  if (!trim) return canvas.toDataURL('image/png');
  const padding = 14;
  minX = Math.max(0, minX - padding); minY = Math.max(0, minY - padding);
  maxX = Math.min(canvas.width - 1, maxX + padding); maxY = Math.min(canvas.height - 1, maxY + padding);
  const width = maxX - minX + 1, height = maxY - minY + 1;
  const scale = Math.min(1, 720 / width, 260 / height);
  const output = document.createElement('canvas');
  output.width = Math.max(1, Math.round(width * scale)); output.height = Math.max(1, Math.round(height * scale));
  output.getContext('2d')?.drawImage(canvas, minX, minY, width, height, 0, 0, output.width, output.height);
  return output.toDataURL('image/png');
}

export const SIGNATURE_INK = SIGNATURE_INK_COLOR;
