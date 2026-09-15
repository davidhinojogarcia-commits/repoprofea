import type { Person } from '../../types';
import { updateDocument } from '../services/databaseService';
import {
  cancelReservedMedicalAppointmentWhatsAppWindow,
  reserveMedicalAppointmentWhatsAppWindow,
  type MedicalConfirmationLinks,
} from './shareMedicalAppointment';

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
};

const tokenExpiry = (appointmentDay: string) => {
  const match = String(appointmentDay || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const expiry = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59, 999);
    expiry.setDate(expiry.getDate() + 2);
    if (expiry.getTime() > Date.now()) return expiry.toISOString();
  }
  const fallback = new Date();
  fallback.setDate(fallback.getDate() + 30);
  return fallback.toISOString();
};

export const prepareMedicalAppointmentConfirmation = async (person: Person): Promise<{
  updatedPerson: Person;
  links: MedicalConfirmationLinks;
}> => {
  if (!person.citaDia || !person.citaHora) throw new Error('La cita debe tener fecha y hora antes de generar la confirmación.');

  // Reserve a browser window synchronously while the user's tap is still active.
  // Safari/iOS otherwise blocks the later WhatsApp navigation after async awaits.
  reserveMedicalAppointmentWhatsAppWindow();

  // 24 bytes = 192 bits of entropy and a 32-character base64url token.
  // This keeps the worker links materially shorter without weakening their security.
  const random = new Uint8Array(24);
  crypto.getRandomValues(random);
  const token = bytesToBase64Url(random);
  const tokenHash = await sha256Hex(token);
  const persistedPerson = {
    ...person,
    confirmacionCitaEstado: 'pendiente',
    confirmacionCitaFecha: '',
    confirmacionCitaTokenHash: tokenHash,
    confirmacionCitaTokenExpira: tokenExpiry(person.citaDia),
    confirmacionCitaTokenDia: person.citaDia,
    confirmacionCitaTokenHora: person.citaHora,
    confirmacionCitaOrigen: 'pendiente_respuesta_trabajador',
  } as Person & Record<string, any>;

  try {
    await updateDocument('trabajadores', person.id, persistedPerson as any);
  } catch (error) {
    cancelReservedMedicalAppointmentWhatsAppWindow();
    throw error;
  }

  // Keep the existing public portal marker so the compact link opens directly
  // without authentication. Short aliases reduce the visible WhatsApp URL while
  // the portal still accepts the previous token/respuesta parameters.
  const base = `${window.location.origin}/?confirmacion_reconocimiento=1&c=${encodeURIComponent(token)}`;
  return {
    // The confirmation token has already been persisted above. Returning the
    // original worker avoids triggering the parent callback that also persists a
    // medical-recognition record, which produced a false "cambios médicos" error
    // when merely sending a WhatsApp citation.
    updatedPerson: person,
    links: {
      confirm: `${base}&r=si`,
      decline: `${base}&r=no`,
    },
  };
};