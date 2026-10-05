/** Link actions are derived only from reported GitHub PR URLs, never fabricated
 * from a branch name. They do not claim the PR was verified, merged or approved. */
export function pullRequestLinks(text:string){
 const links=new Set<string>()
 for(const match of text.slice(0,1_000_000).matchAll(/https:\/\/[^\s<>"'`]+/gi)){
  if(match[0].length>2048)continue
  try{const url=new URL(match[0].replace(/[)\].,;:!?]+$/g,'')),path=/^\/([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})\/pull\/([1-9][0-9]{0,15})(?:\/(?:files|commits|checks))?\/?$/.exec(url.pathname)
   if(url.hostname==='github.com'&&!url.port&&!url.username&&!url.password&&path)links.add(`https://github.com/${path[1]}/${path[2]}/pull/${path[3]}`)
  }catch{/* Ignore malformed or untrusted reported links. */}
  if(links.size===3)break
 }
 return [...links]
}
export function PullRequestActions({text}:{text:string}){const links=pullRequestLinks(text);if(!links.length)return null;return <div className="pull-request-actions">{links.map(url=><div key={url}><a href={url} target="_blank" rel="noopener noreferrer">View PR #{url.split('/').at(-1)} ↗</a><a href={url+'/files'} target="_blank" rel="noopener noreferrer">View code ↗</a></div>)}</div>}
