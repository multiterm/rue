import {createRueClient,type RueDeviceInput,type RueDevicePlatform} from '@multiterm/rue-sdk'
import {createRueTrpcClient} from '@multiterm/rue-trpc/client'
import {app} from './app'
import {keynameAccessToken} from './auth'
const DEVICE_KEY='rue.device.id'
export const rue=createRueClient({baseUrl:app.urls.api,token:async()=>await keynameAccessToken()??undefined})
export const trpc=createRueTrpcClient({baseUrl:app.urls.api,token:async()=>await keynameAccessToken()??undefined})
export function currentDevice():RueDeviceInput{let deviceId=localStorage.getItem(DEVICE_KEY);if(!deviceId){deviceId=`dev_${crypto.randomUUID()}`;localStorage.setItem(DEVICE_KEY,deviceId)}const desktop=/Electron/i.test(navigator.userAgent);return {deviceId,name:desktop?'Rue Desktop':`Web · ${navigator.platform||'Browser'}`,platform:(desktop?'desktop':'web') as RueDevicePlatform}}
