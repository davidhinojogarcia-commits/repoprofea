import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium, webkit, devices } from 'playwright';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const root = new URL('../', import.meta.url).pathname;
const tailwind = process.env.SIGNATURE_TAILWIND_SCRIPT
  ? await readFile(process.env.SIGNATURE_TAILWIND_SCRIPT, 'utf8')
  : await (await fetch('https://cdn.tailwindcss.com', {signal: AbortSignal.timeout(30000)})).text();
const token = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const bundle = (await build({
  stdin: { contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { WorkerQrPortal } from './components/WorkerQrPortal';
    createRoot(document.getElementById('root')).render(<WorkerQrPortal token={new URLSearchParams(location.search).get('worker-qr') || ''}/>);
  `, loader: 'tsx', resolveDir: root },
  bundle: true, format: 'esm', platform: 'browser', write: false,
  plugins: [{ name: 'supabase-transport', setup(b) {
    b.onResolve({ filter: /[/]supabase$/ }, () => ({ path: 'supabase', namespace: 'mock' }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `
      window.calls = [];
      let account = null;
      export const supabase = {
        auth: {
          onAuthStateChange(callback) {
            window.setAccount = id => { account = id; callback(id ? 'SIGNED_IN' : 'SIGNED_OUT', id ? { user: { id } } : null); };
            queueMicrotask(() => window.setAccount(new URLSearchParams(location.search).get('account')));
            return { data: { subscription: { unsubscribe() {} } } };
          },
          async signInWithOtp(value) { window.otp = value; return { error: null }; },
          async signOut() { window.setAccount(null); return { error: null }; }
        },
        async rpc(name, args) {
          window.calls.push({name, args});
          if (name === 'resolve_worker_qr_share') return { valid: args.p_token === '${token}', history: [{}] };
          if (name === 'redeem_worker_qr_visit') return {token:'77777777-7777-4777-8777-777777777777',expiresAt:new Date(Date.now()+1800000).toISOString()};
          if (name === 'close_worker_qr_visit') return null;
          if (name === 'read_worker_qr_visit') return {
            status:'ok', remainingMs: window.quickExpiry ? 400 : 120000, maskedDni:'*****678*',
            worksite:'Obra de visita', periodStart:'2026-11-01', periodEnd:'2026-11-29',
            trainingRecord:'Consta en ficha', aptitudeConclusion:'Apto con limitación',
            workRestrictions:'No realizar trabajos en altura.'
          };
          if (account !== 'authorized' || window.revoked) return null;
          if (window.partial) return { maskedDni: '*****678*', trainingRecord: 'Consta en ficha' };
          return { maskedDni: '*****678*', worksite: 'Obra autorizada', periodStart: '2026-11-01',
            periodEnd: '2026-11-29', contractStatus: 'En periodo registrado', trainingRecord: 'Consta en ficha',
            aptitudeConclusion: 'Apto con limitaciones', dni: '12345678Z', expiresAt: new Date(Date.now() + 60000).toISOString() };
        }
      };
    ` }));
  } }],
})).outputFiles[0].text;
const server = http.createServer((req, res) => {
  if (req.url?.startsWith('/logo-diputacion-profea') && req.url.endsWith('.svg')) {
    res.setHeader('Content-Type', 'image/svg+xml');
    void readFile(root + 'public' + req.url).then(svg => res.end(svg));
    return;
  }
  const script = req.url === '/app.js' || req.url === '/tailwind.js';
  res.setHeader('Content-Type', script ? 'text/javascript' : 'text/html');
  res.end(req.url === '/app.js' ? bundle : req.url === '/tailwind.js' ? tailwind
    : '<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/tailwind.js"></script><style>body{font-family:Inter,system-ui,sans-serif}</style><div id="root"></div><script type="module" src="/app.js"></script></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

const configurations = [
  ['PC Chromium', chromium, {viewport: {width: 1440, height: 900}}],
  ['Android Chromium', chromium, devices['Pixel 7']],
  ['iPhone WebKit', webkit, devices['iPhone 13']],
];

async function pdfText(download) {
  const path = await download.path();
  if (process.env.PROFEA_QR_TEST_PDF && download.suggestedFilename() === 'FICHA_TRABAJADOR_PROFEA.pdf' && !pdfText.saved)
    { await download.saveAs(process.env.PROFEA_QR_TEST_PDF); pdfText.saved = true; }
  const task = getDocument({ data: new Uint8Array(await readFile(path)), useSystemFonts: true });
  try {
    const pdf = await task.promise;
    return (await (await pdf.getPage(1)).getTextContent()).items.map(item => item.str).join(' ');
  } finally {
    await task.destroy();
  }
}

try {
  for (const [label, engine, device] of configurations) {
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage(device);
      const errors = [];
      page.on('pageerror', err => errors.push(err.message));
      const url = 'http://127.0.0.1:' + server.address().port + '/?worker-qr=';
      const protectedFields = page.getByRole('region', { name: 'Datos autorizados del carnet' });
      await page.goto(url + 'incorrecto');
      await page.getByRole('alert').waitFor();
      assert.deepEqual(await page.evaluate(() => window.calls), []);
      await page.goto(url + token);
      const email = page.getByRole('textbox', {name:'Correo autorizado'});
      await email.fill('professional@example.test');
      await page.getByRole('button', {name:'Verificar correo'}).click();
      await page.getByText(/Abre el enlace de verificación/).waitFor();
      assert.equal(await page.evaluate(() => window.otp.options.emailRedirectTo), url + token);
      assert.equal(await page.evaluate(() => window.otp.options.shouldCreateUser), false);
      assert.deepEqual(await page.evaluate(() => window.calls.map(call => call.name)), ['resolve_worker_qr_share']);
      assert.equal(await protectedFields.count(), 0);
      const fullPdf = page.getByRole('button', { name:'Descargar ficha del trabajador' });
      assert.equal(await fullPdf.count(), 0);
      const publicDownload = page.waitForEvent('download');
      await page.getByRole('button', { name:'PDF del estado del carnet' }).click();
      const publicPdf = await publicDownload;
      assert.equal(publicPdf.suggestedFilename(), 'VERIFICACION_PROFEA.pdf');
      const publicText = await pdfText(publicPdf);
      assert.match(publicText, /carnet activo/);
      assert.doesNotMatch(publicText, /\*\*\*|Obra autorizada|Apto con limitaciones/);

      await page.evaluate(() => window.setAccount('unauthorized'));
      await page.getByText(/Esta cuenta no dispone/).waitFor();
      assert.equal(await protectedFields.count(), 0);

      await page.evaluate(() => window.setAccount('authorized'));
      await protectedFields.waitFor();
      for (const field of ['*****678*', 'Obra autorizada', '01/11/2026', '29/11/2026', 'En periodo registrado', 'Consta en ficha', 'Apto con limitaciones']) {
        assert.equal(await protectedFields.getByText(field, { exact: true }).count(), 1, field);
      }
      assert.equal(await page.getByText('12345678Z', { exact: true }).count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const changeAccount = page.getByRole('button', {name:'Cambiar cuenta'});
      assert.ok((await changeAccount.boundingBox()).height >= 44);
      assert.equal(await page.getByRole('button', { name:'PDF del estado del carnet' }).count(), 0);
      const authorizedDownload = page.waitForEvent('download');
      await fullPdf.click();
      const authorizedPdf = await authorizedDownload;
      assert.equal(authorizedPdf.suggestedFilename(), 'FICHA_TRABAJADOR_PROFEA.pdf');
      const text = await pdfText(authorizedPdf);
      for (const expected of ['*****678*', 'Obra autorizada', '01/11/2026', '29/11/2026', 'En periodo registrado', 'Formación PRL de 20 horas', 'Consta en ficha', 'Apto con limitaciones'])
        assert.ok(text.includes(expected), expected);
      assert.doesNotMatch(text, /12345678Z/);

      await page.evaluate(() => { window.partial = true; });
      const partialDownload = page.waitForEvent('download');
      await fullPdf.click();
      const partialText = await pdfText(await partialDownload);
      assert.ok(partialText.includes('*****678*'));
      assert.ok(partialText.includes('Consta en ficha'));
      assert.doesNotMatch(partialText, /Obra autorizada|Apto con limitaciones|29\/11\/2026/);

      let unexpectedDownload = false;
      page.once('download', () => { unexpectedDownload = true; });
      await page.evaluate(() => { window.revoked = true; });
      await fullPdf.click();
      await page.getByRole('alert').filter({ hasText: 'se ha revocado' }).waitFor();
      assert.equal(await fullPdf.count(), 0);
      assert.equal(unexpectedDownload, false);

      await page.getByRole('button', {name:'Cambiar cuenta'}).click();
      await email.waitFor();
      assert.equal(await protectedFields.count(), 0);
      await page.getByRole('textbox', { name:'Código facilitado por el supervisor' }).fill('77777777-7777-4777-8777-777777777777');
      await page.getByRole('button', { name:'Abrir consulta temporal' }).click();
      const visit = page.getByRole('region', { name:'Ficha temporal del trabajador' });
      await visit.getByText('No realizar trabajos en altura.',{exact:true}).waitFor();
      assert.equal(await visit.getByText('Obra de visita',{exact:true}).count(), 1);
      assert.equal(await visit.getByText('29/11/2026',{exact:true}).count(), 1);
      assert.equal(await visit.getByText('*****678*',{exact:true}).count(), 1);
      assert.equal(await visit.getByText('Apto con limitación',{exact:true}).count(), 1);
      assert.equal(await page.getByRole('button', { name:/PDF|Descargar ficha/ }).count(), 0);
      assert.equal(await page.getByText(/David Hinojo García\. Todos los derechos reservados/).count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      if (process.env.PROFEA_QR_VISIT_SCREENSHOT && label === 'iPhone WebKit')
        await page.screenshot({ path: process.env.PROFEA_QR_VISIT_SCREENSHOT, fullPage:true });
      await page.reload();
      await visit.getByText('No realizar trabajos en altura.',{exact:true}).waitFor();
      await page.evaluate(() => {
        window.quickExpiry = true;
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.getByRole('alert').filter({hasText:'ha caducado'}).waitFor();
      assert.equal(await visit.getByText('*****678*',{exact:true}).count(), 0);
      await visit.getByRole('button', { name:'Cerrar visita' }).click();
      await page.getByRole('button', { name:'Abrir consulta temporal' }).waitFor();
      assert.deepEqual(errors, []);
      console.log('PASS ' + label + ': external QR, public/authorized views, public and scoped PDFs, masked DNI, revocation and session cleanup.');
    } finally {
      await browser.close();
    }
  }
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
