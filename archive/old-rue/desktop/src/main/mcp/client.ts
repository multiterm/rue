import { ipcMain } from 'electron'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { getSettings, type McpServerConfig } from '../store.js'
import type { Skill } from '../skills/types.js'

export interface McpTool {
  readonly serverName: string
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
}

export interface McpResource {
  readonly serverName: string
  readonly uri: string
  readonly name: string
  readonly description?: string
  readonly mimeType?: string
}

interface McpPromptDef {
  readonly name: string
  readonly description: string
  readonly argNames: ReadonlyArray<string>
}

interface ConnectedServer {
  readonly config: McpServerConfig
  readonly client: Client
  readonly tools: ReadonlyArray<McpTool>
  readonly resources: ReadonlyArray<McpResource>
  readonly prompts: ReadonlyArray<McpPromptDef>
}

const connected = new Map<string, ConnectedServer>()

// #region -- Connection ---------------------------------

async function connectServer(config: McpServerConfig): Promise<ConnectedServer> {
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args ? [...config.args] : [],
    env: config.env ? { ...config.env } : undefined
  })

  const client = new Client({ name: 'rue', version: '0.0.0' }, { capabilities: {} })
  await client.connect(transport)

  // Only fetch resources / prompts from servers that advertise them — calling
  // the methods on a server that doesn't support them just errors.
  const caps = client.getServerCapabilities()
  return {
    config,
    client,
    tools: await fetchTools(client, config.name),
    resources: caps?.resources ? await fetchResources(client, config.name) : [],
    prompts: caps?.prompts ? await fetchPrompts(client) : []
  }
}

async function fetchTools(client: Client, serverName: string): Promise<McpTool[]> {
  try {
    const { tools } = await client.listTools()
    return tools.map(tool => ({
      serverName,
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: tool.inputSchema as Record<string, unknown>
    }))
  } catch {
    return []
  }
}

async function fetchResources(client: Client, serverName: string): Promise<McpResource[]> {
  try {
    const { resources } = await client.listResources()
    return resources.map(resource => ({
      serverName,
      uri: resource.uri,
      name: resource.name ?? resource.uri,
      description: resource.description,
      mimeType: resource.mimeType
    }))
  } catch {
    return []
  }
}

async function fetchPrompts(client: Client): Promise<McpPromptDef[]> {
  try {
    const { prompts } = await client.listPrompts()
    return prompts.map(prompt => ({
      name: prompt.name,
      description: prompt.description ?? prompt.name,
      argNames: (prompt.arguments ?? []).map(arg => arg.name)
    }))
  } catch {
    return []
  }
}

export async function reconnectAll(): Promise<ReadonlyArray<McpTool>> {
  await disconnectAll()
  const { mcpServers } = getSettings()
  const allTools: McpTool[] = []
  for (const config of mcpServers) {
    try {
      const conn = await connectServer(config)
      connected.set(config.name, conn)
      allTools.push(...conn.tools)
    } catch (err) {
      console.error(`Failed to connect MCP server '${config.name}':`, (err as Error).message)
    }
  }
  return allTools
}

export async function disconnectAll(): Promise<void> {
  for (const conn of connected.values()) {
    try {
      await conn.client.close()
    } catch {
      // Best effort.
    }
  }
  connected.clear()
}

// #endregion -- Connection ------------------------------

// #region -- Tools --------------------------------------

export function listTools(): ReadonlyArray<McpTool> {
  const all: McpTool[] = []
  for (const conn of connected.values()) all.push(...conn.tools)
  return all
}

export async function callTool(
  serverName: string,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const conn = requireServer(serverName)
  const result = await conn.client.callTool({ name, arguments: args })
  return result.content
}

// #endregion -- Tools -----------------------------------

// #region -- Resources ----------------------------------

export function listResources(): ReadonlyArray<McpResource> {
  const all: McpResource[] = []
  for (const conn of connected.values()) all.push(...conn.resources)
  return all
}

export async function readResource(serverName: string, uri: string): Promise<string> {
  const conn = requireServer(serverName)
  const result = await conn.client.readResource({ uri })
  return result.contents
    .map(part => {
      const block = part as Record<string, unknown>
      if (typeof block.text === 'string') return block.text
      return `[binary ${typeof block.mimeType === 'string' ? block.mimeType : 'data'} at ${String(block.uri)}]`
    })
    .join('\n\n')
}

// #endregion -- Resources -------------------------------

// #region -- Prompts (as skills) ------------------------

/** Connected servers' prompts, surfaced as MCP-sourced skills. */
export function listPromptSkills(): ReadonlyArray<Skill> {
  const skills: Skill[] = []
  for (const conn of connected.values()) {
    for (const prompt of conn.prompts) {
      skills.push({
        name: `${conn.config.name}:${prompt.name}`,
        description: prompt.description,
        argumentHint: prompt.argNames.join(', ') || undefined,
        body: '',
        source: 'mcp',
        userInvocable: true,
        modelInvocable: true,
        mcp: { server: conn.config.name, prompt: prompt.name }
      })
    }
  }
  return skills
}

export async function getPrompt(serverName: string, promptName: string, argsText: string): Promise<string> {
  const conn = requireServer(serverName)
  const def = conn.prompts.find(prompt => prompt.name === promptName)

  // A single free-text argument maps onto the prompt's first declared arg.
  const args: Record<string, string> = {}
  if (def && def.argNames.length > 0 && argsText.trim()) {
    args[def.argNames[0]] = argsText
  }

  const result = await conn.client.getPrompt({ name: promptName, arguments: args })
  return result.messages
    .map(message => {
      const content = message.content as Record<string, unknown>
      return typeof content.text === 'string' ? content.text : ''
    })
    .filter(Boolean)
    .join('\n\n')
}

// #endregion -- Prompts ---------------------------------

function requireServer(serverName: string): ConnectedServer {
  const conn = connected.get(serverName)
  if (!conn) throw new Error(`MCP server '${serverName}' is not connected`)
  return conn
}

export function registerMcpIpc(): void {
  ipcMain.handle('rue:mcp:reconnect', () => reconnectAll())
  ipcMain.handle('rue:mcp:list-tools', () => listTools())
  ipcMain.handle('rue:mcp:call-tool', (_e, server: string, name: string, args: Record<string, unknown>) =>
    callTool(server, name, args)
  )
  ipcMain.handle('rue:mcp:list-resources', () => listResources())
  ipcMain.handle('rue:mcp:read-resource', (_e, server: string, uri: string) => readResource(server, uri))
  ipcMain.handle('rue:mcp:list-prompts', () => listPromptSkills())
  ipcMain.handle('rue:mcp:get-prompt', (_e, server: string, name: string, args: string) =>
    getPrompt(server, name, args)
  )
}
