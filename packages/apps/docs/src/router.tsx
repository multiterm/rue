import {createRootRoute,createRoute,createRouter} from '@tanstack/react-router'
import {DocsLayout} from './components/DocsLayout'
import {MarkdownPage} from './components/MarkdownPage'
import introduction from './content/introduction.md?raw'
import authentication from './content/authentication.md?raw'
import designSystem from './content/design-system.md?raw'
import deployment from './content/deployment.md?raw'
import settings from './content/settings.md?raw'
import {app} from './app'
export const pages={'/':introduction,'/authentication':authentication,'/design-system':designSystem,'/deployment':deployment,'/settings':settings} as const
export const checkHealth=async()=>{const response=await fetch(`${app.urls.api}/health`);if(!response.ok)throw new Error(`Rue health failed (${response.status})`);return response.json()}
const root=createRootRoute({component:DocsLayout})
const introductionRoute=createRoute({getParentRoute:()=>root,path:'/',component:()=> <MarkdownPage source={introduction}/>})
const authenticationRoute=createRoute({getParentRoute:()=>root,path:'/authentication',component:()=> <MarkdownPage source={authentication}/>})
const designSystemRoute=createRoute({getParentRoute:()=>root,path:'/design-system',component:()=> <MarkdownPage source={designSystem}/>})
const deploymentRoute=createRoute({getParentRoute:()=>root,path:'/deployment',component:()=> <MarkdownPage source={deployment}/>})
const settingsRoute=createRoute({getParentRoute:()=>root,path:'/settings',component:()=> <MarkdownPage source={settings}/>})
export const router=createRouter({routeTree:root.addChildren([introductionRoute,authenticationRoute,designSystemRoute,deploymentRoute,settingsRoute]),defaultPreload:'intent',scrollRestoration:true})
declare module '@tanstack/react-router'{interface Register{router:typeof router}}
