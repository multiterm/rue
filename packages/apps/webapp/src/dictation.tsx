import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import {Button, MicIcon } from '@multiterm/rue-ui'
import { formatDictation, startsDictatedSentence } from './dictation-format'

interface Recognition {
  continuous: boolean; interimResults: boolean; lang: string
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void; stop(): void; abort(): void
}
declare global { interface Window { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition } }
export interface DictationHandle { stopForEditing(): void }
export function Dictation({ value, onChange, disabled, onListening, primary = false, controlRef }: { controlRef?: Ref<DictationHandle>; primary?: boolean; value: string; onChange(text: string): void; disabled: boolean; onListening(value: boolean): void }) {
  const [listening, setListening] = useState(false), [error, setError] = useState('')
  const recognition = useRef<Recognition | null>(null)
  const stopTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const restartTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const cleanupDraft = useRef<(() => void) | undefined>(undefined)
  const cleanupRequested = useRef(false)
  const latest = useRef({ value, onChange, onListening })
  latest.current = { value, onChange, onListening }
  const Constructor = window.SpeechRecognition ?? window.webkitSpeechRecognition

  function finish(instance: Recognition, abort = false) {
    if (recognition.current !== instance) return
    recognition.current = null
    clearTimeout(stopTimer.current); stopTimer.current = undefined
    clearTimeout(restartTimer.current); restartTimer.current = undefined
    if (cleanupRequested.current) cleanupDraft.current?.()
    cleanupRequested.current = false; cleanupDraft.current = undefined
    instance.onresult = instance.onerror = instance.onend = null
    if (abort) { try { instance.abort() } catch { /* Already stopped. */ } }
    setListening(false); latest.current.onListening(false)
  }
  useImperativeHandle(controlRef, () => ({ stopForEditing() {
    // Editing takes precedence over final speech results and punctuation cleanup.
    // Detach callbacks before aborting so late browser events cannot change text.
    cleanupRequested.current = false
    if (recognition.current) finish(recognition.current, true)
  } }))
  useEffect(() => () => {
    clearTimeout(stopTimer.current)
    clearTimeout(restartTimer.current)
    cleanupDraft.current = undefined; cleanupRequested.current = false
    const instance = recognition.current
    if (instance) {
      recognition.current = null
      instance.onresult = instance.onerror = instance.onend = null
      try { instance.abort() } catch { /* Already stopped. */ }
    }
    latest.current.onListening(false)
  }, [])
  useEffect(() => { if (disabled && recognition.current) finish(recognition.current, true) }, [disabled])
  useEffect(() => {
    const stopWhenHidden = () => { if (document.hidden && recognition.current) finish(recognition.current, true) }
    document.addEventListener('visibilitychange', stopWhenHidden)
    return () => document.removeEventListener('visibilitychange', stopWhenHidden)
  }, [])

  function toggle() {
    const current = recognition.current
    if (current) {
      cleanupRequested.current = true
      // Allow a final result, but never leave the composer locked if a browser
      // fails to dispatch onend (for example while permission is pending).
      if (!stopTimer.current) stopTimer.current = setTimeout(() => finish(current, true), 2000)
      try { current.stop() } catch { finish(current, true) }
      return
    }
    if (!Constructor || disabled) return
    const original = latest.current.value, language = navigator.language || 'en-US'
    let draft = original
    cleanupRequested.current = false
    cleanupDraft.current = () => {
      const after = (original + formatDictation(draft.slice(original.length), { language, sentenceStart: startsDictatedSentence(original), finish: true })).slice(0, 100000)
      if (after !== draft) latest.current.onChange(after)
    }
    // One utterance per recognizer avoids continuous-mode implementations that
    // retain cumulative hypotheses in separate result slots. Joining those slots
    // produces "we we want we want to ...". Restart after each completed utterance
    // while the microphone is enabled, committing its draft only once.
    const startUtterance = (base: string) => {
      let instance: Recognition
      try { instance = new Constructor() } catch {
        if (recognition.current) finish(recognition.current, true)
        else { setListening(false); latest.current.onListening(false) }
        setError('Dictation could not start. Try your keyboard’s dictation feature.'); return
      }
      recognition.current = instance
      let rendered = base, hasText = false, silence = false
      instance.continuous = false; instance.interimResults = true; instance.lang = language
      instance.onresult = event => {
        if (recognition.current !== instance) return
        // In single-utterance mode the latest hypothesis replaces the utterance,
        // even if the browser retains earlier hypotheses (including final ones).
        // Do not deduplicate words: deliberate repetitions must remain intact.
        const result = event.results[event.results.length - 1]
        const raw = result?.[0].transcript.trim() ?? ''
        const transcript = result?.isFinal ? formatDictation(raw, { language, sentenceStart: startsDictatedSentence(base) }) : raw
        hasText = Boolean(transcript)
        rendered = `${base}${base && transcript && !/\s$/.test(base) ? ' ' : ''}${transcript}`.slice(0,100000)
        draft = rendered
        latest.current.onChange(rendered)
      }
      instance.onerror = event => {
        if (recognition.current !== instance) return
        if (event.error === 'no-speech' && !stopTimer.current) { silence = true; return }
        setError(event.error === 'not-allowed' || event.error === 'service-not-allowed' ? 'Microphone or speech-service permission was denied. Check your browser permissions.' : event.error === 'no-speech' ? 'No speech detected. Your draft is kept; try again.' : 'Dictation unavailable. Your draft is kept. Try again or use your keyboard’s dictation feature.')
        finish(instance, true)
      }
      instance.onend = () => {
        if (recognition.current !== instance) return
        if (stopTimer.current) { finish(instance); return }
        instance.onresult = instance.onerror = instance.onend = null
        // Silence is a pause, not a failed recording. Back off before restarting
        // an empty recognizer to avoid a tight loop on browser/service failures.
        if (!hasText || silence) {
          restartTimer.current = setTimeout(() => {
            restartTimer.current = undefined
            if (recognition.current === instance && !stopTimer.current) startUtterance(rendered)
          }, 500)
        } else startUtterance(rendered)
      }
      try { instance.start() }
      catch { finish(instance, true); setError('Dictation could not start. Use your keyboard’s dictation feature.') }
    }
    setError(''); setListening(true); latest.current.onListening(true)
    startUtterance(latest.current.value)
  }
  const unavailable = !Constructor || (disabled && !listening)
  const title = !Constructor ? 'Browser dictation is unavailable. Use your keyboard’s dictation feature.' : listening ? 'Listening — click to stop' : 'Dictate into draft'
  return <><Button variant="bare" type="button" className={`dictation-button ${listening ? 'listening' : ''}`} aria-label={listening ? 'Stop dictation' : 'Start dictation'} aria-pressed={listening} disabled={unavailable} title={title} onClick={toggle}><MicIcon size={18}/></Button>
    {primary && <Button variant="bare" type="button" className={`dictation-button composer-primary-voice ${listening ? 'listening' : ''}`} aria-label={listening ? 'Stop voice recording' : 'Start voice recording'} aria-pressed={listening} disabled={unavailable} title={title} onClick={toggle}>{listening ? <span className="dictation-wave" aria-hidden="true">{[0,1,2,3,4].map(i => <span key={i}/>)}</span> : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 10v4m4-8v12m4-15v18m4-14v10m4-7v4"/></svg>}</Button>}
    {error && <p className="dictation-error" role="alert">{error}<Button variant="bare" type="button" aria-label="Dismiss dictation error" onClick={() => setError('')}>×</Button></p>}
  </>
}
