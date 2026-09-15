import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from '@tanstack/react-form'
import { Button, Checkbox, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from '@multiterm/rue-ui'
import { RueApiError, type RueAgentSettings } from '@multiterm/rue-sdk'
import { rue } from './client'

export function AgentSettingsPanel({ owner, onClose }: { owner: string; onClose(): void }) {
  const settings = useQuery({ queryKey: ['agent-settings', owner], queryFn: () => rue.agentSettings(), retry: false })
  return <div>
    <p className="mb-5 text-sm text-muted">Your account’s bot defaults. Changes apply to the next message, including existing bots.</p>
    {settings.isPending ? <p role="status">Loading agent settings…</p> : !settings.data || settings.data.ownerSubject !== owner ? <p role="alert">Could not load your agent settings. Close and try again.</p> : <AgentSettingsForm initial={settings.data} onClose={onClose}/>}
  </div>
}
function AgentSettingsForm({ initial: incoming, onClose }: { initial: RueAgentSettings; onClose(): void }) {
  const [initial] = useState(incoming)
  const queryClient = useQueryClient(), [error, setError] = useState('')
  const form = useForm({
    defaultValues: { harness: initial.harness, provider: initial.provider, model: initial.model, systemPrompt: initial.systemPrompt, apiKey: '', removeKey: false },
    onSubmit: async ({ value }) => {
      setError('')
      try {
        const updated = await rue.saveAgentSettings({ expectedOwnerSubject: initial.ownerSubject, harness: value.harness, provider: value.provider, model: value.model, systemPrompt: value.systemPrompt,
          expectedRevision: initial.revision, ...(value.removeKey ? { apiKey: null } : value.apiKey.trim() ? { apiKey: value.apiKey.trim() } : {}) })
        queryClient.setQueryData(['agent-settings', initial.ownerSubject], updated)
        onClose()
      } catch (cause) {
        setError(cause instanceof RueApiError && cause.status === 409 ? 'Settings or account changed. Close and reopen settings before saving again.' : 'Could not save agent settings. Check server credential storage and try again.')
      } finally { form.setFieldValue('apiKey', '') }
    },
  })
  return <form className="bot-create-form" onSubmit={event => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit() }}>
    <form.Field name="harness">{field => <div className="grid gap-2"><Label htmlFor="agent-harness">Agent harness</Label><Select value={field.state.value} onValueChange={() => field.handleChange('pi')}><SelectTrigger id="agent-harness"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="pi">Pi agent</SelectItem></SelectContent></Select></div>}</form.Field>
    <form.Field name="provider">{field => <div className="grid gap-2"><Label htmlFor="agent-provider">Model provider</Label><Select value={field.state.value} onValueChange={() => field.handleChange('openai')}><SelectTrigger id="agent-provider"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="openai">OpenAI</SelectItem></SelectContent></Select></div>}</form.Field>
    <form.Field name="model">{field => <div className="grid gap-2"><Label htmlFor="agent-model">Model</Label><Select value={field.state.value} onValueChange={field.handleChange}><SelectTrigger id="agent-model"><SelectValue/></SelectTrigger><SelectContent>{initial.models.map(model => <SelectItem key={model} value={model}>{model}</SelectItem>)}</SelectContent></Select></div>}</form.Field>
    <form.Field name="systemPrompt">{field => <div className="grid gap-2"><Label htmlFor="agent-system-prompt">System prompt</Label><Textarea id="agent-system-prompt" maxLength={16000} value={field.state.value} onChange={event => field.handleChange(event.target.value)}/></div>}</form.Field>
    <p>OpenAI API key: {initial.apiKeyConfigured ? 'Configured' : 'Not configured'}. Leave blank to keep the saved key.</p>
    {!initial.keyStorageAvailable && <p role="status">Secure server credential storage is not configured. API keys cannot be saved yet.</p>}
    <form.Field name="apiKey">{field => <Input label="OpenAI API key" type="password" autoComplete="new-password" maxLength={4096} disabled={!initial.keyStorageAvailable} value={field.state.value} onChange={event => field.handleChange(event.target.value)} show={{ label: true, hideRequireType: true }}/>}</form.Field>
    {initial.apiKeyConfigured && <form.Field name="removeKey">{field => <div className="grid gap-2"><Label htmlFor="agent-remove-key">Remove saved API key</Label><Checkbox id="agent-remove-key" checked={field.state.value} onCheckedChange={value => field.handleChange(value === true)}/></div>}</form.Field>}
    <p>Saving does not validate provider access. Recovery requires both the database backup and a separately protected server-key backup.</p>
    <p>Pi runs chat only here. Shell, file access, extensions, deployment tools, and self-updates are disabled. Your key is never returned to the app or synced to devices.</p>
    {error && <p role="alert">{error}</p>}
    <form.Subscribe selector={state => state.isSubmitting}>{pending => <div className="bot-dialog-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={pending} isLoading={pending}>Save agent settings</Button></div>}</form.Subscribe>
  </form>
}
