import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {id,content,person} from './visitMinutesFixture.mjs';
export async function visitTestServer(){
 process.env.SUPABASE_SERVICE_ROLE_KEY='service-test';process.env.GOOGLE_GMAIL_CLIENT_ID='client-test';process.env.GOOGLE_GMAIL_CLIENT_SECRET='client-secret-test';process.env.GMAIL_TOKEN_ENCRYPTION_KEY='visit-tests-encryption-key-32-bytes';
 const db=new PGlite(),out=new URL(`./.visit-handler-test-${randomUUID()}.mjs`,import.meta.url);
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema private;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table profiles(id uuid primary key,email text,active boolean default true,role text default 'user');
 create table obras(id uuid primary key,owner_id uuid,nombre text,codigo text,municipio text,descripcion text);
 create table foreman_portal_access(id uuid primary key,owner_id uuid,obra text,foreman_name text,token_hash text,active boolean default true);
 grant all on foreman_portal_access to service_role;
 create table data_permissions(user_id uuid,resource_type text,resource_id text,can_read boolean,can_update boolean default false);
 create table gmail_connections(user_id uuid,email text,refresh_token_encrypted text,scope text,last_sent_at timestamptz);
 create function private.has_obra_permission(uuid,text,text) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.data_permissions where user_id=auth.uid() and resource_type='obra' and resource_id=$1::text and case when $3='update' then can_update else can_read end)$$;
 grant usage on schema auth,private to authenticated,anon,service_role;
 grant select on profiles,obras to authenticated;grant all on profiles,obras,data_permissions,gmail_connections to service_role;
 alter table obras enable row level security;
 create policy works_read on obras for select to authenticated using(owner_id=auth.uid() or private.has_obra_permission(id,nombre,'read'));
 grant execute on function private.has_obra_permission(uuid,text,text) to authenticated;`);
 await db.exec(await fs.readFile(new URL('../supabase/migrations/20261016102205_worksite_visit_minutes.sql',import.meta.url),'utf8'));
 await db.exec(await fs.readFile(new URL('../supabase/migrations/20261017083229_visit_work_orders.sql',import.meta.url),'utf8'));
 for(const n of [1,2,3,4])await db.query('insert into profiles(id,email,active) values($1,$2,$3)',[id(n),`supervisor${n}@example.test`,n!==4]);
 await db.query('insert into obras values($1,$2,$3,$4,$5,$6),($7,$8,$9,$10,$11,$12)',[id(10),id(1),content.worksite,content.code,content.municipality,'Obra sintética',id(11),id(2),'Obra ajena','99999GR','Otra localidad','']);
 await db.query('insert into data_permissions(user_id,resource_type,resource_id,can_read) values($1,$2,$3,true)',[id(3),'obra',id(10)]);
 await build({stdin:{contents:"export {default as gmailHandler} from './api/gmail'; export {encryptToken} from './src/server/gmailOAuth';",resolveDir:new URL('../',import.meta.url).pathname},outfile:out.pathname,bundle:true,platform:'node',format:'esm',packages:'external'});
 const {gmailHandler,encryptToken}=await import(out.href+'?t='+Date.now());
 await db.query('insert into gmail_connections values($1,$2,$3,$4,null)',[id(1),'supervisor@example.test',encryptToken('test-refresh-token'),'https://www.googleapis.com/auth/gmail.send']);
 const sent=[],calls=[],problems=[],originalFetch=globalThis.fetch;let googleMode='ok',persistSentFailure=false;let serialized=Promise.resolve();
 const sqlIdentifier=value=>{if(!/^[a-z_][a-z_0-9]*$/.test(value))throw Error('Unsafe test identifier '+value);return '"'+value+'"';};
 const handleDatabase=async(url,init)=>{
  const u=new URL(url),table=u.pathname.split('/rest/v1/')[1],auth=new Headers(init.headers).get('authorization'),service=auth==='Bearer service-test',user=auth?.match(/^Bearer user-(\d)$/)?.[1];
  await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user?id(Number(user)):'']);await db.exec('set role '+(service?'service_role':user?'authenticated':'anon'));
  const args=[],where=[];let body=init.body?JSON.parse(init.body):undefined;
  if(table.startsWith('rpc/')){const fn=table.slice(4);if(persistSentFailure&&fn==='visit_minutes_finish_mail'&&body.p_status==='sent'){persistSentFailure=false;throw Error('Simulated acknowledgement persistence failure');}const fields=Object.entries(body);const sql='select public.'+sqlIdentifier(fn)+'('+fields.map(([key,value])=>{args.push(key==='p_scopes'?'{'+value.join(',')+'}':typeof value==='object'&&value!==null?JSON.stringify(value):value);return sqlIdentifier(key)+'=> $'+args.length;}).join(',')+') result';return(await db.query(sql,args)).rows[0].result;}
  for(const [key,value]of u.searchParams){if(['select','order','limit','offset'].includes(key))continue;if(value.startsWith('eq.')){const v=value.slice(3);args.push(v==='true'?true:v==='false'?false:v);where.push(sqlIdentifier(key)+'=$'+args.length);}else if(value.startsWith('ilike.')){args.push(value.slice(6).replaceAll('*','%'));where.push(sqlIdentifier(key)+' ilike $'+args.length);}else if(value.startsWith('in.(')||value.startsWith('not.in.(')){const neg=value.startsWith('not.');const entries=value.slice(neg?8:4,-1).split(',');where.push(sqlIdentifier(key)+(neg?' not in (':' in (')+entries.map(v=>{args.push(v);return '$'+args.length;}).join(',')+')');}else if(value.startsWith('lt.')){args.push(value.slice(3));where.push(sqlIdentifier(key)+'<$'+args.length);}else throw Error('Unknown filter '+value);}
  const clause=where.length?' where '+where.join(' and '):'';
  if((init.method||'GET')==='GET'){
    const select=(u.searchParams.get('select')||'*').split(',').map(v=>v==='*'?'*':sqlIdentifier(v)).join(',');
    const order=u.searchParams.get('order')?' order by '+u.searchParams.get('order').split(',').map(item=>{const [key,direction]=item.split('.');return sqlIdentifier(key)+(direction==='desc'?' desc':' asc');}).join(','):'';
    const limit=' limit '+Math.min(1000,Number(u.searchParams.get('limit'))||1000)+' offset '+(Number(u.searchParams.get('offset'))||0);
    return(await db.query('select '+select+' from public.'+sqlIdentifier(table)+clause+order+limit,args)).rows;
  }
  if((init.method||'POST')==='PATCH'){
    if(persistSentFailure&&table==='visit_minutes_mail_jobs'&&body.status==='sent'){persistSentFailure=false;throw Error('Simulated acknowledgement persistence failure');}
    const set=Object.entries(body).map(([key,value])=>{args.push(key==='p_scopes'?'{'+value.join(',')+'}':typeof value==='object'&&value!==null?JSON.stringify(value):value);return sqlIdentifier(key)+'=$'+args.length;}).join(',');
    return(await db.query('update public.'+sqlIdentifier(table)+' set '+set+clause+' returning *',args)).rows;
  }
  const entries=Object.entries(body);args.push(...entries.map(([,value])=>typeof value==='object'&&value!==null?JSON.stringify(value):value));
  return(await db.query('insert into public.'+sqlIdentifier(table)+'('+entries.map(([key])=>sqlIdentifier(key)).join(',')+') values('+args.map((_,i)=>'$'+(i+1)).join(',')+') returning *',args)).rows;
 };
 globalThis.fetch=async(url,init={})=>{
   const target=String(url);calls.push({url:target,method:init.method||'GET'});
   if(target.includes('/auth/v1/user')){const n=new Headers(init.headers).get('authorization')?.match(/^Bearer user-(\d)$/)?.[1];return new Response(JSON.stringify(n?{id:id(Number(n)),email:`supervisor${n}@example.test`}:{}),{status:n?200:401});}
   if(target.includes('/rest/v1/')){
     let resolve;const before=serialized;serialized=new Promise(r=>{resolve=r;});await before;
     try{const data=await handleDatabase(target,init);return new Response(JSON.stringify(data),{status:200});}catch(e){problems.push(e.message);return new Response(JSON.stringify({message:e.message}),{status:400});}finally{resolve();}
   }
   if(target==='https://oauth2.googleapis.com/token')return new Response(JSON.stringify({access_token:'access-test',expires_in:3600}),{status:200});
   if(target==='https://gmail.googleapis.com/gmail/v1/users/me/messages/send'){
     const raw=Buffer.from(JSON.parse(init.body).raw,'base64url').toString('utf8');
     const encoded=raw.match(/Content-Type: text\/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/)[1];
     const body=Buffer.from(encoded.replace(/\s/g,''),'base64').toString('utf8');
     if(googleMode==='network')throw Error('network');if(googleMode==='unauthorized')return new Response('{}',{status:401});if(googleMode==='quota')return new Response('{}',{status:429});if(googleMode==='no-id')return new Response('{}',{status:200});
     sent.push({raw,body,id:'gmail-'+(sent.length+1)});return new Response(JSON.stringify({id:sent.at(-1).id}),{status:200});
   }
   throw Error('Real external call forbidden in visit tests: '+target);
 };
 const invoke=async(body,user=1)=>{let status=200,headers={};const res={setHeader(k,v){headers[k]=v;},status(s){status=s;return this;},json(data){return{status,data,headers};}};return gmailHandler({method:'POST',query:{action:'visit-minutes'},headers:user?{authorization:'Bearer user-'+user}:{},body},res);};
 const cleanup=async()=>{globalThis.fetch=originalFetch;await db.exec('reset role');await db.close();await fs.rm(out,{force:true});};
 return{db,invoke,sent,calls,problems,cleanup,setGoogleMode:v=>{googleMode=v;},failNextSentPersist:()=>{persistSentFailure=true;}};
}
