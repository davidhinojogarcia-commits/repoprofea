// Lightweight revision checks avoid repeatedly transferring signatures and snapshots.
export type DashboardRows = Record<string, any>[];
type Query = (table: string, options: {query: string; fresh?: boolean}) => Promise<any>;
const sources = [
  {
    table:'foreman_documents',
    order:'updated_at.desc',
    limit:500,
    revision:'updated_at',
    select:'id,obra,work_date,document_type,worker_id,worker_snapshot,answers,signatures,completed_by,status,completed_at,updated_at,correction_pending,correction_reason',
  },
  {
    table:'foreman_attendance_days',
    order:'work_date.desc',
    limit:180,
    revision:'updated_at',
    select:'id,obra,work_date,foreman_name,rows,status,completed_at,updated_at,correction_pending,correction_reason',
  },
  {
    table:'foreman_mandatory_documents',
    order:'work_date.desc',
    limit:300,
    revision:'updated_at',
    select:'id,obra,period_key,work_date,document_type,category,workers,signatures,status,completed_at,updated_at,source_gmail_message_id,source_gmail_thread_id,source_rfc_message_id,source_email_from,source_email_subject,source_attachment_name,returned_gmail_message_id,returned_at,details,correction_pending,correction_reason,lifecycle_status,assigned_at',
  },
];
const fingerprint = (rows: DashboardRows, revision: string) => JSON.stringify(
  rows.map(row=>[String(row.id),String(row[revision]||'')]).sort((a,b)=>a[0].localeCompare(b[0])),
);

export class ForemanDashboardLoader {
  private cache: DashboardRows[] | null = null;
  private inFlight: Promise<DashboardRows[]> | null = null;
  private blocked: unknown = null;
  private followUp: Promise<DashboardRows[]> | null = null;
  constructor(private query: Query, private ownerId: string) {}

  async load(checkOnly = false): Promise<DashboardRows[]> {
    if(this.blocked)throw this.blocked;
    if(this.inFlight){
      const existing=this.inFlight;
      if(checkOnly)return existing;
      // A save may complete while a background read is underway: refresh after it.
      // Several callers waiting for the same read need one fresh follow-up,
      // rather than one complete reload per click. A later mutation can queue
      // another follow-up once this next read has actually started.
      if (this.followUp) return this.followUp;
      const queued = existing.catch(()=>undefined).then(() => {
        if (this.followUp === queued) this.followUp = null;
        return this.load(false);
      });
      this.followUp = queued;
      return queued;
    }
    const task=this.read(checkOnly).catch(error=>{
      if([401,402,403].includes(Number(error?.status)))this.blocked=error;
      throw error;
    }).finally(()=>{this.inFlight=null;});
    this.inFlight=task;
    return task;
  }

  private async read(checkOnly: boolean): Promise<DashboardRows[]> {
    const previous=this.cache;
    const results=await Promise.all(sources.map(async(source,index)=>{
      const suffix=`&owner_id=eq.${encodeURIComponent(this.ownerId)}&order=${source.order},id.desc&limit=${source.limit}`;
      if(checkOnly&&previous){
        const revisions=await this.query(source.table,{query:`select=id,${source.revision}${suffix}`});
        if(!Array.isArray(revisions))throw new Error('Respuesta de actualización no válida.');
        if(fingerprint(revisions,source.revision)===fingerprint(previous[index],source.revision))return previous[index];
        const existing=new Map(previous[index].map(row=>[String(row.id),row]));
        const changed=revisions.filter(row=>String(row[source.revision]||'')!==String(existing.get(String(row.id))?.[source.revision]||'')||!existing.has(String(row.id)));
        // Download only changed rows, not every document and signature in the collection.
        for(let offset=0;offset<changed.length;offset+=100){
          const ids=changed.slice(offset,offset+100).map(row=>JSON.stringify(String(row.id))).join(',');
          const rows=await this.query(source.table,{query:`select=${source.select}&id=in.${encodeURIComponent(`(${ids})`)}${suffix}`});
          if(!Array.isArray(rows))throw new Error('Respuesta de documentación no válida.');
          const returned=new Set(rows.map(row=>String(row.id)));
          for(const row of changed.slice(offset,offset+100))if(!returned.has(String(row.id)))existing.delete(String(row.id));
          for(const row of rows)existing.set(String(row.id),row);
        }
        // Revision ordering preserves the visible list; omitted IDs represent deletions.
        return revisions.map(row=>existing.get(String(row.id))).filter((row):row is Record<string,any>=>!!row);
      }
      const rows=await this.query(source.table,{query:`select=${source.select}${suffix}`,fresh:!checkOnly});
      if(!Array.isArray(rows))throw new Error('Respuesta de documentación no válida.');
      return rows;
    }));
    this.cache=results;
    return results;
  }
}


