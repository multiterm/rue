import './attachments.css'
import {Button,Dialog} from '@multiterm/rue-ui'
import {screenFrame} from './screenshot'
import { forwardRef, useImperativeHandle, useLayoutEffect, useEffect, useRef, useState, type ComponentProps, type KeyboardEvent } from 'react'
import { fileToken, tokenPattern, readFiles, previewImage, type DraftFile } from './attachments'

export interface ComposerHandle { pickFiles(): void; screenshot(): void }
type Props = Omit<ComponentProps<'textarea'>, 'ref' | 'onChange' | 'value'> & {
  value: string; files: DraftFile[]; onValueChange(text: string): void
  onFilesChange(files: DraftFile[]): void; onBusy(busy: boolean): void; onEditIntent?(): void
}
function serialize(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (node instanceof HTMLElement) {
    if (node.dataset.fileId) return fileToken(node.dataset.fileId)
    if (node.tagName === 'BR') return '\n'
  }
  return Array.from(node.childNodes).map((child, index) => `${index && child instanceof HTMLElement && ['DIV', 'P'].includes(child.tagName) ? '\n' : ''}${serialize(child)}`).join('')
}
export const ComposerInput = forwardRef<ComposerHandle, Props>(function ComposerInput(props, handle) {
  const { files, onFilesChange, onValueChange, onBusy, onEditIntent, value, ...inputProps } = props
  const textarea = useRef<HTMLTextAreaElement>(null), editor = useRef<HTMLDivElement>(null), picker = useRef<HTMLInputElement>(null), screenshotPicker = useRef<HTMLInputElement>(null)
  const latest = useRef(props); latest.current = props
  const selection = useRef({ start: value.length, end: value.length }), pendingCaret = useRef<number | null>(null)
  const mounted = useRef(true), busy = useRef(false), capture = useRef<MediaStream | undefined>(undefined)
  const [error, setError] = useState(''), [dragging, setDragging] = useState(false), [screenshotHelp,setScreenshotHelp]=useState(false)
  const rich = Boolean(files.length)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; capture.current?.getTracks().forEach(track => track.stop()); latest.current.onBusy(false) } }, [])
  function remember() {
    if (textarea.current) { selection.current = { start: textarea.current.selectionStart, end: textarea.current.selectionEnd }; return }
    const selected = window.getSelection(), el = editor.current
    if (!el || !selected?.rangeCount || !el.contains(selected.anchorNode) || !el.contains(selected.focusNode)) return
    const range = selected.getRangeAt(0), before = range.cloneRange()
    before.selectNodeContents(el); before.setEnd(range.startContainer, range.startOffset)
    const start = serialize(before.cloneContents()).length
    selection.current = { start, end: start + serialize(range.cloneContents()).length }
  }
  function update(text: string) {
    const p = latest.current
    if(p.files.length){const remaining=p.files.filter(file=>text.includes(fileToken(file.id)));if(remaining.length!==p.files.length)p.onFilesChange(remaining)}
    p.onValueChange(text)
  }
  async function attach(incoming: File[]) {
    const p = latest.current
    if (!incoming.length || p.disabled || p.readOnly || busy.current) return
    remember(); busy.current = true; onBusy(true); setError('')
    try {
      const added = await readFiles(incoming, latest.current.files)
      if (!mounted.current) return
      const current = latest.current, { start, end } = selection.current
      const tokens = added.map(file => fileToken(file.id)).join(' ') + ' '
      const next = current.value.slice(0, start) + tokens + current.value.slice(end)
      if (next.length > 100_000) throw new Error('The message is too long.')
      pendingCaret.current = start + tokens.length
      current.onFilesChange([...current.files, ...added].filter(file => next.includes(fileToken(file.id)))); current.onValueChange(next)
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not attach file.') }
    finally { busy.current = false; if (mounted.current) latest.current.onBusy(false) }
  }
  async function screenshot() {
    if (latest.current.disabled || latest.current.readOnly || busy.current) return
    remember(); setError('')
    if (!navigator.mediaDevices?.getDisplayMedia) { setScreenshotHelp(true); return }
    let stream: MediaStream | undefined
    busy.current = true; onBusy(true)
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }); capture.current = stream
      if (!mounted.current) return
      const blob = await screenFrame(stream)
      if (!mounted.current) return
      stream.getTracks().forEach(track => track.stop()); stream = undefined
      busy.current = false
      if (mounted.current) await attach([new File([blob], `Screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`, { type: 'image/png' })])
    } catch (cause) {
      if(mounted.current){
        setError(cause instanceof DOMException&&cause.name==='NotAllowedError'?'Screen capture was cancelled or blocked. You can choose a saved screenshot instead.':cause instanceof Error?cause.message:'Screen capture failed. Choose a saved screenshot instead.')
        setScreenshotHelp(true)
      }
    }
    finally { stream?.getTracks().forEach(track => track.stop()); capture.current = undefined; busy.current = false; if (mounted.current) latest.current.onBusy(false) }
  }
  useImperativeHandle(handle, () => ({ pickFiles() { remember(); if (!latest.current.disabled && !latest.current.readOnly) picker.current?.click() }, screenshot() { void screenshot() } }))
  useLayoutEffect(() => {
    const el = editor.current
    if (!el || serialize(el) === value) return
    const fragment = document.createDocumentFragment()
    let offset = 0
    for (const match of value.matchAll(tokenPattern())) {
      fragment.append(document.createTextNode(value.slice(offset, match.index)))
      const file = files.find(f => f.id === match[1])
      if (!file) fragment.append(document.createTextNode(match[0]))
      else {
        const chip = document.createElement('span'); chip.contentEditable = 'false'; chip.className = 'composer-file'; chip.dataset.fileId = file.id
        if (previewImage(file.mimeType)) { const image = document.createElement('img'); image.src = `data:${file.mimeType};base64,${file.data}`; image.alt = ''; chip.append(image) }
        const label = document.createElement('span'); label.textContent = file.name; chip.append(label)
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', `Remove ${file.name}`)
        remove.onmousedown = event => event.preventDefault()
        remove.onclick = () => { if (latest.current.disabled || latest.current.readOnly) return; pendingCaret.current = latest.current.value.indexOf(fileToken(file.id)); update(latest.current.value.replaceAll(fileToken(file.id), '')) }
        chip.append(remove); fragment.append(chip)
      }
      offset = match.index! + match[0].length
    }
    fragment.append(document.createTextNode(value.slice(offset)))
    el.replaceChildren(fragment)
    if (pendingCaret.current !== null) {
      el.focus(); let remaining = pendingCaret.current; const range = document.createRange()
      range.selectNodeContents(el); range.collapse(false)
      for (const node of Array.from(el.childNodes)) {
        const length = serialize(node).length
        if (remaining <= length && node.nodeType === Node.TEXT_NODE) { range.setStart(node, remaining); range.collapse(true); break }
        remaining -= length
      }
      window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range)
      pendingCaret.current = null; remember()
    }
  }, [value, files, rich])
  useLayoutEffect(() => {
    const input = textarea.current
    if (!input) return
    const resize = () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 160)}px`; if (props.readOnly) input.scrollTop = input.scrollHeight }
    const frame=requestAnimationFrame(resize)
    if (pendingCaret.current !== null) { input.focus(); input.setSelectionRange(pendingCaret.current, pendingCaret.current); pendingCaret.current = null }
    return()=>cancelAnimationFrame(frame)
  }, [value, props.readOnly, rich])
  useEffect(()=>{
    const input=textarea.current;if(!input)return
    let width=input.clientWidth,frame=0
    const observer=new ResizeObserver(()=>{const next=input.clientWidth;if(width===next)return;width=next;cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{input.style.height='auto';input.style.height=`${Math.min(input.scrollHeight,160)}px`})})
    observer.observe(input);return()=>{observer.disconnect();cancelAnimationFrame(frame)}
  },[rich])
  function insertText(text: string) {
    if (props.disabled || props.readOnly) return
    document.execCommand('insertText', false, text.slice(0, Math.max(0, 100_000 - value.length)))
    if (editor.current) { update(serialize(editor.current)); remember() }
  }
  return <><div className={`composer-editor ${dragging ? 'dragging' : ''}`} onPointerDown={event => { if (event.target instanceof Element && event.target.closest('.chat-composer-input')) onEditIntent?.() }} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = props.disabled || props.readOnly ? 'none' : 'copy'; setDragging(true) } }} onDragLeave={() => setDragging(false)} onDrop={event => {
    setDragging(false)
    if (event.dataTransfer.files.length) { event.preventDefault(); void attach(Array.from(event.dataTransfer.files)) }
    else if (rich) { event.preventDefault(); insertText(event.dataTransfer.getData('text/plain')) }
  }} onPaste={event => { if (event.clipboardData.files.length) { event.preventDefault(); void attach(Array.from(event.clipboardData.files)) } else if (rich) { event.preventDefault(); insertText(event.clipboardData.getData('text/plain')) } }}>
    <input ref={screenshotPicker} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label="Choose saved screenshot" onChange={event=>{void attach(Array.from(event.target.files??[]));event.target.value=''}}/>
    <input ref={picker} type="file" multiple hidden aria-label="Attach files" onChange={event => { void attach(Array.from(event.target.files ?? [])); event.target.value = '' }}/>
    {rich ? <div ref={editor} className={`${props.className ?? ''} rich-composer`} role="textbox" aria-label={props['aria-label']} aria-multiline="true" enterKeyHint={props.enterKeyHint} aria-disabled={props.disabled} aria-readonly={props.readOnly} contentEditable={!props.disabled && !props.readOnly} suppressContentEditableWarning onInput={() => { if (editor.current) { update(serialize(editor.current)); remember() } }} onMouseUp={remember} onKeyUp={remember} onBlur={remember} onKeyDown={event => {
      props.onKeyDown?.(event as unknown as KeyboardEvent<HTMLTextAreaElement>)
      if (!event.defaultPrevented && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); insertText('\n') }
    }}/>
    : <textarea {...inputProps} ref={textarea} value={value} placeholder={undefined} aria-placeholder={props.placeholder} onChange={event => { onValueChange(event.target.value); remember() }} onSelect={remember}/>}
    {/* A DOM hint avoids stale native textarea placeholder paint on mobile Chrome. */}
    {!rich && value.length === 0 && props.placeholder && <span className={`${props.className ?? ''} composer-placeholder`} aria-hidden="true">{props.placeholder}</span>}
    {error && <span role="alert" className="attachment-error">{error}</span>}
  </div><Dialog open={screenshotHelp} title="Attach a screenshot" onClose={()=>setScreenshotHelp(false)}><div className="grid gap-4">
    <p>This browser cannot capture your screen here, or screen sharing was cancelled. Take a screenshot using your device’s screenshot controls, then choose the saved image.</p>
    <p className="text-sm text-muted">Review or crop private information first. The image is added to your draft and is not sent until you press Send. Other apps and picture-in-picture overlays are controlled by your device, not Rue.</p>
    <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={()=>setScreenshotHelp(false)}>Cancel</Button><Button type="button" disabled={props.disabled||props.readOnly} onClick={()=>{setScreenshotHelp(false);screenshotPicker.current?.click()}}>Choose screenshot</Button></div>
  </div></Dialog></>
})
