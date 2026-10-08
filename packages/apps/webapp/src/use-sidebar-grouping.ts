import {useEffect,useRef,useState} from 'react'
import {useMutation,useQueryClient} from '@tanstack/react-query'
import type {RuePreference} from '@multiterm/rue-sdk'
import {rue,currentDevice} from './client'
export const sidebarGroupingKey='sidebar.group-agents'
export function useSidebarGrouping(owner:string|undefined,preferences:RuePreference[]|undefined){
 const cache=useQueryClient(),sequence=useRef(0),active=useRef(true)
 const [override,setOverride]=useState<{owner:string;value:boolean}|undefined>()
 useEffect(()=>{active.current=true;return()=>{active.current=false}},[])
 const save=useMutation({
  scope:{id:`sidebar-grouping:${owner}`},
  mutationFn:async(input:{owner:string;value:boolean;sequence:number})=>{
   if(!active.current||input.owner!==owner)throw Error('Account changed')
   return rue.setPreference(sidebarGroupingKey,{value:input.value,deviceId:currentDevice().deviceId})
  },
  onSuccess:async(saved,input)=>{
   await cache.cancelQueries({queryKey:['preferences']})
   if(!active.current||input.owner!==owner||input.sequence!==sequence.current)return
   cache.setQueryData<RuePreference[]>(['preferences'],current=>[...(current??[]).filter(item=>item.key!==sidebarGroupingKey),saved])
   setOverride(undefined)
   // A toggle may complete before the initial preference list; reload other keys too.
   void cache.invalidateQueries({queryKey:['preferences']})
  },
  onError:(_error,input)=>{
   if(!active.current||input.owner!==owner||input.sequence!==sequence.current)return
   setOverride(undefined);void cache.invalidateQueries({queryKey:['preferences']})
  },
 })
 const grouped=override&&override.owner===owner?override.value:preferences?.find(item=>item.key===sidebarGroupingKey)?.value===true
 return {grouped,error:save.isError?'Could not save agent grouping. Please try again.':'',change(value:boolean){
  if(!owner||value===grouped)return
  setOverride({owner,value});save.mutate({owner,value,sequence:++sequence.current})
 }}
}
