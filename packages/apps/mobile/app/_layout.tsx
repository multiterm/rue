import { Stack } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
WebBrowser.maybeCompleteAuthSession()
export default function Layout(){return <Stack screenOptions={{headerStyle:{backgroundColor:'#0d1913'},headerTintColor:'#edf3ee'}}/>}
