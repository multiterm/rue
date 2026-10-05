/** Capture a rendered frame rather than treating video.play() as frame readiness. */
export async function screenFrame(stream:MediaStream):Promise<Blob>{
 const video=document.createElement('video');video.muted=true;video.playsInline=true;video.srcObject=stream
 let frame:number|undefined,timer:ReturnType<typeof setTimeout>|undefined,ended:(()=>void)|undefined
 try{
  await new Promise<void>((resolve,reject)=>{
   const finish=(error?:Error)=>{clearTimeout(timer);if(frame!==undefined)video.cancelVideoFrameCallback?.(frame);video.removeEventListener('loadeddata',ready);video.removeEventListener('error',failed);if(ended)stream.getTracks().forEach(track=>track.removeEventListener('ended',ended!));error?reject(error):resolve()}
   const failed=()=>finish(Error('The shared screen could not be read. Choose a saved screenshot instead.'))
   const ready=()=>{if(video.videoWidth>0&&video.videoHeight>0&&video.readyState>=2)finish()}
   ended=()=>finish(Error('Screen sharing ended before a frame arrived. Choose a saved screenshot instead.'))
   stream.getVideoTracks().forEach(track=>track.addEventListener('ended',ended!,{once:true}))
   video.addEventListener('error',failed,{once:true})
   timer=setTimeout(()=>finish(Error('No screen frame received. Choose a saved screenshot instead.')),10000)
   if(video.requestVideoFrameCallback)frame=video.requestVideoFrameCallback(()=>ready())
   else video.addEventListener('loadeddata',ready)
   void video.play().then(()=>{if(!video.requestVideoFrameCallback)ready()},failed)
  })
  const canvas=document.createElement('canvas'),scale=Math.min(1,4096/Math.max(video.videoWidth,video.videoHeight))
  canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale)
  if(!canvas.width||!canvas.height)throw Error('Screen capture was empty. Choose a saved screenshot instead.')
  const context=canvas.getContext('2d');if(!context)throw Error('Image capture is unavailable in this browser.')
  context.drawImage(video,0,0,canvas.width,canvas.height)
  return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Could not encode the screenshot.')),'image/png'))
 }finally{clearTimeout(timer);video.pause();video.srcObject=null}
}
