import { Stack } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
WebBrowser.maybeCompleteAuthSession()
export default function Layout(){return <Stack screenOptions={{headerShown:false}}/>}
