export {workspaceRoot,validFilesystemPolicy} from '../../../../libs/sdk/src/filesystem.js'
export type {DirectoryGrant,FilesystemPolicy} from '../../../../libs/sdk/src/filesystem.js'
import {validFilesystemPolicy} from '../../../../libs/sdk/src/filesystem.js'
/** Arguments for the unused Landlock compatibility prototype only. */
export function sandboxArguments(policy:unknown,runner:string){
 if(!validFilesystemPolicy(policy)||runner!=='/app/runner.js')throw Error('agent_filesystem_policy_invalid')
 return [...policy.directories.flatMap(g=>[g.access==='write'?'--write':'--read',g.path]),'--','/usr/local/bin/node',runner]
}
