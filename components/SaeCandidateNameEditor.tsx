import React, { useState, useRef } from 'react';
export default function SaeCandidateNameEditor({ candidate, disabled, onSave }: {
  key?: string; candidate: { id: string; apellidos: string; nombre: string }; disabled: boolean;
  onSave: (patch: { apellidos: string; nombre: string; normalizedName: string }) => Promise<void>;
}) {
  const [open,setOpen]=useState(false), [surname,setSurname]=useState(''), [name,setName]=useState('');
  const [busy,setBusy]=useState(false), [error,setError]=useState('');
  const flight=useRef(false);
  const save=async()=>{
    if(flight.current || disabled) return;
    const apellidos=surname.trim(), nombre=name.trim();
    if(!apellidos || !nombre) { setError('Completa los apellidos y el nombre.'); return; }
    flight.current=true;setBusy(true);setError('');
    try { await onSave({apellidos,nombre,normalizedName:`${apellidos} ${nombre}`});setOpen(false); }
    catch(e) {setError(e instanceof Error?e.message:'No se pudo guardar. Conservamos tu corrección.');}
    finally {flight.current=false;setBusy(false);}
  };
  return <div className="min-w-0">
    {!open ? <button type="button" disabled={disabled} className="min-h-[44px] px-2 text-xs font-bold underline disabled:opacity-50" onClick={()=>{setSurname(candidate.apellidos);setName(candidate.nombre);setError('');setOpen(true);}}>Corregir nombre</button>
    : <fieldset disabled={busy || disabled} className="rounded-xl border p-3 space-y-2">
      <legend className="text-xs font-bold">Corregir nombre</legend>
      <div className="grid sm:grid-cols-2 gap-2">
        <label className="text-xs">Apellidos<input className="ui-input w-full" value={surname} onChange={e=>setSurname(e.target.value)}/></label>
        <label className="text-xs">Nombre<input className="ui-input w-full" value={name} onChange={e=>setName(e.target.value)}/></label>
      </div>
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      <div className="flex flex-wrap gap-2"><button type="button" className="min-h-[44px] rounded-lg bg-[#00548E] px-3 py-2 font-bold text-white" onClick={()=>void save()}>Guardar nombre</button><button type="button" className="min-h-[44px] rounded-lg border px-3 py-2 font-bold" onClick={()=>setOpen(false)}>Cancelar</button></div>
    </fieldset>}
  </div>;
}
