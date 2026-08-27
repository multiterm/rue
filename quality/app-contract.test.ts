import {describe,expect,it} from 'vitest'
import {APP_CONTRACTS,APP_NAMES,createAppPermutations,resolveAppUrl} from './app-contract'

describe('Rue application quality contracts',()=>{
  it('defines exactly one contract per deployed application',()=>{
    expect(APP_CONTRACTS.map(({name})=>name).sort()).toEqual([...APP_NAMES].sort())
    expect(new Set(APP_CONTRACTS.map(({envKey})=>envKey)).size).toBe(APP_NAMES.length)
  })
  it('resolves defaults, stable routes, and deployment overrides',()=>{
    for(const app of APP_CONTRACTS){
      expect(new URL(resolveAppUrl(app)).protocol).toBe('https:')
      expect(resolveAppUrl(app,{})).toBe(new URL(app.path,`${app.defaultUrl}/`).toString())
      expect(resolveAppUrl(app,{[app.stableEnvKey]:'https://stable.example/root/'})).toBe(`https://stable.example${app.path}`)
      expect(resolveAppUrl(app,{[app.hmrEnvKey]:'https://hmr.example/root/'})).toBe(`https://hmr.example${app.path}`)
      expect(resolveAppUrl(app,{[app.envKey]:'https://preview.example/root/',[app.hmrEnvKey]:'https://hmr.example'})).toBe(`https://preview.example${app.path}`)
    }
  })
  it('covers every app, theme, viewport, and locale permutation',()=>{
    const permutations=createAppPermutations()
    expect(permutations).toHaveLength(APP_NAMES.length*2*2*2)
    const keys=permutations.map(({app,colorScheme,viewport,locale})=>`${app.name}:${colorScheme}:${viewport}:${locale}`)
    expect(new Set(keys).size).toBe(keys.length)
    for(const app of APP_CONTRACTS)expect(permutations.filter((entry)=>entry.app.name===app.name)).toHaveLength(8)
  })
})
