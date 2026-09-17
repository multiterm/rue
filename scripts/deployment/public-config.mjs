// Only public origins may cross the server/browser boundary. Never serialize env wholesale.
export function publicConfig(env) {
  const result={}
  for(const service of ['API','WEBAPP','SITE','DOCS'])for(const prefix of ['SANDBLOCKS_SERVICE_','SANDBLOCKS_STABLE_SERVICE_']) {
    const key=prefix+service+'_URL',value=env[key]
    if(!value)continue
    const url=new URL(value)
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Invalid public service URL')
    result[key]=url.href.replace(/\/$/,'')
  }
  if(['development','dev','preview','production','prod','local','test'].includes(env.SANDBLOCKS_RUNTIME))result.SANDBLOCKS_RUNTIME=env.SANDBLOCKS_RUNTIME
  return result
}
export function publicConfigScript(env) {
  return 'window.__RUE_PUBLIC_CONFIG__='+JSON.stringify(publicConfig(env)).replaceAll('<','\\u003c').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029')+';\n'
}
