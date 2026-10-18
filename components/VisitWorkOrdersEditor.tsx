import React, { useEffect, useState } from "react";
import { visitRequest } from "../src/services/visitMinutesService";
import { appPrompt, appConfirm } from "../src/lib/appDialog";
import {
  personName,
  type VisitContent,
  type VisitPerson,
  type VisitPoint,
} from "../src/lib/visitMinutes";
import {
  ORDERS_NOTICE,
  ORDER_NATURE_LABELS,
  type WorkOrderDefinition,
  type OrderNature,
} from "../src/lib/visitWorkOrders";
import { visitInput } from "./VisitContactsPanel";
const btn = "min-h-[46px] rounded-xl border px-4 py-2 font-bold";
export function VisitWorkOrdersEditor({
  content,
  people,
  onChange,
  permissionsOnly = false,
  orderSeed,
  onOrderSeedHandled,
}: {
  content: VisitContent;
  people: VisitPerson[];
  onChange: (c: VisitContent) => void;
  permissionsOnly?: boolean;
  orderSeed?: VisitPoint | null;
  onOrderSeedHandled?: () => void;
}) {
  const [context, setContext] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [person, setPerson] = useState(""),
    [scopes, setScopes] = useState<OrderNature[]>([]),
    [verify, setVerify] = useState(false),
    [user, setUser] = useState(""),
    [reason, setReason] = useState("");
  const [pending, setPending] = useState<any[]>([]),
    [offset, setOffset] = useState(0),
    [more, setMore] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setContext(null);
    setPending([]);
    setOffset(0);
    setError("");
    Promise.all([
      visitRequest(
        { action: "orders-context", worksiteId: content.worksiteId },
        { signal: abort.signal },
      ),
      permissionsOnly ? Promise.resolve({orders:[],hasMore:false,nextOffset:0}) : visitRequest(
        { action: "orders-list", worksiteId: content.worksiteId },
        { signal: abort.signal },
      ),
    ])
      .then(([c, p]) => {
        setContext(c);
        setPending(p.orders);
        setMore(p.hasMore);
        setOffset(p.nextOffset);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [content.worksiteId,permissionsOnly]);
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const orders = content.orders || [];
  const update = (id: string, patch: Partial<WorkOrderDefinition>) =>
    onChange({
      ...content,
      orders: orders.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    });
  const add = (seed?: VisitPoint) => {
    const a = context?.authorities.find((a: any) => a.active);
    if (!a) {
      setError(
        "Autoriza expresamente a un emisor antes de añadir órdenes. La asistencia no concede competencias.",
      );
      return;
    }
    const nature = a.scopes[0] as OrderNature;
    onChange({
      ...content,
      orders: [
        ...orders,
        {
          id: crypto.randomUUID(),
          number: Math.max(0, ...orders.map((o) => o.number)) + 1,
          type: nature === "recommendation" ? "recommendation" : "order",
          nature,
          issuerId: a.personId,
          issuerName: a.name,
          issuerRole: a.role,
          issuerEntity: a.entity,
          recipientId: "",
          recipient: "",
          description: seed?.description || "",
          location: "",
          issuedDate: content.date,
          deadline: "",
          priority: "normal",
          observations: "",
          attachmentIds: seed?.attachmentIds || [],
          officialReference: "",
          reservedDecision: false,
          authorizationReference: "",
          visibility: "worksite",
          foremanAccessIds: [],
          foremanCanReport: false,
        },
      ],
    });
  };
  useEffect(()=>{
    if(!orderSeed||!context)return;
    add(orderSeed);onOrderSeedHandled?.();
  },[orderSeed?.id,context]);
  return (
    <section className="space-y-4">
      <h3 className="text-lg font-black">{permissionsOnly?'Competencias para órdenes de obra':'ÓRDENES E INSTRUCCIONES DE OBRA'}</h3>
      {!permissionsOnly&&<p className="text-sm">{ORDERS_NOTICE}</p>}
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {permissionsOnly&&context?.canManage && (
        <details className="rounded-xl border p-3">
          <summary className="font-bold cursor-pointer">
            Autorizar emisores y responsables de comprobación
          </summary>
          <p className="my-2 text-sm">
            La autorización debe corresponder a las competencias reales de la
            persona. Añade primero los asistentes en el apartado de
            participantes.
          </p>
          <label>
            Persona
            <select
              className={visitInput}
              aria-label="Persona"
              value={person}
              onChange={(e) => setPerson(e.target.value)}
            >
              <option value="">Seleccionar…</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {personName(p)} · {p.role}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-4 my-3">
            {Object.entries(ORDER_NATURE_LABELS).map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={scopes.includes(key as OrderNature)}
                  onChange={(e) =>
                    setScopes(
                      e.target.checked
                        ? [...scopes, key as OrderNature]
                        : scopes.filter((s) => s !== key),
                    )
                  }
                />{" "}
                {label}
              </label>
            ))}
          </div>
          <label className="block">
            <input
              type="checkbox"
              checked={verify}
              onChange={(e) => setVerify(e.target.checked)}
            />{" "}
            Puede comprobar y verificar el cumplimiento
          </label>
          <label>
            Usuario autorizado de la obra (obligatorio para verificar)
            <select
              className={visitInput}
              value={user}
              onChange={(e) => setUser(e.target.value)}
            >
              <option value="">Sin cuenta vinculada</option>
              {context.users.map((u: any) => (
                <option key={u.id} value={u.id}>
                  {u.email}
                </option>
              ))}
            </select>
          </label>
          <label>
            Justificación de las competencias
            <textarea
              className={visitInput}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button
            type="button"
            className={btn}
            disabled={busy || !person || !scopes.length || (verify && !user)}
            onClick={() =>
              void run(async () => {
                const p = people.find((p) => p.id === person)!;
                await visitRequest({
                  action: "orders-authorize",
                  worksiteId: content.worksiteId,
                  authority: {
                    personId: p.id,
                    name: personName(p),
                    role: p.role,
                    entity: p.entity,
                    scopes,
                    userId: user,
                    canVerify: verify,
                    justification: reason,
                    active: true,
                  },
                });
                setContext(
                  await visitRequest({
                    action: "orders-context",
                    worksiteId: content.worksiteId,
                  }),
                );
                setReason("");
              })
            }
          >
            Guardar autorización expresa
          </button>
          <ul>
            {context.authorities.map((a: any) => (
              <li key={a.personId} className="my-2">
                {a.name} · {a.role} · {a.active ? "Vigente" : "Revocada"} ·{" "}
                {a.scopes
                  .map((s: OrderNature) => ORDER_NATURE_LABELS[s])
                  .join(", ")}{" "}
                {a.canVerify ? "· Verificador" : ""}{" "}
                {a.active && (
                  <button
                    type="button"
                    className={btn}
                    disabled={busy || reason.trim().length < 5}
                    onClick={() =>
                      void run(async () => {
                        await visitRequest({
                          action: "orders-authorize",
                          worksiteId: content.worksiteId,
                          authority: {
                            ...a,
                            justification: reason,
                            active: false,
                          },
                        });
                        setContext(
                          await visitRequest({
                            action: "orders-context",
                            worksiteId: content.worksiteId,
                          }),
                        );
                      })
                    }
                  >
                    Revocar (requiere justificación)
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {!permissionsOnly&&<>{orders.map(o=><fieldset key={o.id} className="rounded-xl border p-3 space-y-3"><legend className="font-black">Orden {o.number}</legend>
        <label className="block font-bold">Descripción detallada<textarea className={visitInput} required rows={3} value={o.description} onChange={e=>update(o.id,{description:e.target.value})}/></label>
        <label className="block">Emisor autorizado<select className={visitInput} value={o.issuerId} onChange={e=>{const a=context?.authorities.find((a:any)=>a.personId===e.target.value);if(a)update(o.id,{issuerId:a.personId,issuerName:a.name,issuerRole:a.role,issuerEntity:a.entity});}}>{!context?.authorities.some((a:any)=>a.personId===o.issuerId)&&<option value={o.issuerId}>{o.issuerName}</option>}{context?.authorities.filter((a:any)=>a.active&&a.scopes.includes(o.nature)).map((a:any)=><option key={a.personId} value={a.personId}>{a.name} · {a.role} · {a.entity}</option>)}</select></label>
        <label className="block">Destinatario o responsable<input className={visitInput} placeholder="Opcional · intervinientes de la obra" value={o.recipient} onChange={e=>update(o.id,{recipient:e.target.value,recipientId:''})}/></label>
        <div className="grid gap-3 sm:grid-cols-2"><label>Plazo de cumplimiento<input className={visitInput} type="date" value={o.deadline} onChange={e=>update(o.id,{deadline:e.target.value})}/></label><label>Prioridad<select className={visitInput} value={o.priority} onChange={e=>update(o.id,{priority:e.target.value as any})}><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option></select></label></div>
        <details className="rounded-xl border p-3"><summary className="min-h-[44px] font-bold cursor-pointer">Datos técnicos, evidencias y permisos</summary><div className="space-y-3">
          <label className="block">Número<input className={visitInput} type="number" min="1" value={o.number} onChange={e=>update(o.id,{number:Number(e.target.value)})}/></label>
          <label className="block">Tipo<select className={visitInput} value={o.type} onChange={e=>update(o.id,{type:e.target.value as any,nature:e.target.value==='recommendation'?'recommendation':o.nature==='recommendation'?'technical':o.nature})}><option value="order">Orden</option><option value="technical_instruction">Instrucción técnica</option><option value="recommendation">Recomendación</option></select></label>
          <label className="block">Naturaleza<select className={visitInput} value={o.nature} onChange={e=>update(o.id,{nature:e.target.value as OrderNature,type:e.target.value==='recommendation'?'recommendation':o.type==='recommendation'?'order':o.type})}>{Object.entries(ORDER_NATURE_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
          <label className="block">Destinatario asistente (opcional)<select className={visitInput} value={o.recipientId} onChange={e=>{const p=people.find(p=>p.id===e.target.value);update(o.id,{recipientId:p?.id||'',recipient:p?personName(p):''});}}><option value="">Intervinientes de la obra / otro responsable</option>{people.map(p=><option key={p.id} value={p.id}>{personName(p)}</option>)}</select></label>
          <label className="block">Zona de la obra<input className={visitInput} value={o.location} onChange={e=>update(o.id,{location:e.target.value})}/></label>
          <label className="block">Fecha de emisión<input className={visitInput} type="date" value={o.issuedDate} onChange={e=>update(o.id,{issuedDate:e.target.value})}/></label>
          {(['observations','officialReference','authorizationReference','correctionReason'] as const).map((key,i)=><label className="block" key={key}>{['Observaciones','Referencia al libro o documento oficial','Autorización del órgano competente','Justificación de corrección de una orden ya emitida'][i]}<textarea className={visitInput} value={o[key]||''} onChange={e=>update(o.id,{[key]:e.target.value})}/></label>)}
          <label className="flex min-h-[44px] items-center gap-2"><input type="checkbox" checked={o.reservedDecision} onChange={e=>update(o.id,{reservedDecision:e.target.checked})}/>Afecta a una decisión reservada a un órgano competente</label>
          <div><strong>Fotografías y documentos del acta asociados</strong>{content.attachments.map(a=><label className="flex min-h-[44px] items-center gap-2" key={a.id}><input type="checkbox" checked={o.attachmentIds.includes(a.id)} onChange={e=>update(o.id,{attachmentIds:e.target.checked?[...o.attachmentIds,a.id]:o.attachmentIds.filter(id=>id!==a.id)})}/>{a.name}</label>)}</div>
          <label className="block">Visibilidad en el portal<select className={visitInput} value={o.visibility} onChange={e=>update(o.id,{visibility:e.target.value as any})}><option value="worksite">Encargados de esta obra</option><option value="restricted">Confidencial: solo accesos seleccionados</option></select></label>
          {o.visibility==='restricted'&&<p className="text-sm">El PDF completo solo será accesible a encargados autorizados para todas las órdenes que contiene.</p>}
          {context?.accesses.map((a:any)=><label className="flex min-h-[44px] items-center gap-2" key={a.id}><input type="checkbox" checked={o.foremanAccessIds.includes(a.id)} onChange={e=>update(o.id,{foremanAccessIds:e.target.checked?[...o.foremanAccessIds,a.id]:o.foremanAccessIds.filter(id=>id!==a.id)})}/>{a.foreman_name}</label>)}
          <label className="flex min-h-[44px] items-center gap-2"><input type="checkbox" checked={o.foremanCanReport} onChange={e=>update(o.id,{foremanCanReport:e.target.checked})}/>Autorizar avances y evidencias del encargado</label>
        </div></details>
        <button type="button" className={btn} onClick={()=>onChange({...content,orders:orders.filter(x=>x.id!==o.id)})}>Quitar del borrador (las órdenes emitidas se conservan)</button>
      </fieldset>)}
      <button
        type="button"
        className={btn}
        disabled={!context || busy}
        onClick={()=>add()}
      >
        + AÑADIR ORDEN O INSTRUCCIÓN
      </button>
      <section className="rounded-xl border p-3 space-y-2">
        <h4 className="font-black">ÓRDENES PENDIENTES DE VISITAS ANTERIORES</h4>
        <p className="text-sm">
          Se enlazan por su identificador, sin duplicar la orden original ni su
          historial.
        </p>
        {pending
          .filter((o) => !orders.some((x) => x.id === o.id))
          .map((o) => (
            <label className="block" key={o.id}>
              <input
                type="checkbox"
                checked={(content.orderReferences || []).some(
                  (r) => r.id === o.id,
                )}
                onChange={(e) =>
                  onChange({
                    ...content,
                    orderReferences: e.target.checked
                      ? [
                          ...(content.orderReferences || []),
                          {
                            id: o.id,
                            originNumber: o.origin_number,
                            number: o.number,
                            description: o.definition.description,
                            status: o.status,
                            revision: o.revision,
                            recordedAt: new Date().toISOString(),
                          },
                        ]
                      : (content.orderReferences || []).filter(
                          (r) => r.id !== o.id,
                        ),
                  })
                }
              />{" "}
              {o.origin_number} · Orden {o.number} · {o.definition.description}
              <button type="button" className={btn+" ml-2 border-red-300 text-red-800"} disabled={busy} onClick={(e)=>{e.preventDefault();void run(async()=>{
                const reason=await appPrompt("Indica el motivo para retirar esta orden pendiente. Se conservará su historial original.",{title:"Anular orden pendiente"});
                if(!reason?.trim())return;
                if(!await appConfirm("¿Anular esta orden? Dejará de aparecer como pendiente, pero seguirá registrada en el historial."))return;
                await visitRequest({action:"orders-transition",worksiteId:content.worksiteId,orderId:o.id,revision:o.revision,status:"cancelled",note:reason.trim(),evidence:[],replacementId:null,operation:crypto.randomUUID()});
                setPending(current=>current.filter(item=>item.id!==o.id));
                onChange({...content,orderReferences:(content.orderReferences||[]).filter(ref=>ref.id!==o.id)});
              });}}>Anular orden pendiente</button>
            </label>
          ))}
        {more && (
          <button
            type="button"
            disabled={busy}
            className={btn}
            onClick={() =>
              void run(async () => {
                const p = await visitRequest({
                  action: "orders-list",
                  worksiteId: content.worksiteId,
                  offset,
                });
                setPending([...pending, ...p.orders]);
                setMore(p.hasMore);
                setOffset(p.nextOffset);
              })
            }
          >
            Cargar más pendientes
          </button>
        )}
        {!pending.length && <p>Sin órdenes pendientes.</p>}
      </section></>}
    </section>
  );
}
