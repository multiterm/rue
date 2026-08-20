import { useEffect, useRef, useState } from 'react'
import { Button } from '@super-repo/ui'
import {
  Folder,
  FolderPlus,
  History,
  MoreHorizontal,
  PanelLeft,
  Pencil,
  Plus,
  Settings as SettingsIcon,
  X
} from 'lucide-react'
import { formatTokenCount } from '../lib/tokens.js'

interface ChatHeaderProps {
  readonly title: string
  readonly tokenCount: number
  readonly scopes: ReadonlyArray<string>
  readonly onRename: (title: string) => void
  readonly onNewChat: () => void
  readonly onOpenHistory: () => void
  readonly onOpenSettings: () => void
  readonly onAddScope: () => void
  readonly onRemoveScope: (path: string) => void
}

function basename(p: string): string {
  const parts = p.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

/**
 * Title bar for the expanded chat surface. Mirrors the settings header's
 * height and styling. The whole bar is a drag region; only the buttons and
 * the rename input opt out.
 */
export function ChatHeader(props: ChatHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(props.title)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [menuOpen])

  function startRename(): void {
    setDraft(props.title)
    setEditing(true)
  }

  function commitRename(): void {
    setEditing(false)
    const next = draft.trim()
    if (next && next !== props.title) props.onRename(next)
  }

  return (
    <div className="drag flex items-center gap-1 border-b border-border px-2 py-2">
      <Button
        size="icon"
        variant="ghost"
        onClick={props.onOpenHistory}
        className="no-drag size-7 shrink-0 text-muted-foreground hover:text-foreground [&_svg]:size-4"
        title="Chats"
        aria-label="Chats"
      >
        <PanelLeft />
      </Button>

      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitRename()
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              setEditing(false)
            }
          }}
          className="no-drag min-w-0 flex-1 rounded bg-muted/60 px-1.5 py-0.5 text-sm font-medium outline-none ring-1 ring-primary/50"
        />
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground/90">
            {props.title || 'New chat'}
          </span>
          <Button
            size="icon"
            variant="ghost"
            onClick={startRename}
            className="no-drag size-7 shrink-0 text-muted-foreground hover:text-foreground [&_svg]:size-3.5"
            title="Rename chat"
            aria-label="Rename chat"
          >
            <Pencil />
          </Button>
        </>
      )}

      {props.tokenCount > 0 && !editing && (
        <span
          className="no-drag shrink-0 tabular-nums text-[11px] text-muted-foreground"
          title="Estimated tokens in this conversation"
        >
          ~{formatTokenCount(props.tokenCount)}
        </span>
      )}

      <div ref={menuRef} className="no-drag relative shrink-0">
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setMenuOpen(o => !o)}
          className="size-7 text-muted-foreground hover:text-foreground [&_svg]:size-4"
          title="More"
          aria-label="More actions"
        >
          <MoreHorizontal />
        </Button>
        {menuOpen && (
          <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-border bg-popover py-1 text-popover-foreground shadow-xl">
            <MenuItem
              icon={<Pencil className="size-3.5" />}
              label="Rename chat"
              onClick={() => {
                setMenuOpen(false)
                startRename()
              }}
            />
            <MenuItem
              icon={<Plus className="size-3.5" />}
              label="New chat"
              onClick={() => {
                setMenuOpen(false)
                props.onNewChat()
              }}
            />
            <MenuItem
              icon={<History className="size-3.5" />}
              label="Chats"
              onClick={() => {
                setMenuOpen(false)
                props.onOpenHistory()
              }}
            />
            <MenuItem
              icon={<SettingsIcon className="size-3.5" />}
              label="Settings"
              onClick={() => {
                setMenuOpen(false)
                props.onOpenSettings()
              }}
            />

            <div className="my-1 border-t border-border" />
            <div className="section-heading px-3 pt-1">Folder scope</div>
            {props.scopes.length === 0 ? (
              <div className="px-3 py-1 text-[11px] text-muted-foreground">
                No folders — this chat sees no project context.
              </div>
            ) : (
              props.scopes.map(path => (
                <div key={path} className="group/scope flex items-center gap-2 px-3 py-1 text-sm">
                  <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate" title={path}>
                    {basename(path)}
                  </span>
                  <button
                    type="button"
                    onClick={() => props.onRemoveScope(path)}
                    className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover/scope:opacity-100"
                    aria-label={`Remove ${basename(path)}`}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))
            )}
            <MenuItem
              icon={<FolderPlus className="size-3.5" />}
              label="Add folder…"
              onClick={() => {
                setMenuOpen(false)
                props.onAddScope()
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function MenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-foreground/90 hover:bg-accent hover:text-accent-foreground"
    >
      <span className="text-muted-foreground">{icon}</span>
      {label}
    </button>
  )
}
