import { useEffect } from 'react'
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native'
import Constants from 'expo-constants'
import * as AuthSession from 'expo-auth-session'
import * as SecureStore from 'expo-secure-store'
import { rueNativeThemes } from '@multiterm/rue-gds'

const apiUrl = String(Constants.expoConfig?.extra?.keynameApiUrl ?? 'https://api.keyname.dev')
const clientId = String(Constants.expoConfig?.extra?.keynameClientId ?? '')
const redirectUri = AuthSession.makeRedirectUri({ scheme: 'rue', path: 'auth/callback' })
const discovery = { authorizationEndpoint: `${apiUrl}/authorize`, tokenEndpoint: `${apiUrl}/v1/code/exchange` }

export default function Home(){
  const [request,response,promptAsync] = AuthSession.useAuthRequest({clientId,redirectUri,scopes:['openid','profile','email'],usePKCE:true},discovery)
  useEffect(()=>{if(response?.type !== 'success' || !request?.codeVerifier)return; AuthSession.exchangeCodeAsync({clientId,code:response.params.code,redirectUri,extraParams:{code_verifier:request.codeVerifier}},discovery).then(token=>SecureStore.setItemAsync('rue.keyname.tokens',JSON.stringify(token)))},[request,response])
  return <SafeAreaView style={styles.root}><View><Text style={styles.mark}>RUE</Text><Text style={styles.title}>Your workspace, in motion.</Text><Text style={styles.copy}>Continue sessions from web, desktop, or terminal.</Text></View><Pressable disabled={!request || !clientId} style={styles.button} onPress={()=>promptAsync()}><Text style={styles.buttonText}>Continue with Keyname</Text></Pressable></SafeAreaView>
}
const colors=rueNativeThemes.dark
const styles=StyleSheet.create({root:{flex:1,justifyContent:'space-between',padding:32,backgroundColor:colors.background},mark:{color:colors.primary,fontWeight:'800',letterSpacing:5,marginTop:40},title:{color:colors.text,fontSize:56,fontWeight:'800',lineHeight:58,marginTop:80},copy:{color:colors.muted,fontSize:18,lineHeight:27,marginTop:20},button:{backgroundColor:colors.primary,padding:18,borderRadius:14,alignItems:'center',marginBottom:24},buttonText:{color:colors.background,fontWeight:'800',fontSize:16}})
