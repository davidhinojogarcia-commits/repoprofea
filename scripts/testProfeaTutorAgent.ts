import assert from "node:assert/strict";
import { composeTutorResponseLocal, executeTutorConfirmation, executeTutorTools, normalizeTutorContext, planTutorRequestLocal, toolCatalogForPrompt, TUTOR_AGENT_VERSION } from "../src/server/profeaTutorAgent";
import { getTutorKnowledgeSlice } from "../src/lib/profeaTutorKnowledge";

const context = normalizeTutorContext({
  currentView: "prevencion",
  currentViewLabel: "Prevención",
  guidedMode: true,
  obra: "OBRA A",
  periodo: "1ª quincena octubre 2026",
  filters: { obra: "OBRA A" },
});
assert.equal(context.currentView, "prevencion");
assert.equal(context.obra, "OBRA A");
assert.equal(context.periodo, "1ª quincena octubre 2026");

const invalid = normalizeTutorContext({ currentView: "javascript:alert(1)", obra: 42 });
assert.equal(invalid.currentView, "");
assert.equal(invalid.obra, "");

const names: string[] = toolCatalogForPrompt().map(item => item.name);
assert.deepEqual(names, [
  "list_works",
  "search_workers",
  "list_pending_medical",
  "navigate",
  "apply_filters",
  "create_prevention_incident",
  "list_mandatory_documents",
  "prepare_inventory_fault_report",
  "prepare_delete_mandatory_documents",
]);
assert.ok(TUTOR_AGENT_VERSION.length > 0);
assert.equal(names.includes("sql"), false);
assert.equal(names.includes("delete_documents"), false);

console.log("Tutor PROFEA agent policy tests: OK");


const localWorksPlan = planTutorRequestLocal("Muéstrame mis obras", context);
assert.equal(localWorksPlan.toolCalls[0]?.name, "list_works");

const localNavigationPlan = planTutorRequestLocal("Abre prevención", context);
assert.equal(localNavigationPlan.toolCalls[0]?.name, "navigate");
assert.equal(localNavigationPlan.suggestedView, "prevencion");

const localHelpPlan = planTutorRequestLocal("¿Cómo sigo con este candidato?", { currentView: "sae" });
assert.equal(localHelpPlan.toolCalls.length, 0);
assert.match(localHelpPlan.answer, /SAE|candidato|selección/i);

const localComposed = composeTutorResponseLocal(localWorksPlan, [{
  name: "list_works",
  ok: true,
  verified: true,
  summary: "1 obra visible.",
  data: [{ nombre: "OBRA A" }],
}]);
assert.match(localComposed.answer, /1 obra visible/);
assert.equal(localComposed.taskStatus, "completed");


const preventionKnowledge = getTutorKnowledgeSlice("Registra una incidencia en esta obra", "prevencion");
assert.match(preventionKnowledge, /PREVENCIÓN E INCIDENCIAS/);
assert.doesNotMatch(preventionKnowledge, /SAE \/ SELECCIÓN/);

const saeKnowledge = getTutorKnowledgeSlice("¿Cómo sigo con este candidato?", "sae");
assert.match(saeKnowledge, /SAE \/ SELECCIÓN/);
assert.doesNotMatch(saeKnowledge, /HERRAMIENTAS Y MAQUINARIA/);


process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "test-publishable";
process.env.VITE_SUPABASE_URL = "https://example.supabase.test";
process.env.TUTOR_CONFIRMATION_SECRET = "test-confirmation-secret";

const originalFetch = globalThis.fetch;
const calls: Array<{ url: string; method: string; body: any }> = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const method = String(init?.method || "GET").toUpperCase();
  let body: any = null;
  try { body = init?.body ? JSON.parse(String(init.body)) : null; } catch { body = init?.body; }
  calls.push({ url, method, body });

  if (url.includes("/rest/v1/obras?")) {
    return new Response(JSON.stringify([{ id: "o1", codigo: "001", nombre: "OBRA A", municipio: "X" }]), { status: 200 });
  }
  if (url.includes("/rest/v1/rpc/save_prevention_record")) {
    return new Response(JSON.stringify({ id: "11111111-1111-4111-8111-111111111111", obra: "OBRA A", status: "pending", updated_at: "2026-10-06T20:00:00Z" }), { status: 200 });
  }
  if (url.includes("/rest/v1/foreman_mandatory_documents?select=id,obra,period_key")) {
    return new Response(JSON.stringify([
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", obra: "OBRA A", period_key: "P1", work_date: "2026-10-01", document_type: "inicio", category: "Peón", status: "pending" },
      { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", obra: "OBRA A", period_key: "P1", work_date: "2026-10-01", document_type: "control_presencia", category: "", status: "pending" },
    ]), { status: 200 });
  }
  if (url.includes("/rest/v1/foreman_mandatory_documents?select=id,obra&id=in.")) {
    return new Response(JSON.stringify([
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", obra: "OBRA A" },
      { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", obra: "OBRA A" },
    ]), { status: 200 });
  }
  if (url.includes("/rest/v1/rpc/delete_foreman_mandatory_documents")) {
    return new Response(JSON.stringify(2), { status: 200 });
  }
  return new Response(JSON.stringify({ message: "unexpected test URL" }), { status: 404 });
}) as typeof fetch;

try {
  const read = await executeTutorTools([{ name: "list_works" }], context, "token", "r1", "Lista las obras", "user-1");
  assert.equal(read[0].ok, true);
  assert.equal(read[0].verified, true);

  const blockedWrite = await executeTutorTools([{
    name: "create_prevention_incident",
    arguments: { obra: "OBRA A", workDate: "2026-10-06", category: "Otros", severity: "medium", title: "Protección", task: "Trabajo", description: "Falta protección" },
  }], context, "token", "r2", "¿Qué harías con esta incidencia?", "user-1");
  assert.equal(blockedWrite[0].error, "EXPLICIT_MUTATION_REQUIRED");

  const created = await executeTutorTools([{
    name: "create_prevention_incident",
    arguments: { obra: "OBRA A", workDate: "2026-10-06", category: "Otros", severity: "medium", title: "Protección", task: "Trabajo", description: "Falta protección" },
  }], context, "token", "r3", "Registra una incidencia por falta de protección", "user-1");
  assert.equal(created[0].ok, true);
  assert.match(created[0].summary, /confirmada por la base de datos/);

  const prepared = await executeTutorTools([{
    name: "prepare_delete_mandatory_documents",
    arguments: { obra: "OBRA A" },
  }], context, "token", "r4", "Borra todos los documentos de esta obra", "user-1");
  assert.equal(prepared[0].ok, true);
  assert.equal(prepared[0].confirmation?.recordsAffected, 2);
  assert.match(prepared[0].summary, /No se ha borrado nada todavía/);

  const stale = await executeTutorConfirmation({
    confirmationToken: prepared[0].confirmation!.token,
    context: { ...context, obra: "OTRA OBRA" },
    token: "token",
    userId: "user-1",
  });
  assert.equal(stale.error, "STALE_CONTEXT");

  const confirmed = await executeTutorConfirmation({
    confirmationToken: prepared[0].confirmation!.token,
    context,
    token: "token",
    userId: "user-1",
  });
  assert.equal(confirmed.ok, true);
  assert.match(confirmed.summary, /2 documentos/);
  assert.equal(calls.filter(call => call.url.includes("delete_foreman_mandatory_documents")).length, 1);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Tutor PROFEA tool execution and confirmation tests: OK");
