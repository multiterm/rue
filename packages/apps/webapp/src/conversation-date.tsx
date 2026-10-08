import './bot-experience.css'
export function dayKey(time:number){const d=new Date(time);return Number.isFinite(d.getTime())?`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`:undefined}
export function ConversationDate({time,previous}:{time:number;previous?:number}){
 const key=dayKey(time);if(!key||(previous!==undefined&&dayKey(previous)===key))return null
 const date=new Date(time),today=new Date(),yesterday=new Date(today.getFullYear(),today.getMonth(),today.getDate()-1)
 const label=key===dayKey(today.getTime())?'Today':key===dayKey(yesterday.getTime())?'Yesterday':date.toLocaleDateString(undefined,{month:'long',day:'numeric',year:'numeric'})
 return <div className="conversation-date"><time dateTime={date.toISOString()}>{label}</time></div>
}
