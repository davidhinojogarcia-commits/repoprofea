import assert from "node:assert/strict";
import { normalizeTutorContext, toolCatalogForPrompt, TUTOR_AGENT_VERSION } from "../src/server/profeaTutorAgent";
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
  "prepare_delete_mandatory_documents",
]);
assert.ok(TUTOR_AGENT_VERSION.length > 0);
assert.equal(names.includes("sql"), false);
assert.equal(names.includes("delete_documents"), false);

console.log("Tutor PROFEA agent policy tests: OK");

const preventionKnowledge = getTutorKnowledgeSlice("Registra una incidencia en esta obra", "prevencion");
assert.match(preventionKnowledge, /PREVENCIÓN E INCIDENCIAS/);
assert.doesNotMatch(preventionKnowledge, /SAE \/ SELECCIÓN/);

const saeKnowledge = getTutorKnowledgeSlice("¿Cómo sigo con este candidato?", "sae");
assert.match(saeKnowledge, /SAE \/ SELECCIÓN/);
assert.doesNotMatch(saeKnowledge, /HERRAMIENTAS Y MAQUINARIA/);
