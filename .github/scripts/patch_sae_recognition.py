from pathlib import Path

path = Path("components/SaeSection.tsx")
text = path.read_text(encoding="utf-8")

old = '''  const revertWorker=async(candidate:SaeCandidate)=>{if(!candidate.linkedWorkerId)return;if(!window.confirm(`¿Revertir la contratación de ${candidate.normalizedName}? Se eliminará el registro de trabajador creado por SAE y el candidato volverá a su quincena.`))return;try{await deleteDocument('trabajadores',candidate.linkedWorkerId);const nextEstado=candidate.quincena||'Sin asignar';await patchCandidate(candidate,{estado:nextEstado,resultCode:'',linkedWorkerId:null});onToast('Contratación revertida. El candidato vuelve a estar editable.','success');}catch(e:any){onToast(e.message||'No se pudo revertir la contratación.','error');}};'''

new = '''  const revertWorker=async(candidate:SaeCandidate)=>{
    const workerId=candidate.linkedWorkerId;
    if(!workerId){
      onToast('Este candidato no tiene un trabajador SAE vinculado para revertir.','error');
      return;
    }
    if(!window.confirm(`¿Revertir la contratación de ${candidate.normalizedName}? Se eliminará únicamente el registro de trabajador creado por esta contratación SAE y el candidato volverá a su quincena.`))return;

    const nextEstado=candidate.quincena||'Sin asignar';
    const revertedPatch={estado:nextEstado,resultCode:'',linkedWorkerId:null};
    const originalPatch={estado:'Contratado',resultCode:candidate.resultCode||'2001',linkedWorkerId:workerId};

    // Actualizamos primero el candidato de forma estricta. patchCandidate no se usa aquí
    // porque captura sus propios errores y podía mostrar una reversión como correcta aunque
    // Supabase no hubiese guardado el cambio.
    try{
      await updateSaeCandidate(candidate.id,revertedPatch);
    }catch(e:any){
      onToast(e.message||'No se pudo actualizar el candidato SAE. No se ha eliminado ningún trabajador.','error');
      return;
    }

    try{
      await deleteDocument('trabajadores',workerId);
      setCandidates(prev=>prev.map(c=>c.id===candidate.id?{...c,...revertedPatch}:c));
      // Recargamos desde Supabase para que cada reversión parta siempre del estado real y
      // puedan revertirse consecutivamente todos los candidatos que el usuario necesite.
      const fresh=await listSaeCandidates(candidate.needId);
      setCandidates(fresh);
      onToast('Contratación revertida correctamente. El candidato vuelve a estar editable.','success');
    }catch(e:any){
      // Si falla el borrado del trabajador, restauramos el candidato a Contratado para no
      // dejar una contratación a medias ni perder el vínculo.
      try{
        await updateSaeCandidate(candidate.id,originalPatch);
      }catch(rollbackError){
        console.error('No se pudo restaurar el candidato tras fallar la reversión SAE:',rollbackError);
      }
      try{
        const fresh=await listSaeCandidates(candidate.needId);
        setCandidates(fresh);
      }catch{}
      onToast(e.message||'No se pudo eliminar el trabajador vinculado. La contratación se ha mantenido.','error');
    }
  };'''

if old not in text:
    raise SystemExit("Expected revertWorker block not found")

path.write_text(text.replace(old,new,1),encoding="utf-8")
