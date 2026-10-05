import {useLayoutEffect,useRef} from 'react'
import {useQuery} from '@tanstack/react-query'
import type {RueSession} from '@multiterm/rue-sdk'
import {rue} from './client'

/** List snapshots are discovery, not authority to switch the user's active bot. */
export function useSelectedSession(id:string|undefined,owner:string|undefined,sessions:RueSession[]|undefined){
 const previous=useRef<RueSession|undefined>(undefined)
 const listed=sessions?.find(session=>session.id===id&&session.ownerSubject===owner)
 const detail=useQuery({queryKey:['selected-session',owner,id],queryFn:({signal})=>rue.session(id!,signal),enabled:Boolean(owner&&id&&!listed),retry:false,staleTime:10000})
 const confirmed=detail.data&&detail.data.id===id&&detail.data.ownerSubject===owner?detail.data:undefined
 const cached=previous.current&&previous.current.id===id&&previous.current.ownerSubject===owner?previous.current:undefined
 const selected=listed??confirmed??cached
 useLayoutEffect(()=>{previous.current=selected},[selected])
 return selected
}
