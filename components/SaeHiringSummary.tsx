import React, { useEffect, useMemo, useRef } from 'react';
import type { SaeCandidate, SaeNeed, SaeReport } from '../src/services/saeService';
import { buildSaeHiringSummary } from '../src/lib/saeHiringSummary';

export default function SaeHiringSummary({ need, reports, candidates, selectedReportId }: {
  need: SaeNeed; reports: SaeReport[]; candidates: SaeCandidate[]; selectedReportId: string;
}) {
  const rows = useMemo(() => buildSaeHiringSummary(need, reports, candidates, selectedReportId), [need, reports, candidates, selectedReportId]);
  const report = reports.find(r => r.id === selectedReportId);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const header = document.querySelector<HTMLElement>('div.app-navigation-panel');
    if (!header) return;
    const measure = () => {
      const style = getComputedStyle(header);
      const offset = ['sticky', 'fixed'].includes(style.position) ? header.getBoundingClientRect().height + Math.max(0, parseFloat(style.top) || 0) : 0;
      panel.current?.style.setProperty('--sae-summary-top', `${offset}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    window.addEventListener('resize', measure);
    measure();
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  return <section ref={panel} className="sae-hiring-summary ui-surface" aria-label="Control de contratación por periodo">
    <div className="sae-hiring-heading">
      <h2>Control de contratación · {need.codigoObra || need.obra}</h2>
      <span>{need.mes} {need.ano || ''} · Todos los informes de esta obra</span>
    </div>
    <div className="sae-hiring-rows" role="list" aria-label="Cobertura de los periodos">
      {rows.map(row => <div role="listitem" key={row.id} data-period={row.period} className={`sae-hiring-row ${row.excess ? 'sae-hiring-excess' : row.remaining === 0 ? 'sae-hiring-complete' : ''}`}>
        <div className="sae-hiring-label"><strong>{row.period}</strong><span>{row.category}</span>
          {row.reportRelevant && <span className="sae-report-contribution">Este informe: {row.reportHiring} contratados</span>}
        </div>
        <div className="sae-hiring-number"><strong>{row.planned ?? '—'}</strong><span>Previstos</span></div>
        <div className="sae-hiring-number"><strong>{row.hiring}</strong><span>Contratados*</span></div>
        <div className="sae-hiring-number sae-hiring-balance"><strong>{row.excess ? `+${row.excess}` : row.remaining ?? '—'}</strong><span>{row.excess ? 'De más' : row.remaining === 0 ? 'Completo' : 'Faltan'}</span></div>
      </div>)}
      {!rows.length && <p>Sin planificación. Añada las necesidades de contratación de esta obra.</p>}
    </div>
    <details className="sae-hiring-details" key={`${need.id}:${selectedReportId}`}>
      <summary>Detalle del informe y del recuento</summary>
      <p>* Contratados: código 2001 («Contratará al candidato») o contratación registrada sin código. Seleccionar una quincena no cuenta como contratación. Cada persona cuenta una vez en cada categoría y periodo.</p>
      {report && <p><strong>Informe seleccionado:</strong> {report.fileName}. El objetivo se comparte entre los informes del mismo periodo y categoría.</p>}
      {rows.map(row => <p key={row.id}><strong>{row.period} · {row.category}:</strong> {row.candidates} candidatos; {row.registered} contratados con registro; {row.hiring - row.registered} pendientes de registrar.
        {row.reportRelevant && <> Este informe aporta {row.reportHiring} contratados de {row.reportCandidates} candidatos.</>}
        {row.planned === null && <> Revise la categoría o la cantidad prevista en la solicitud.</>}
        {row.period === 'Periodo por confirmar' && <> Confirme la quincena para calcular su cobertura.</>}
      </p>)}
    </details>
  </section>;
}
