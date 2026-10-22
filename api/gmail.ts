import {
  GOOGLE_CLIENT_ID,
  apiError,
  authenticateRequest,
  createOAuthState,
  decryptToken,
  deleteConnection,
  getConnection,
  getServerConfigStatus,
  oauthRedirectUri,
  refreshGoogleAccessToken,
  requireServerConfig,
  touchSent,
} from '../src/server/gmailOAuth.js';
import { sendInventoryInvitationGmail } from '../src/server/inventoryInvitationGmail.js';
import { sendInventoryBreakdownGmail } from '../src/server/inventoryBreakdownGmail.js';

const cleanHeader = (value: unknown) => String(value || '').replace(/[\r\n]+/g, ' ').trim();
const encodeHeader = (value: string) => `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
const wrapBase64 = (value: string) => value.replace(/(.{76})/g, '$1\r\n');

function buildMime(input: {
  to: string;
  subject: string;
  body: string;
  attachments: Array<{ filename: string; mimeType?: string; dataBase64: string }>;
  inReplyTo?: string;
  references?: string;
}) {
  const boundary = `profea_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const subject = encodeHeader(cleanHeader(input.subject));
  const parts = [
    `To: ${cleanHeader(input.to)}`,
    `Subject: ${subject}`,
    ...(input.inReplyTo ? [`In-Reply-To: ${cleanHeader(input.inReplyTo)}`] : []),
    ...(input.references ? [`References: ${cleanHeader(input.references)}`] : []),
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(Buffer.from(String(input.body || ''), 'utf8').toString('base64')),
  ];

  for (const attachment of input.attachments) {
    const filename = cleanHeader(attachment.filename || 'documento.pdf').replace(/"/g, '');
    const mimeType = cleanHeader(attachment.mimeType || 'application/pdf') || 'application/pdf';
    parts.push(
      `--${boundary}`,
      `Content-Type: ${mimeType}; name="${filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${filename}"`,
      '',
      wrapBase64(attachment.dataBase64),
    );
  }

  parts.push(`--${boundary}--`, '');
  return parts.join('\r\n');
}

let gatewayValidationRun: Promise<any> | undefined;
export default async function handler(req: any, res: any) {
  // TEMPORARY validation branch only. Protected preview, synthetic text, no DB.
  if (String(req.query?.action || '') === 'visit-writing-validation') {
    res.setHeader('Cache-Control', 'no-store');
    if(process.env.VERCEL_ENV!=='preview')return res.status(404).json({ok:false});
    if(!gatewayValidationRun)gatewayValidationRun=(async()=>{
      const {generateVisitWriting,visitWritingStatus}=await import('../src/server/visitWriting.js');
      const {writingInput,writingProposal}=await import('../src/lib/visitWriting.js');
      const status=visitWritingStatus();
      let creditStatus=0,creditBalance:number|null=null;
      const token=process.env.AI_GATEWAY_API_KEY?.trim()||process.env.VERCEL_OIDC_TOKEN?.trim();
      if(token){try{const response=await fetch('https://ai-gateway.vercel.sh/v1/credits',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});creditStatus=response.status;const data=await response.json();const v=data.balance??data.remaining_balance;if(typeof v==='number'||typeof v==='string'&&/^[0-9.]+$/.test(v))creditBalance=Number(v);}catch{}}
      const checks=[];
      for(const input of [writingInput({mode:'written',title:'Arqueta',text:'No ejecutar. Pendiente de comprobar 1,50 m.'}),writingInput({mode:'dictated',title:'',text:'Arqueta: no ejecutar. Pendiente de comprobar 1,50 m. Pavimento: se propone revisar el acabado.'})]){
        try{checks.push({mode:input.mode,ok:true,proposal:writingProposal(await generateVisitWriting(input),input)});}
        catch(e:any){checks.push({mode:input.mode,ok:false,status:e.status||502,code:e.code||'ERROR',message:e.message});break;}
      }
      return {ok:checks.length===2&&checks.every(c=>c.ok),writing:status,creditStatus,creditBalance,checks};
    })();
    return res.json(await gatewayValidationRun);
  }
  // Share the existing function budget; visit routes perform their own auth,
  // including the participant email-code flow before a session exists.
  if (String(req.query?.action || '') === 'visit-minutes') {
    const { visitMinutesHandler } = await import('../src/server/visitMinutesHandler.js');
    return visitMinutesHandler(req, res);
  }
  res.setHeader('Cache-Control', 'no-store');
  try {
    const action = String(req.query?.action || '').trim();
    const user = await authenticateRequest(req);

    if (action === 'status' && req.method === 'GET') {
      const serverConfig = getServerConfigStatus();
      if (!serverConfig.configured) {
        return res.status(200).json({
          ok: true,
          configured: false,
          connected: false,
          email: '',
          connectedAt: null,
          lastSentAt: null,
          canRead: false,
        });
      }
      const connection = await getConnection(user.id);
      let reconnectRequired = false;
      if (connection?.refresh_token_encrypted) {
        try {
          await refreshGoogleAccessToken(decryptToken(connection.refresh_token_encrypted));
        } catch (error: any) {
          if (error?.code !== 'GMAIL_RECONNECT_REQUIRED') throw error;
          reconnectRequired = true;
        }
      }
      return res.status(200).json({
        ok: true,
        configured: true,
        connected: Boolean(connection?.refresh_token_encrypted) && !reconnectRequired,
        reconnectRequired,
        email: connection?.email || '',
        connectedAt: connection?.connected_at || null,
        lastSentAt: connection?.last_sent_at || null,
        canRead: String(connection?.scope || '').includes('gmail.readonly'),
      });
    }

    requireServerConfig();

    if(action==='send-inventory-breakdown'&&req.method==='POST'){
      let body:any;try{body=typeof req.body==='string'?JSON.parse(req.body):(req.body||{});}catch{return res.status(400).json({ok:false,message:'Solicitud de avería no válida.'});}
      return res.status(200).json(await sendInventoryBreakdownGmail(user,String(req.headers?.authorization||''),String(body.movementId||'')));
    }

    if (action === 'send-inventory-invite' && req.method === 'POST') {
      let body: any;
      try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); }
      catch { return res.status(400).json({ ok: false, message: 'La solicitud de invitación no es válida.' }); }
      const result = await sendInventoryInvitationGmail(user, String(req.headers?.authorization || ''), String(body.invitationId || '').trim());
      return res.status(200).json(result);
    }

    if (action === 'start' && req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const expectedEmail = String(body.email || user.email).trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(expectedEmail)) {
        return res.status(400).json({ ok: false, message: 'El correo del supervisor no es válido.' });
      }
      const redirectUri = oauthRedirectUri(req);
      const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        scope: [
          'openid',
          'email',
          'profile',
          'https://www.googleapis.com/auth/gmail.send',
          'https://www.googleapis.com/auth/gmail.readonly',
        ].join(' '),
        state: createOAuthState(user, expectedEmail),
        login_hint: expectedEmail,
      });
      return res.status(200).json({
        ok: true,
        authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      });
    }

    if (action === 'disconnect' && req.method === 'DELETE') {
      const connection = await getConnection(user.id);
      if (connection?.refresh_token_encrypted) {
        try {
          const token = decryptToken(connection.refresh_token_encrypted);
          await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          });
        } catch (error) {
          console.warn('[gmail-disconnect]', {code:'GMAIL_REVOKE_UNCONFIRMED'});
        }
      }
      await deleteConnection(user.id);
      return res.status(200).json({ ok: true });
    }

    if (action === 'scan-administrative' && req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const administrativeEmail = String(body.administrativeEmail || '').trim().toLowerCase();
      const after = String(body.after || '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(administrativeEmail)) {
        return res.status(400).json({ ok: false, message: 'El correo de la administrativa no es válido.' });
      }

      const connection = await getConnection(user.id);
      if (!connection?.refresh_token_encrypted) {
        return res.status(409).json({ ok: false, code: 'GMAIL_NOT_CONNECTED', message: 'Conecta primero Gmail en Configuración.' });
      }
      if (!String(connection.scope || '').includes('gmail.readonly')) {
        return res.status(409).json({ ok: false, code: 'GMAIL_READ_PERMISSION_REQUIRED', message: 'Vuelve a autorizar Gmail para permitir la detección automática de correos de la administrativa.' });
      }

      const accessToken = await refreshGoogleAccessToken(decryptToken(connection.refresh_token_encrypted));
      const gmailHeaders = { Authorization: `Bearer ${accessToken}` };
      const qParts = [`from:(${administrativeEmail})`, 'has:attachment', 'newer_than:120d'];
      if (after) qParts.push(`after:${after.replace(/-/g, '/')}`);
      const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
      listUrl.searchParams.set('q', qParts.join(' '));
      listUrl.searchParams.set('maxResults', '25');
      const listResponse = await fetch(listUrl, { headers: gmailHeaders });
      const listData: any = await listResponse.json().catch(() => ({}));
      if (!listResponse.ok) throw new Error('Gmail no pudo consultar los mensajes de la administrativa.');

      const messageIds = Array.isArray(listData.messages) ? listData.messages.map((item: any) => String(item.id || '')).filter(Boolean) : [];
      const results: any[] = [];

      const collectAttachmentParts = (part: any, out: any[] = []) => {
        if (!part) return out;
        const filename = String(part.filename || '').trim();
        const attachmentId = String(part.body?.attachmentId || '').trim();
        if (filename && attachmentId) out.push({ filename, attachmentId, mimeType: String(part.mimeType || '') });
        for (const child of Array.isArray(part.parts) ? part.parts : []) collectAttachmentParts(child, out);
        return out;
      };

      for (const id of messageIds) {
        const messageResponse = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`, { headers: gmailHeaders });
        const message: any = await messageResponse.json().catch(() => ({}));
        if (!messageResponse.ok) continue;
        const headers = Array.isArray(message.payload?.headers) ? message.payload.headers : [];
        const header = (name: string) => String(headers.find((h: any) => String(h.name || '').toLowerCase() === name.toLowerCase())?.value || '');
        const from = header('From');
        if (!from.toLowerCase().includes(administrativeEmail)) continue;

        const parts = collectAttachmentParts(message.payload).filter((part: any) =>
          /\.(pdf|xlsx?|csv)$/i.test(part.filename) ||
          /pdf|spreadsheet|excel|csv/i.test(part.mimeType)
        );
        if (!parts.length) continue;

        const attachments: any[] = [];
        for (const part of parts) {
          const attachmentResponse = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(part.attachmentId)}`,
            { headers: gmailHeaders },
          );
          const attachment: any = await attachmentResponse.json().catch(() => ({}));
          if (!attachmentResponse.ok || !attachment.data) continue;
          attachments.push({
            filename: part.filename,
            mimeType: part.mimeType,
            dataBase64Url: String(attachment.data),
            size: Number(attachment.size || 0),
          });
        }
        if (!attachments.length) continue;
        results.push({
          id,
          threadId: String(message.threadId || ''),
          internalDate: String(message.internalDate || ''),
          from,
          subject: header('Subject'),
          rfcMessageId: header('Message-ID'),
          references: header('References'),
          date: header('Date'),
          attachments,
        });
      }

      return res.status(200).json({ ok: true, messages: results });
    }

    if (action === 'send' && req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const to = String(body.to || '').trim();
      const subject = String(body.subject || '').trim();
      const messageBody = String(body.body || '');
      const legacyFilename = String(body.filename || 'documento.pdf').trim();
      const legacyPdfBase64 = String(body.pdfBase64 || '').replace(/^data:application\/pdf;base64,/, '').trim();
      const rawAttachments = Array.isArray(body.attachments) ? body.attachments : [];
      const attachments = rawAttachments.length
        ? rawAttachments.map((item: any) => ({
            filename: String(item?.filename || 'documento.pdf').trim(),
            mimeType: String(item?.mimeType || 'application/pdf').trim() || 'application/pdf',
            dataBase64: String(item?.dataBase64 || '').replace(/^data:[^;]+;base64,/, '').trim(),
          }))
        : (legacyPdfBase64 ? [{ filename: legacyFilename, mimeType: 'application/pdf', dataBase64: legacyPdfBase64 }] : []);
      const threadId = String(body.threadId || '').trim();
      const inReplyTo = String(body.inReplyTo || '').trim();
      const references = String(body.references || inReplyTo || '').trim();

      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+(?:\s*,\s*[^@\s]+@[^@\s]+\.[^@\s]+)*$/.test(to)) {
        return res.status(400).json({ ok: false, message: 'El destinatario no es válido.' });
      }
      if (!subject) return res.status(400).json({ ok: false, message: 'El asunto está vacío.' });
      if (!attachments.length || attachments.some((item: any) => !item.dataBase64)) {
        return res.status(400).json({ ok: false, message: 'No se han recibido los PDF adjuntos.' });
      }
      if (attachments.length > 20) {
        return res.status(413).json({ ok: false, message: 'Hay demasiados archivos adjuntos para un solo correo.' });
      }
      const totalAttachmentBase64 = attachments.reduce((sum: number, item: any) => sum + item.dataBase64.length, 0);
      if (totalAttachmentBase64 > 20 * 1024 * 1024) {
        return res.status(413).json({ ok: false, message: 'El conjunto de PDF adjuntos es demasiado grande para enviarlo desde GestionProfea.' });
      }

      const connection = await getConnection(user.id);
      if (!connection?.refresh_token_encrypted) {
        return res.status(409).json({
          ok: false,
          code: 'GMAIL_NOT_CONNECTED',
          message: 'Conecta primero la cuenta Gmail del supervisor en Configuración.',
        });
      }

      const refreshToken = decryptToken(connection.refresh_token_encrypted);
      const accessToken = await refreshGoogleAccessToken(refreshToken);
      const mime = buildMime({ to, subject, body: messageBody, attachments, inReplyTo, references });
      const raw = Buffer.from(mime, 'utf8').toString('base64url');

      const sendResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(threadId ? { raw, threadId } : { raw }),
      });
      const sent: any = await sendResponse.json().catch(() => ({}));
      if (!sendResponse.ok || !sent.id) {
        throw new Error('Gmail no pudo enviar el correo. Revisa la autorización de la cuenta.');
      }

      await touchSent(user.id);
      return res.status(200).json({
        ok: true,
        messageId: sent.id,
        threadId: sent.threadId || null,
        from: connection.email,
      });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ ok: false, message: 'Acción o método no permitido.' });
  } catch (error) {
    return apiError(res, error, 'No se pudo completar la operación con Gmail.');
  }
}

