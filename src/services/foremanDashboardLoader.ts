// Lightweight revision checks avoid repeatedly transferring signatures and snapshots.
export const FOREMAN_REFRESH_INTERVAL_MS = 60_000;
export type DashboardRows = Record<string, any>[];
type Query = (table: string, options: {query: string}) => Promise<any>;
const sources = [
  {table:'foreman_documents',order:'updated_at.desc',limit:500,revision:'updated_at',select:'*'},
  {table:'foreman_attendance_days',order:'work_date.desc',limit:180,revision:'updated_at',select:'*'},
  {table:'foreman_mandatory_documents',order:'work_date.desc',limit:300,revision:'updated_at',select:'*'},
  {table:'foreman_activity_log',order:'created_at.desc',limit:500,revision:'created_at',select:'*'},
  // Only these snapshot fields are displayed. Never transfer the complete signed snapshot.
  {table:'foreman_document_versions',order:'created_at.desc',limit:300,revision:'created_at',select:'id,obra,entity_type,entity_id,version_no,created_at,document_type:snapshot->>document_type,work_date:snapshot->>work_date,legacy_work_date:snapshot->>workDate'},
];
const fingerprint = (rows: DashboardRows, revision: string) => JSON.stringify(
  rows.map(row=>[String(row.id),String(row[revision]||'')]).sort((a,b)=>a[0].localeCompare(b[0])),
);

export class ForemanDashboardLoader {
  private cache: DashboardRows[] | null = null;
  private inFlight: Promise<DashboardRows[]> | null = null;
  private blocked: unknown = null;
  constructor(private query: Query, private ownerId: string) {}

  async load(checkOnly = false): Promise<DashboardRows[]> {
    if(this.blocked)throw this.blocked;
    if(this.inFlight){
      const existing=this.inFlight;
      if(checkOnly)return existing;
      // A save may complete while a background read is underway: refresh after it.
      await existing.catch(()=>undefined);
      return this.load(false);
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
      }
      const rows=await this.query(source.table,{query:`select=${source.select}${suffix}`});
      if(!Array.isArray(rows))throw new Error('Respuesta de documentación no válida.');
      return rows;
    }));
    this.cache=results;
    return results;
  }
}
