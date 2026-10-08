export interface CompletionRun {id:string;status:string;updated_at:number}
/** Observe transitions, never notify from historical snapshots or queue disappearance. */
export class CompletionTracker {
 private states=new Map<string,string>()
 private initialized=false
 observe(runs:CompletionRun[]) {
  const completed=runs.filter(run=>this.initialized&&run.status==='completed'&&['queued','claimed','running'].includes(this.states.get(run.id)??''))
  this.states=new Map(runs.map(run=>[run.id,run.status]))
  this.initialized=true
  return completed
 }
}
