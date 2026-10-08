type Release={image:string;piVersion:string;createdAt:number}
const version=(value:string|undefined|null)=>value&&/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(value)?value.split('.').map(Number):undefined
export function comparePiVersions(a:string,b:string):number|undefined{const left=version(a),right=version(b);if(!left||!right)return;for(let i=0;i<3;i++){const delta=left[i]!-right[i]!;if(delta)return Math.sign(delta)}return 0}
export function upgradeCandidate(releases:Release[]|undefined,image:string|undefined,reportedVersion:string|null|undefined){
 if(!image||!releases)return
 const current=releases.find(r=>r.image===image),installed=reportedVersion??current?.piVersion
 if(!installed||!version(installed))return
 return releases.filter(r=>r.image!==image&&/^sha256:[a-f0-9]{64}$/.test(r.image)&&((comparePiVersions(r.piVersion,installed)??-1)>0||(comparePiVersions(r.piVersion,installed)===0&&current&&r.createdAt>current.createdAt)))
 .sort((a,b)=>(comparePiVersions(b.piVersion,a.piVersion)??0)||b.createdAt-a.createdAt||a.image.localeCompare(b.image))[0]
}
