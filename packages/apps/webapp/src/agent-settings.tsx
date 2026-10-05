import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from '@tanstack/react-form'
import { Button, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from '@multiterm/rue-ui'
import { RueApiError, type RueAgentSettings } from '@multiterm/rue-sdk'
import { rue } from './client'
import { LoadingSkeleton } from './loading-skeleton'
import { SettingsHelp } from './settings-support'

export function AgentSettingsPanel({ owner, onClose }: { owner: string; onClose(): void }) {
  const settings = useQuery({ queryKey: ['agent-settings', owner], queryFn: () => rue.agentSettings(), retry: false })
  return <div className="settings-stack">
    {settings.isPending ? <LoadingSkeleton label="Loading agent settings"/> : !settings.data || settings.data.ownerSubject !== owner ? <p role="alert">Model settings unavailable. Try again.</p> : <AgentSettingsForm initial={settings.data} onClose={onClose}/>}
    <SettingsHelp section="models"/>
  </div>
}
function AgentSettingsForm({ initial: incoming, onClose }: { initial: RueAgentSettings; onClose(): void }) {
  const [initial] = useState(incoming), [error, setError] = useState('')
  const cache = useQueryClient()
  const form = useForm({ defaultValues: { model: initial.model, systemPrompt: initial.systemPrompt }, onSubmit: async ({ value }) => {
    setError('')
    try {
      const updated = await rue.saveAgentSettings({ expectedOwnerSubject: initial.ownerSubject, harness: initial.harness, provider: initial.provider, model: value.model, systemPrompt: value.systemPrompt, expectedRevision: initial.revision })
      cache.setQueryData(['agent-settings', initial.ownerSubject], updated); void cache.invalidateQueries({ queryKey: ['provider-keys', initial.ownerSubject] }); onClose()
    } catch (cause) { setError(cause instanceof RueApiError && cause.status === 409 ? 'Settings changed. Close and reopen Settings to retry.' : 'Could not save model defaults.') }
  } })
  return <form className="settings-stack" onSubmit={event => { event.preventDefault(); void form.handleSubmit() }}>
    <div className="settings-card"><div className="settings-row"><strong>Cloud defaults</strong><span>Pi · OpenAI</span></div>
      <form.Field name="model">{field => <div className="grid gap-2"><Label htmlFor="agent-model">Model</Label><Select value={field.state.value} onValueChange={field.handleChange}><SelectTrigger id="agent-model"><SelectValue/></SelectTrigger><SelectContent>{initial.models.map(model => <SelectItem key={model} value={model}>{model}</SelectItem>)}</SelectContent></Select></div>}</form.Field>
      <form.Field name="systemPrompt">{field => <div className="grid gap-2"><Label htmlFor="agent-system-prompt">System prompt</Label><Textarea id="agent-system-prompt" maxLength={16000} rows={5} value={field.state.value} onChange={event => field.handleChange(event.target.value)}/></div>}</form.Field>
      <p>Remote agents select their model in Pi.</p>
    </div>
    {error && <p role="alert">{error}</p>}
    <form.Subscribe selector={state => state.isSubmitting}>{pending => <div className="settings-actions"><Button type="submit" disabled={pending}>Save defaults</Button></div>}</form.Subscribe>
  </form>
}
