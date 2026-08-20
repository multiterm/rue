import { contextBridge, ipcRenderer } from 'electron'
import type { RueSettings, McpServerConfig, Provider, ThemeMode } from '../main/store.js'
import type { ScreenshotResult } from '../main/capture/screenshot.js'
import type { SelectionResult } from '../main/capture/selection.js'
import type { WebPageResult } from '../main/capture/web.js'
import type { Conversation, PreferencePair, StoredMessage } from '../main/history.js'
import type { SearchResult } from '../main/agents/search.js'
import type { McpTool, McpResource } from '../main/mcp/client.js'
import type { Notebook, NotebookSearchResult } from '../main/notebook/index.js'
import type { Skill } from '../main/skills/types.js'
import type { ScheduledTask, CreateScheduledTaskInput } from '../main/schedule/types.js'
import type { Memory, MemoryHeader, MemoryType, MemoryWriteInput } from '../main/memory/types.js'

export type {
  RueSettings,
  McpServerConfig,
  Provider,
  ThemeMode,
  ScreenshotResult,
  SelectionResult,
  WebPageResult,
  Conversation,
  PreferencePair,
  StoredMessage,
  SearchResult,
  McpTool,
  McpResource,
  Notebook,
  NotebookSearchResult,
  Skill,
  ScheduledTask,
  CreateScheduledTaskInput,
  Memory,
  MemoryHeader,
  MemoryType,
  MemoryWriteInput
}

export interface RueApi {
  getSettings(): Promise<RueSettings>
  setSettings(partial: Partial<RueSettings>): Promise<RueSettings>
  resetSettings(): Promise<RueSettings>
  captureScreenshot(): Promise<ScreenshotResult>
  captureSelection(): Promise<SelectionResult>
  captureWeb(url: string): Promise<WebPageResult>
  search(query: string): Promise<SearchResult>
  hideWindow(): Promise<void>
  showWindow(): Promise<void>
  setWindowMode(mode: 'bar' | 'chat' | 'settings' | 'welcome'): Promise<void>
  setWindowHeight(height: number, animate?: boolean): Promise<void>
  toggleMaximize(): Promise<boolean>
  history: {
    list(): Promise<ReadonlyArray<Conversation>>
    create(title: string): Promise<Conversation>
    messages(id: number): Promise<ReadonlyArray<StoredMessage>>
    append(id: number, role: 'user' | 'assistant', content: string): Promise<StoredMessage>
    rename(id: number, title: string): Promise<void>
    delete(id: number): Promise<void>
    rate(messageId: number, rating: -1 | 0 | 1): Promise<void>
    exportRl(): Promise<ReadonlyArray<PreferencePair>>
    setScopes(id: number, scopes: ReadonlyArray<string>): Promise<void>
  }
  scope: {
    pickFolder(): Promise<string | null>
    search(paths: ReadonlyArray<string>, query: string): Promise<string>
  }
  tools: {
    list(): Promise<
      ReadonlyArray<{
        readonly type: 'function'
        readonly function: { readonly name: string; readonly description: string; readonly parameters: Record<string, unknown> }
      }>
    >
    call(name: string, args: Record<string, unknown>, scopes: ReadonlyArray<string>): Promise<unknown>
  }
  mcp: {
    reconnect(): Promise<ReadonlyArray<McpTool>>
    listTools(): Promise<ReadonlyArray<McpTool>>
    callTool(serverName: string, name: string, args: Record<string, unknown>): Promise<unknown>
    listResources(): Promise<ReadonlyArray<McpResource>>
    readResource(serverName: string, uri: string): Promise<string>
    listPrompts(): Promise<ReadonlyArray<Skill>>
    getPrompt(serverName: string, name: string, args: string): Promise<string>
  }
  notebook: {
    list(): Promise<ReadonlyArray<Notebook>>
    create(): Promise<Notebook | null>
    reindex(id: number): Promise<number>
    delete(id: number): Promise<void>
    search(id: number, query: string): Promise<NotebookSearchResult>
  }
  skills: {
    list(): Promise<ReadonlyArray<Skill>>
  }
  schedule: {
    create(input: CreateScheduledTaskInput): Promise<ScheduledTask>
    list(): Promise<ReadonlyArray<ScheduledTask>>
    cancel(id: string): Promise<boolean>
  }
  memory: {
    index(): Promise<string>
    scan(): Promise<ReadonlyArray<MemoryHeader>>
    read(name: string): Promise<Memory | null>
    write(input: MemoryWriteInput): Promise<Memory>
    delete(name: string): Promise<boolean>
  }
  media: {
    ensureAccess(kind: 'camera' | 'microphone'): Promise<boolean>
  }
  debug: {
    /** Append one JSON-serialised debug trace line to the on-disk log. */
    log(line: string): Promise<void>
  }
  onAutoSelection(handler: (text: string) => void): () => void
  onScheduleFire(handler: (payload: { id: string; prompt: string }) => void): () => void
  onOpenChat(handler: () => void): () => void
  onOpenSettings(handler: () => void): () => void
}

const api: RueApi = {
  getSettings: () => ipcRenderer.invoke('rue:settings:get'),
  setSettings: partial => ipcRenderer.invoke('rue:settings:set', partial),
  resetSettings: () => ipcRenderer.invoke('rue:settings:reset'),
  captureScreenshot: () => ipcRenderer.invoke('rue:capture:screenshot'),
  captureSelection: () => ipcRenderer.invoke('rue:capture:selection'),
  captureWeb: url => ipcRenderer.invoke('rue:capture:web', url),
  search: query => ipcRenderer.invoke('rue:search', query),
  hideWindow: () => ipcRenderer.invoke('rue:window:hide'),
  showWindow: () => ipcRenderer.invoke('rue:window:show'),
  setWindowMode: mode => ipcRenderer.invoke('rue:window:mode', mode),
  setWindowHeight: (height, animate) => ipcRenderer.invoke('rue:window:height', height, animate),
  toggleMaximize: () => ipcRenderer.invoke('rue:window:toggle-maximize'),
  history: {
    list: () => ipcRenderer.invoke('rue:history:list'),
    create: title => ipcRenderer.invoke('rue:history:create', title),
    messages: id => ipcRenderer.invoke('rue:history:messages', id),
    append: (id, role, content) => ipcRenderer.invoke('rue:history:append', id, role, content),
    rename: (id, title) => ipcRenderer.invoke('rue:history:rename', id, title),
    delete: id => ipcRenderer.invoke('rue:history:delete', id),
    rate: (id, rating) => ipcRenderer.invoke('rue:history:rate', id, rating),
    exportRl: () => ipcRenderer.invoke('rue:history:export-rl'),
    setScopes: (id, scopes) => ipcRenderer.invoke('rue:history:set-scopes', id, scopes)
  },
  scope: {
    pickFolder: () => ipcRenderer.invoke('rue:scope:pick-folder'),
    search: (paths, query) => ipcRenderer.invoke('rue:scope:search', paths, query)
  },
  tools: {
    list: () => ipcRenderer.invoke('rue:tools:list'),
    call: (name, args, scopes) => ipcRenderer.invoke('rue:tools:call', name, args, scopes)
  },
  mcp: {
    reconnect: () => ipcRenderer.invoke('rue:mcp:reconnect'),
    listTools: () => ipcRenderer.invoke('rue:mcp:list-tools'),
    callTool: (serverName, name, args) => ipcRenderer.invoke('rue:mcp:call-tool', serverName, name, args),
    listResources: () => ipcRenderer.invoke('rue:mcp:list-resources'),
    readResource: (serverName, uri) => ipcRenderer.invoke('rue:mcp:read-resource', serverName, uri),
    listPrompts: () => ipcRenderer.invoke('rue:mcp:list-prompts'),
    getPrompt: (serverName, name, args) => ipcRenderer.invoke('rue:mcp:get-prompt', serverName, name, args)
  },
  notebook: {
    list: () => ipcRenderer.invoke('rue:notebook:list'),
    create: () => ipcRenderer.invoke('rue:notebook:create'),
    reindex: id => ipcRenderer.invoke('rue:notebook:reindex', id),
    delete: id => ipcRenderer.invoke('rue:notebook:delete', id),
    search: (id, query) => ipcRenderer.invoke('rue:notebook:search', id, query)
  },
  skills: {
    list: () => ipcRenderer.invoke('rue:skills:list')
  },
  schedule: {
    create: input => ipcRenderer.invoke('rue:schedule:create', input),
    list: () => ipcRenderer.invoke('rue:schedule:list'),
    cancel: id => ipcRenderer.invoke('rue:schedule:cancel', id)
  },
  memory: {
    index: () => ipcRenderer.invoke('rue:memory:index'),
    scan: () => ipcRenderer.invoke('rue:memory:scan'),
    read: name => ipcRenderer.invoke('rue:memory:read', name),
    write: input => ipcRenderer.invoke('rue:memory:write', input),
    delete: name => ipcRenderer.invoke('rue:memory:delete', name)
  },
  media: {
    ensureAccess: kind => ipcRenderer.invoke('rue:media:ensure-access', kind)
  },
  debug: {
    log: line => ipcRenderer.invoke('rue:debug:log', line)
  },
  onAutoSelection: handler => {
    const listener = (_e: Electron.IpcRendererEvent, text: string): void => handler(text)
    ipcRenderer.on('rue:autoselection', listener)
    return () => ipcRenderer.removeListener('rue:autoselection', listener)
  },
  onScheduleFire: handler => {
    const listener = (_e: Electron.IpcRendererEvent, payload: { id: string; prompt: string }): void =>
      handler(payload)
    ipcRenderer.on('rue:schedule:fire', listener)
    return () => ipcRenderer.removeListener('rue:schedule:fire', listener)
  },
  onOpenChat: handler => {
    const listener = (): void => handler()
    ipcRenderer.on('rue:open-chat', listener)
    return () => ipcRenderer.removeListener('rue:open-chat', listener)
  },
  onOpenSettings: handler => {
    const listener = (): void => handler()
    ipcRenderer.on('rue:open-settings', listener)
    return () => ipcRenderer.removeListener('rue:open-settings', listener)
  }
}

contextBridge.exposeInMainWorld('rue', api)

declare global {
  interface Window {
    readonly rue: RueApi
  }
}
