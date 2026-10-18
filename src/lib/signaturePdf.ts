import type { jsPDF } from 'jspdf';
import { fitSignatureInsideBox } from './mandatorySignatureGeometry';

// Insert original pixels with their aspect ratio and alpha. Never recolour a saved image.
export function addSignatureImage(doc: jsPDF, image: string, x: number, y: number, boxWidth: number, boxHeight: number) {
  try {
    const properties = doc.getImageProperties(image);
    const { width, height } = fitSignatureInsideBox({ imageWidth: properties.width, imageHeight: properties.height, boxWidth, boxHeight });
    doc.addImage(image, 'PNG', x + (boxWidth - width) / 2, y + (boxHeight - height) / 2, width, height, undefined, 'FAST');
  } catch {
    throw new Error('No se pudo insertar una firma. No se ha generado el PDF; revisa o repite la firma.');
  }
}
