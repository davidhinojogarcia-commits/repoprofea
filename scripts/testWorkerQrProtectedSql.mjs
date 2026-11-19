import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const owner = '11111111-1111-4111-8111-111111111111';
const registrar = '22222222-2222-4222-8222-222222222222';
const inspector = '33333333-3333-4333-8333-333333333333';
const unrelated = '44444444-4444-4444-8444-444444444444';
const readOnly = '99999999-9999-4999-8999-999999999999';
const desktop = '55555555-5555-4555-8555-555555555555';
const mobile = '66666666-6666-4666-8666-666666666666';
const card = '77777777-7777-4777-8777-777777777777';
const otherCard = '88888888-8888-4888-8888-888888888888';
const db = new PGlite();
const migration = async name => db.exec(await readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8'));
const query = async (sql, args = []) => (await db.query(sql, args)).rows;
const rpc = async (expression, args = []) => (await query('select ' + expression + ' as result', args))[0].result;
const hash = value => createHash('sha256').update(value).digest('hex');
const as = async (uid, sid = desktop) => {
  await db.exec('reset role; set role authenticated');
  await query("select set_config('request.uid',$1,false), set_config('request.sid',$2,false)", [uid, sid]);
};

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create schema private;
    create schema extensions;
    grant usage on schema auth, private to authenticated;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
    insert into auth.users values
      ('${owner}','owner@example.test',now()), ('${registrar}','register@example.test',now()),
      ('${inspector}','inspection@example.test',now()), ('${unrelated}','other@example.test',null),
      ('${readOnly}','reader@example.test',now());
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.uid',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as
      $$select jsonb_build_object('session_id',current_setting('request.sid',true))$$;
    create function extensions.digest(text,text) returns bytea language sql immutable as
      $$select sha256(convert_to($1,'UTF8'))$$;
    create function private.has_module_permission(text,text) returns boolean language sql stable as
      $$select auth.uid() in ('${owner}'::uuid,'${registrar}'::uuid) or (auth.uid()='${readOnly}'::uuid and $2='read')$$;
    create table private.worker_permissions(recipient uuid, worker_id bigint, owner_id uuid);
    create function private.has_explicit_resource_permission(text,text,uuid,text) returns boolean
      language sql stable security definer set search_path='' as
      $$select exists (select 1 from private.worker_permissions
          where recipient=auth.uid() and worker_id::text=$2 and owner_id=$3 and $4='read')$$;
    insert into private.worker_permissions values ('${registrar}',7,'${owner}'), ('${readOnly}',7,'${owner}');
    create table public.trabajadores(
      owner_id uuid, id bigint, obra_id uuid, supervisor_responsable text, num_oferta text, obra text,
      categoria text, quincena text, apellidos_nombre text, dni text, fecha_nacimiento text,
      periodo_inicio text, periodo_fin text, telefono text, numero_seguridad_social text, iban text,
      calzado text, formacion text, lugar_formacion text, cita_dia text, cita_hora text,
      sitio_reconocimiento text, documentacion_completa text, observaciones text, fecha_registro text,
      necesita_reconocimiento text, aptitud_medica text, reconocimiento_estado text,
      limitaciones_aptitud text, reconocimiento_limitaciones text, reconocimiento_fecha text, reconocimiento_validez text, data jsonb, created_by uuid, updated_by uuid, primary key(owner_id,id)
    );
    alter table public.trabajadores enable row level security;
    grant select, insert on public.trabajadores to authenticated;
    create policy directory_read on public.trabajadores for select to authenticated using (
      private.has_module_permission('trabajadores','read') and (
      owner_id=auth.uid() or private.has_explicit_resource_permission('trabajadores',id::text,owner_id,'read')));
    create policy directory_insert on public.trabajadores for insert to authenticated with check (
      owner_id=auth.uid() and created_by=auth.uid() and updated_by=auth.uid()
      and private.has_module_permission('trabajadores','create'));
    insert into public.trabajadores (owner_id,id,dni,apellidos_nombre,obra,categoria,periodo_inicio,periodo_fin,
      formacion,aptitud_medica,limitaciones_aptitud,iban,telefono) values
      ('${owner}',7,'12345678-Z','PERSONA SINTÉTICA','Obra autorizada','Peón',
        to_char(now() - interval '1 day','YYYY-MM-DD'),to_char(now() + interval '1 day','YYYY-MM-DD'),
        'Sí','Apto con Limitación','TEXTO PRIVADO','IBAN PRIVADO','TELÉFONO PRIVADO'),
      ('${owner}',8,'12345678Z','PERSONA SINTÉTICA','Obra futura','Peón','2099-01-01','2099-01-31','No','Pendiente',null,null,null),
      ('${owner}',9,'87654321X','OTRA PERSONA','Otra obra','Oficial','2020-01-01','2020-01-31','No','Apto',null,null,null),
      ('${registrar}',7,'98765432X','IDENTIFICADOR COINCIDENTE','Obra distinta','Oficial','2020-01-01','2020-01-31','No','Apto',null,null,null);
    create table public.worker_qr_shares(token uuid primary key, owner_id uuid, worker_dni text, revoked_at timestamptz);
    alter table public.worker_qr_shares enable row level security;
    insert into public.worker_qr_shares values ('${card}','${owner}','12345678Z',null), ('${otherCard}','${owner}','87654321X',null);
    create function public.resolve_worker_card_owner(uuid) returns bigint language sql as $$select null::bigint$$;
    revoke all on function public.resolve_worker_card_owner(uuid) from public, anon;
    grant execute on function public.resolve_worker_card_owner(uuid) to authenticated;
    create function public.resolve_worker_qr_occupational(uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
    grant execute on function public.resolve_worker_qr_occupational(uuid) to authenticated;
    create publication supabase_realtime;
  `);
  await migration('20261027165247_restrict_public_worker_qr.sql');
  await migration('20261027171312_worker_card_pairing.sql');
  await migration('20261110070000_inspection_access_scoped.sql');
  await migration('20261119204000_worker_qr_protected_flow.sql');

  const reference = token => rpc('public.resolve_worker_card_reference($1::uuid)', [token]);
  const details = token => rpc('public.read_worker_qr_details($1::uuid)', [token]);
  const grant = (email, role, sections) => rpc('public.issue_inspection_access(7,$1,$2,$3::text[],30,$4)',
    [email, role, sections, 'Identidad profesional comprobada presencialmente']);

  await db.exec('set role anon');
  assert.deepEqual(await rpc('public.resolve_worker_qr_share($1::uuid)', [card]), { valid: true, history: [{}] });
  await assert.rejects(() => details(card), /permission denied/i);
  await assert.rejects(() => reference(card), /permission denied/i);
  await assert.rejects(() => rpc('public.register_worker_from_card($1::jsonb)', [{}]), /permission denied/i);

  await as(owner);
  assert.deepEqual(await reference(card), { id: 7, ownerId: owner }, 'current period wins over future records');
  const full = await details(card);
  assert.deepEqual(Object.keys(full).sort(),
    ['aptitudeConclusion','contractStatus','maskedDni','periodEnd','periodStart','trainingRecord','worksite']);
  assert.equal(full.maskedDni, '*****678*');
  assert.equal(full.worksite, 'Obra autorizada');
  assert.equal(full.contractStatus, 'En periodo registrado');
  assert.equal(full.trainingRecord, 'Consta en ficha');
  assert.equal(full.aptitudeConclusion, 'Apto con limitaciones');
  assert.equal((await details(otherCard)).contractStatus, 'Finalizado');
  await assert.rejects(() => rpc('public.resolve_worker_qr_occupational($1::uuid)', [card]), /permission denied/i);
  const verified = await grant('inspection@example.test','inspector',['identity','employment','worksite','prevention','medical_conclusion']);
  const limited = await grant('inspection@example.test','direccion_facultativa',['identity','prevention']);
  const unverified = await grant('other@example.test','inspector',['identity','medical_conclusion']);

  await as(unrelated);
  assert.equal(await details(card), null, 'unconfirmed email cannot use even a matching grant');
  assert.equal(await reference(card), null);
  assert.deepEqual(await query('select id from public.trabajadores'), []);

  await as(inspector);
  const scoped = await details(card);
  assert.deepEqual(Object.keys(scoped).sort(), ['expiresAt','maskedDni','trainingRecord']);
  assert.equal(await details(otherCard), null, 'grant cannot be reused on a different QR');
  assert.equal(await reference(card), null, 'inspection access is not authorization to import');
  assert.deepEqual(await query('select id from public.trabajadores'), []);
  await assert.rejects(() => query('select * from public.worker_qr_shares'), /permission denied/i);
  await assert.rejects(() => query('select * from public.inspection_access_grants'), /permission denied/i);
  await as(owner);
  assert.equal(await rpc('public.revoke_inspection_access($1::uuid)', [limited]), true);
  await as(inspector);
  assert.deepEqual(Object.keys(await details(card)).sort(), [...Object.keys(full), 'expiresAt'].sort());
  await db.exec('reset role');
  await query("update public.inspection_access_grants set expires_at=now()-interval '1 minute' where id=$1", [verified]);
  assert.equal((await query("select count(*)::int as count from public.inspection_access_audit where event_type='consulted'"))[0].count, 2);
  await as(inspector);
  assert.equal(await details(card), null);
  assert.ok(unverified);

  await as(readOnly);
  assert.deepEqual(await reference(card), { id: 7, ownerId: owner }, 'directory read is independent of creation permission');
  await assert.rejects(() => rpc('public.register_worker_from_card($1::jsonb)', [{}]), /permiso de alta/i);

  await as(registrar);
  assert.equal(await details(card), null, 'directory share alone does not grant external medical access');
  assert.equal(await reference(otherCard), null);
  assert.deepEqual(await reference(card), { id: 7, ownerId: owner });
  const pair = 'P'.repeat(43);
  const phone = 'M'.repeat(43);
  await rpc('public.worker_card_pair_create($1)', [hash(pair)]);
  await as(registrar, mobile);
  assert.equal((await rpc('public.worker_card_pair_connect($1,$2)', [pair, hash(phone)])).valid, true);
  assert.equal(await rpc('public.worker_card_pair_submit($1,$2::uuid)', [phone, card]), false, 'old desktop cannot receive a cross-owner reference');
  await as(registrar);
  const newPair = 'Q'.repeat(43);
  const newPhone = 'N'.repeat(43);
  const pairing = await rpc('public.worker_card_pair_create_v2($1)', [hash(newPair)]);
  await as(registrar, mobile);
  assert.equal((await rpc('public.worker_card_pair_connect($1,$2)', [newPair, hash(newPhone)])).valid, true);
  assert.equal(await rpc('public.worker_card_pair_submit($1,$2::uuid)', [newPhone, card]), true);
  assert.deepEqual(await query('select worker_id from public.worker_card_pair_results'), []);
  await as(registrar);
  assert.deepEqual(await query('select worker_id,worker_owner_id from public.worker_card_pair_results where session_id=$1::uuid', [pairing.id]),
    [{worker_id: 7, worker_owner_id: owner}]);
  const register = worker => rpc('public.register_worker_from_card($1::jsonb)', [worker]);
  const newWorker = { id: 10, owner_id: owner, dni: '12 345678-Z', periodo_inicio: '2030-04-01', periodo_fin: '2030-04-15', data: {} };
  await assert.rejects(() => register({...newWorker, periodo_fin: '2030-02-30'}), /periodo válido/);
  await register(newWorker);
  assert.deepEqual(await reference(card), { id: 10, ownerId: registrar }, 'existing own DNI wins over shared row');
  await assert.rejects(() => register({...newWorker, id: 11, dni: '12345678z'}), /mismo periodo/);
  await register({...newWorker, id: 11, periodo_inicio: '2030-05-01', periodo_fin: '2030-05-15'});
  assert.deepEqual(await query('select distinct owner_id from public.trabajadores where id in (10,11)'), [{owner_id: registrar}]);

  await db.exec('reset role');
  await migration('20261119221000_worker_qr_visit_access.sql');
  await migration('20261119224500_worker_qr_visit_ten_minutes.sql');
  const visitIssue = () => rpc('public.issue_worker_qr_visit(7,$1)', ['Profesional habilitado QA']);
  const redeemVisit = code => rpc('public.redeem_worker_qr_visit($1::uuid)', [code]);
  const readVisit = (session, token = card) => rpc('public.read_worker_qr_visit($1::uuid,$2::uuid)', [session, token]);

  await as(readOnly);
  assert.equal(await visitIssue(), null, 'read-only directorio permission cannot issue a visit');
  await as(owner);
  const invitation = await visitIssue();
  assert.ok(invitation.code);
  const listed = await rpc('public.list_worker_qr_visits(7)');
  assert.equal(listed[0].id, invitation.id);
  assert.ok(!JSON.stringify(listed).includes(invitation.code));
  assert.equal(await rpc("public.save_worker_qr_restrictions(7,'No realizar trabajos en altura.')"), true);
  assert.equal(await rpc("public.get_worker_qr_restrictions(7)"), 'No realizar trabajos en altura.');

  assert.equal((await details(card)).aptitudeConclusion, 'Apto con limitación');
  assert.equal((await details(card)).workRestrictions, 'No realizar trabajos en altura.');

  await db.exec('reset role; set role anon');
  await assert.rejects(() => visitIssue(), /permission denied/i);
  assert.deepEqual(await readVisit(invitation.code), { status: 'visit_closed' });
  const session = await redeemVisit(invitation.code);
  assert.ok(session.token);
  assert.equal(await redeemVisit(invitation.code), null, 'redeeming twice fails');
  const visit = await readVisit(session.token);
  assert.equal(visit.status, 'ok');
  assert.equal(visit.maskedDni, '*****678*');
  assert.equal(visit.worksite, 'Obra autorizada');
  assert.equal(visit.trainingRecord, 'Consta en ficha');
  assert.equal(visit.aptitudeConclusion, 'Apto con limitación');
  assert.equal(visit.workRestrictions, 'No realizar trabajos en altura.');
  assert.ok(visit.remainingMs > 599000 && visit.remainingMs <= 600000);
  assert.ok(!JSON.stringify(visit).match(/TEXTO PRIVADO|IBAN PRIVADO|12345678Z|PERSONA SINTÉTICA/));
  assert.equal((await readVisit(session.token)).expiresAt, visit.expiresAt);
  assert.deepEqual(await readVisit(session.token, otherCard), { status: 'not_available' });

  await db.exec('reset role');
  await query("update public.trabajadores set periodo_inicio = '2026-01-01', periodo_fin = '2099-12-31' where owner_id=$1::uuid and id=9", [owner]);
  await db.exec('set role anon');
  assert.deepEqual(await readVisit(session.token, otherCard), { status: 'not_available' }, 'a current contract from a different worksite is unavailable');
  await db.exec('reset role');
  await query("update public.trabajadores set aptitud_medica = 'No Apto' where owner_id=$1::uuid and id=7", [owner]);
  await as(owner);
  const negativeSigned = await details(card);
  assert.equal(negativeSigned.aptitudeConclusion, undefined);
  assert.equal(negativeSigned.workRestrictions, undefined);
  await db.exec('reset role; set role anon');
  const negative = await readVisit(session.token);
  assert.equal(negative.status, 'ok');
  assert.equal(negative.aptitudeConclusion, undefined);
  assert.equal(negative.workRestrictions, undefined);

  await db.exec('reset role');
  await query("update public.trabajadores set aptitud_medica = 'Apto' where owner_id=$1::uuid and id=7", [owner]);
  await db.exec('set role anon');
  const positive = await readVisit(session.token);
  assert.equal(positive.aptitudeConclusion, 'Apto');
  assert.equal(positive.workRestrictions, undefined);

  await db.exec('reset role');
  await query("update public.trabajadores set aptitud_medica = 'Apto con Limitación' where owner_id=$1::uuid and id=7", [owner]);
  await query("update public.trabajadores set reconocimiento_fecha='2026-10-01' where owner_id=$1::uuid and id=7", [owner]);
  await db.exec('set role anon');
  assert.equal((await readVisit(session.token)).workRestrictions, undefined, 'a changed assessment invalidates the reviewed text');
  await db.exec('reset role');
  await query("update private.worker_qr_visit_reads set expires_at=now()-interval '1 second' where visit_id=$1::uuid", [invitation.id]);
  await db.exec('set role anon');
  assert.deepEqual(await readVisit(session.token), { status: 'card_expired' });
  await as(owner);
  assert.equal(await rpc('public.revoke_worker_qr_visit($1::uuid)', [invitation.id]), true);
  await db.exec('reset role; set role anon');
  assert.deepEqual(await readVisit(session.token), { status: 'visit_closed' });
  await as(owner);
  const closeInvitation = await visitIssue();
  await db.exec('reset role; set role anon');
  const closeSession = await redeemVisit(closeInvitation.code);
  await rpc('public.close_worker_qr_visit($1::uuid)', [closeSession.token]);
  assert.deepEqual(await readVisit(closeSession.token), { status: 'visit_closed' });
  console.log('PASS PostgreSQL: visit activation, role and worksite scope, contract selection, masked DNI, reviewed restrictions and non-renewable expiry.');

  await db.exec('reset role');
  await query('update public.worker_qr_shares set revoked_at=now() where token=$1::uuid', [card]);
  await as(owner);
  assert.equal(await details(card), null);
  assert.equal(await reference(card), null);
  console.log('PASS PostgreSQL: anonymous isolation, scoped and audited external access, expiry, revocation, RLS source, pairing and duplicate protection.');
} finally {
  await db.close();
}
