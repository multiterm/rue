/** Keep provider wording. Only extract error.message from JSON envelopes, redact secrets,
 * remove terminal controls, and bound size before persistence/transmission. */
export function modelErrorMessage(value:unknown):string|undefined {
 if(typeof value!=='string'||!value.trim())return undefined
 if(value.length>65536&&/^[\s]*[\[{]/.test(value))return '[Provider error envelope too large to display safely]'
 let text=value
 if(value.length<=65536){try{const parsed=JSON.parse(value);const message=parsed?.error?.message??parsed?.message??(typeof parsed?.error==='string'?parsed.error:undefined);if(typeof message==='string')text=message;else if(parsed&&typeof parsed==='object')return undefined}catch{/* ordinary provider text */}}
 text=text.slice(0,65536)
  .replace(/-----BEGIN [^-\n]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-\n]*PRIVATE KEY-----|$)/g,'[redacted private key]')
  .replace(/\b(?:Bearer|Basic)\s+[^\s"',;]+/gi,'[redacted authorization]')
  .replace(/\b(?:sk-[A-Za-z0-9_-]+|tnk_[A-Za-z0-9_-]+|rue_worker_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*)?)/g,'[redacted]')
  .replace(/(["']?(?:authorization|proxy-authorization|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|client[-_]?secret|password|secret|token|signature|cookie|set-cookie)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;&]+)/gi,'$1[redacted]')
  .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi,'$1[redacted]@')
  .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'')
 if(text.length>16384||value.length>65536)text=text.slice(0,16384)+'\n[Provider error truncated]'
 return text.trim()||undefined
}
// No Rue prose is appended: the webapp renders its retry/tool warning separately.
export const modelErrorNotice=modelErrorMessage
