import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { browserAuthStorage, createKeynameAuth, type KeynameTokenSet } from '@multiterm/rue-auth'
import './styles.css'

const config = {
  apiUrl: import.meta.env.VITE_KEYNAME_API_URL ?? 'https://api.keyname.dev',
  clientId: import.meta.env.VITE_KEYNAME_CLIENT_ID ?? '',
  redirectUri: import.meta.env.VITE_KEYNAME_REDIRECT_URI ?? `${location.origin}/auth/callback`,
}

function App() {
  const auth = useMemo(() => createKeynameAuth(config, browserAuthStorage), [])
  const [tokens, setTokens] = useState<KeynameTokenSet | null>(null)
  const [message, setMessage] = useState('Ask Rue anything…')
  const [error, setError] = useState('')
  useEffect(() => {
    if (location.pathname !== '/auth/callback') return
    auth.exchange(location.href).then((next) => {
      setTokens(next)
      history.replaceState({}, '', '/')
    }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Sign-in failed'))
  }, [auth])
  const signIn = async () => {
    if (!config.clientId) return setError('VITE_KEYNAME_CLIENT_ID is required')
    location.assign(await auth.authorizeUrl())
  }
  return <main>
    <aside><strong>Rue</strong><nav>New session<br/>History<br/>Settings</nav></aside>
    <section>
      <header><span>Multisurface AI workspace</span>{tokens ? <button onClick={() => setTokens(null)}>Sign out</button> : <button onClick={signIn}>Continue with Keyname</button>}</header>
      <article><h1>One assistant. Every surface.</h1><p>Web, mobile, desktop, and terminal sessions backed by the Rue API.</p>{error && <p className="error">{error}</p>}</article>
      <form onSubmit={(event) => { event.preventDefault(); setMessage('Connect the Rue API to start a session.') }}><input aria-label="Message" value={message} onChange={(event) => setMessage(event.target.value)}/><button>Send</button></form>
    </section>
  </main>
}

createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>)
