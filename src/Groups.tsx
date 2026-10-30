import { useState, type ReactNode } from 'react'

/** Сворачиваемая группа (подразделение): заголовок-кнопка с aria-expanded и счётчиками. */
export function Group({ id, title, count, extra, open, onToggle, children }: { id: string; title: string; count: ReactNode; extra?: ReactNode; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className="border-b border-line" data-testid="org-group">
      <h2 className="m-0">
        <button type="button" aria-expanded={open} aria-controls={`grp-${id}`} onClick={onToggle}
          className="flex w-full items-center gap-3 py-3 text-left hover:text-accent">
          <svg viewBox="0 0 24 24" aria-hidden className={`h-4 w-4 shrink-0 text-faint transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m9 6 6 6-6 6" /></svg>
          <span className="flex-1 text-sm font-medium">{title}</span>
          {extra && <span className="text-xs text-muted">{extra}</span>}
          <span className="min-w-8 rounded-full bg-surface-2 px-2 py-0.5 text-center text-xs text-muted tabular-nums">{count}</span>
        </button>
      </h2>
      {open && <div id={`grp-${id}`} className="pb-4">{children}</div>}
    </section>
  )
}

/** Какие группы раскрыты. При поиске раскрываются все найденные. */
export function useOpenGroups(initial: string[]) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(initial))
  return {
    isOpen: (k: string) => open.has(k),
    toggle: (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n }),
    setAll: (keys: string[]) => setOpen(new Set(keys)),
  }
}
