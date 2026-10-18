import type { ForemanAttendanceRow } from '../services/foremanPortalService';

// Portal summaries use the marker "signed"; exports require the actual image.
const hasSignatureImage = (value: unknown): boolean =>
  typeof value === 'string' && /^data:image\/(?:png|jpe?g);base64,[a-z0-9+/=\s]+$/i.test(value.trim());

export const signedAttendanceRows = (rows: ForemanAttendanceRow[] | null | undefined): ForemanAttendanceRow[] =>
  (Array.isArray(rows) ? rows : []).filter(row =>
    row != null && hasSignatureImage(row.entrySignature) && hasSignatureImage(row.exitSignature),
  );
