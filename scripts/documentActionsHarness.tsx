import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Download, Pencil, Trash2, CheckCircle2, RotateCcw } from 'lucide-react';
import { InstitutionalDocumentActions } from '../components/InstitutionalDocumentActions';

function Demo() {
  const [events, setEvents] = useState<string[]>([]);
  const record = (key:string) => setEvents(old => [...old, key]);
  return <main>
    <section id="document-card">
      <InstitutionalDocumentActions
        primary={<>
          <button onClick={() => record('review')} className="bg-emerald-600 text-white"><CheckCircle2/>Marcar revisado</button>
          <button onClick={() => record('send')} className="bg-[#00548E] text-white">Enviar firmado a administrativa</button>
        </>}
        secondary={<>
          <button onClick={() => record('pdf')} className="border border-slate-300 bg-white text-slate-900"><Download/>PDF</button>
          <button onClick={() => record('edit')} className="border border-blue-200 bg-blue-50 text-blue-800"><Pencil/>Editar</button>
          <button onClick={() => record('return')} className="border border-amber-300 bg-amber-50 text-amber-900"><RotateCcw/>Devolver para corregir</button>
          <button onClick={() => record('delete')} className="border border-rose-300 bg-rose-50 text-rose-700"><Trash2/>Eliminar</button>
          <button disabled onClick={() => record('disabled')} className="border">No autorizado</button>
        </>}
      />
    </section>
    <output id="events">{events.join(',')}</output>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Demo/>);
