// Request coalescing is limited to reads. Mutations must always run independently.
export class RequestLimiter {
  private reads = new Map<string, Promise<any>>();
  private generation = 0;
  invalidateReads() { this.generation++; }
  private restrictions = new Map<string, {error:any;until:number}>();
  async run<T>(scope:string,key:string,read:boolean,operation:()=>Promise<T>):Promise<T>{
    const restriction=this.restrictions.get(scope);
    if(restriction&&Date.now()<restriction.until)throw restriction.error;
    if(restriction)this.restrictions.delete(scope);
    const readKey=JSON.stringify([scope,key,this.generation]);
    if(read&&this.reads.has(readKey))return this.reads.get(readKey)!;
    const task=operation().catch(error=>{
      if(error?.status===402)this.restrictions.set(scope,{error,until:Infinity});
      if(error?.status===429)this.restrictions.set(scope,{error,until:Date.now()+60_000});
      throw error;
    }).finally(()=>{if(read)this.reads.delete(readKey);});
    if(read)this.reads.set(readKey,task);
    return task;
  }
}
