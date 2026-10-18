import React,{useState} from 'react';
import ModalPortal from './ModalPortal';
import {VisitMinutesReadView} from './VisitMinutesReadView';
import {VisitSignaturePad} from './VisitSignaturePad';
import {personName,type VisitRecord,type VisitPerson,type VisitCommand} from '../src/lib/visitMinutes';
import {visitInput} from './VisitContactsPanel';
export function VisitOnsiteFlow({record,person,busy,error,identityChecked,onIdentityChecked,onClose,onSubmit}:{record:VisitRecord;person:VisitPerson;busy:boolean;error:string;identityChecked:boolean;onIdentityChecked:(checked:boolean)=>void;onClose:()=>void;onSubmit:(command:VisitCommand)=>void}){
  const previous=record.state.responses[person.id],modern=record.state.content.workflow==='3.1';
  const [decision,setDecision]=useState<''|'agree'|'changes'|'reject'>(previous?.decision||''),[comment,setComment]=useState(previous?.comment||'');
  const button='min-h-[44px] rounded-xl border px-4 py-3 font-bold disabled:opacity-50';
  return <ModalPortal layout="fullscreen" label={'Participación presencial de '+personName(person)}><div className="visit-mail-overlay"><section role="dialog" aria-modal="true" aria-label={'Participación presencial de '+personName(person)} className="visit-mail-dialog"><header className="visit-mail-header flex items-center justify-between gap-2"><h3 className="font-black">{personName(person)} · v{record.version}</h3><button className={button} disabled={busy} onClick={onClose}>Cerrar participación</button></header><div className="visit-mail-body">
    {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">{error}</p>}
    <VisitMinutesReadView state={record.state} number={record.number}/>
    <label className="flex min-h-[44px] items-center gap-2"><input type="checkbox" checked={identityChecked} onChange={e=>onIdentityChecked(e.target.checked)}/>Como supervisor, confirmo que esta persona está presente, he comprobado su identidad y le entrego el dispositivo para que actúe personalmente.</label>
    {!previous&&<><fieldset className="space-y-2"><legend className="font-bold">Revisión de esta versión</legend>{([['agree','Conforme con el contenido'],['changes','Con observaciones'],['reject','Disconforme']] as const).map(([value,label])=><label key={value} className="flex min-h-[44px] items-center gap-2"><input type="radio" name="onsite-review" checked={decision===value} onChange={()=>setDecision(value)}/>{label}</label>)}</fieldset><label className="block font-bold">Observaciones o motivos de disconformidad<textarea className={visitInput} value={comment} maxLength={5000} onChange={e=>setComment(e.target.value)}/></label><p className="text-sm">La respuesta se refiere al contenido documental. No acredita el cumplimiento de una orden.</p><button className={button} disabled={busy||!identityChecked||!decision||decision!=='agree'&&!comment.trim()} onClick={()=>{if(decision)onSubmit({type:'respond',personId:person.id,decision,comment,mode:'in-person'});}}>Guardar revisión sin firmar</button></>}
    {identityChecked&&decision&&(decision==='agree'||comment.trim())&&person.signing!=='none'&&(modern||record.status==='signing')&&<VisitSignaturePad key={record.id+':'+record.version+':'+person.id+':'+decision} name={personName(person)} allowAgreement={decision==='agree'} busy={busy} onCancel={onClose} onConfirm={(image,intent='knowledge',note='')=>onSubmit(modern?{type:'onsite-sign',personId:person.id,decision,comment,image,intent,note}:{type:'sign',personId:person.id,image,intent,note,mode:'in-person'})}/>}
  </div></section></div></ModalPortal>;
}
