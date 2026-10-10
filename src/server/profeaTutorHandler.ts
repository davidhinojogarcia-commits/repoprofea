import { PROFEA_TUTOR_VIEW_LABELS, PROFEA_TUTOR_KNOWLEDGE_VERSION } from "../lib/profeaTutorKnowledge.js";
import { authenticateTutorRequest, composeTutorResponseLocal, executeTutorConfirmation, executeTutorTools, normalizeTutorContext, planTutorRequestLocal, TUTOR_AGENT_VERSION } from "./profeaTutorAgent.js";

export async function profeaTutorHandler(req: any, res: any) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Método no permitido." }); }
  if (typeof req.body === "string") {
    try { req.body = JSON.parse(req.body); } catch { return res.status(400).json({ error: "Petición no válida." }); }
  }
    try {
      const question = String(req.body?.question || "").trim();
      if (!question) return res.status(400).json({ error: "Escribe una pregunta sobre GestionProfea." });
      if (question.length > 6000) return res.status(400).json({ error: "La pregunta es demasiado larga." });

      const auth = await authenticateTutorRequest(req.headers?.authorization);
      const context = normalizeTutorContext({
        ...(req.body?.context || {}),
        currentView: req.body?.currentView,
        currentViewLabel: req.body?.currentViewLabel,
        guidedMode: Boolean(req.body?.guidedMode),
      });
      const rawTaskState = req.body?.taskState && typeof req.body.taskState === "object" ? req.body.taskState : {};
      const taskState = {
        title: String(rawTaskState?.title || "").slice(0, 180),
        currentStep: Math.max(0, Number(rawTaskState?.currentStep) || 0),
        totalSteps: Math.max(0, Number(rawTaskState?.totalSteps) || 0),
        status: ["idle","active","diagnostic","completed"].includes(String(rawTaskState?.status))
          ? rawTaskState.status
          : "idle",
        nextAction: String(rawTaskState?.nextAction || "").slice(0, 500),
      } as const;
      const requestId = String(req.body?.requestId || "").trim().slice(0, 180) || `tutor-${Date.now()}`;
      const confirmationToken = String(req.body?.confirmationToken || "").trim().slice(0, 600000);

      let plan = planTutorRequestLocal(question, context, taskState);
      const toolResults = confirmationToken
        ? [await executeTutorConfirmation({ confirmationToken, context, token: auth.token, userId: auth.userId })]
        : plan.toolCalls.length
          ? await executeTutorTools(plan.toolCalls, context, auth.token, requestId, question, auth.userId)
          : [];
      plan = composeTutorResponseLocal(plan, toolResults);

      const clientActions = toolResults.flatMap(result => result.clientAction ? [result.clientAction] : []);
      const pendingConfirmation = toolResults.find(result => result.confirmation)?.confirmation || null;
      const allowedViews = Object.keys(PROFEA_TUTOR_VIEW_LABELS);
      const suggestedView = (plan.suggestedView !== "administracion" || auth.role === "admin") && allowedViews.includes(String(plan.suggestedView || "")) ? String(plan.suggestedView) : "";

      res.json({
        success: true,
        provider: "local",
        agentVersion: TUTOR_AGENT_VERSION,
        knowledgeVersion: PROFEA_TUTOR_KNOWLEDGE_VERSION,
        answer: plan.answer,
        verified: toolResults.length > 0 && toolResults.every(result => result.ok && result.verified),
        toolResults: toolResults.map(result => ({
          name: result.name,
          ok: result.ok,
          verified: result.verified,
          summary: result.summary,
          data: result.data,
          error: result.error,
        })),
        pendingConfirmation,
        incidentForm: Boolean(plan.incidentForm),
        incidentDefaults: plan.incidentForm ? plan.incidentDefaults || {} : undefined,
        clientActions,
        suggestedView,
        suggestedLabel: suggestedView ? String(PROFEA_TUTOR_VIEW_LABELS[suggestedView as keyof typeof PROFEA_TUTOR_VIEW_LABELS] || "") : "",
        followUps: plan.followUps.slice(0, 4),
        progressHint: plan.progressHint.slice(0, 180),
        taskTitle: plan.taskTitle.slice(0, 180),
        currentStep: Math.max(0, Number(plan.currentStep) || 0),
        totalSteps: Math.max(0, Number(plan.totalSteps) || 0),
        taskStatus: plan.taskStatus,
        nextAction: plan.nextAction.slice(0, 500),
        checkQuestion: plan.checkQuestion.slice(0, 240),
        checkOptions: plan.checkOptions.slice(0, 4),
      });
    } catch (error: any) {
      const status = Number(error?.status) || 500;
      if (status >= 500) console.error("Tutor PROFEA: operación no completada.");
      res.status(status === 401 || status === 403 ? status : 500).json({
        error: status === 401 ? "La sesión ha caducado. Vuelve a iniciar sesión." : status === 403 ? "Tu cuenta no tiene acceso a esta operación. Comprueba sus permisos." : "No se pudo completar la operación del Tutor. Comprueba el módulo antes de repetirla.",
      });
    }
}
