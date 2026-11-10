import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const sql=await fs.readFile(new URL('../supabase/migrations/20261110140000_visit_df_contributions.sql',import.meta.url),'utf8');
for(const table of ['visit_df_invitations','visit_df_contributions']){
 assert.match(sql,new RegExp('create table if not exists public\\.'+table+'\\b','i'));
 assert.match(sql,new RegExp('alter table public\\.'+table+' enable row level security','i'));
}
assert.match(sql,/revoke all on public\.visit_df_invitations, public\.visit_df_contributions from public, anon, authenticated/i);
assert.match(sql,/grant all on public\.visit_df_invitations, public\.visit_df_contributions to service_role/i);
for(const name of ['visit_df_challenge','visit_df_verify','visit_df_submit','visit_df_review']){
 assert.match(sql,new RegExp('function public\\.'+name+'\\(','i'));
}
assert.match(sql,/revoke all on function public\.visit_df_challenge[\s\S]+from public,anon,authenticated;/i);
assert.match(sql,/grant execute on function public\.visit_df_challenge[\s\S]+to service_role;/i);
assert.match(sql,/public\.visit_df_submit\(uuid,text,uuid,text,text\),public\.visit_df_review\(uuid,uuid,integer,boolean\) to service_role;/i);
assert.match(sql,/r\.status<>'draft'/);
assert.match(sql,/r\.revision<>p_revision/);
assert.match(sql,/r\.owner_id<>p_owner/);
assert.match(sql,/for update/g);
assert.match(sql,/on conflict \(invitation_id,operation_id\) do nothing/);
assert.match(sql,/jsonb_set\(state,'\{content,points\}',points\|\|jsonb_build_array\(point\),true\)/);
assert.match(sql,/requests>=10/);
assert.match(sql,/attempts>=5/);
const next=await fs.readFile(new URL('../supabase/migrations/20261110210000_visit_df_direct_access_guard.sql',import.meta.url),'utf8');
assert.match(next,/function public\.visit_df_open\(p_id uuid,p_token_hash text,p_session_hash text\)/);
assert.match(next,/v\.token_hash is distinct from p_token_hash/);
assert.match(next,/revoke all on function public\.visit_df_open\(uuid,text,text\) from public,anon,authenticated/);
assert.match(next,/grant execute on function public\.visit_df_open\(uuid,text,text\) to service_role/);
assert.match(next,/trigger visit_df_close_guard before update of status on public\.visit_minutes/);
assert.match(next,/c\.status='pending'/);
assert.match(next,/function public\.visit_df_return\(p_id uuid,p_owner uuid,p_revision integer,p_reason text\)/);
assert.match(next,/r\.revision<>p_revision/);
assert.match(next,/status='returned'/);
console.log('PASS: DF RLS/service-only RPC, direct personal sessions, review/return provenance and atomic pending-contribution close guard. SQL integration exercised separately.');
