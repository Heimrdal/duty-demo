import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { norm, tokens } from './search'
import type { Calendar } from './types'
import { inputCls } from './ui'

const LIMIT = 30

/** Выбор календаря с поиском по названию, продукту и команде (300+ календарей). ARIA combobox. */
export function CalendarPicker({ calendars, value, onChange, exclude, testId, className = '', ...aria }: {
  calendars: Calendar[]; value: string; onChange: (id: string) => void; exclude?: string[]; testId?: string; className?: string
  'aria-label'?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string
}) {
  const auto = useId()
  const listId = `${auto}-list`
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const selected = calendars.find((c) => c.id === value)
  const pool = useMemo(() => calendars.filter((c) => !exclude?.includes(c.id)), [calendars, exclude])
  const match = useMemo(() => {
    if (!open) return { list: [] as Calendar[], total: 0 }
    const toks = tokens(q)
    const hits = toks.length ? pool.filter((c) => { const hay = ' ' + norm([c.name, c.product, c.team].join(' ')); return toks.every((t) => hay.includes(t)) }) : pool
    return { list: hits.slice(0, LIMIT), total: hits.length }
  }, [open, pool, q])
  const choose = (c: Calendar) => { onChange(c.id); setQ(''); setOpen(false) }
  const move = (d: number) => {
    if (!open) { setOpen(true); return }
    const n = match.list.length
    if (!n) return
    const next = (active + d + n) % n
    setActive(next)
    listRef.current?.querySelector(`[data-idx="${next}"]`)?.scrollIntoView({ block: 'nearest' })
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
    else if (e.key === 'Enter') { if (open && match.list.length) { e.preventDefault(); choose(match.list[Math.min(active, match.list.length - 1)]) } }
    else if (e.key === 'Escape') { if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false); setQ('') } }
    else if (e.key === 'Tab') setOpen(false)
  }
  const optId = (i: number) => `${auto}-o${i}`
  return (
    <div className={`relative ${className}`} data-esc-own={open ? 'true' : undefined}>
      <input {...aria} data-testid={testId} data-value={value || undefined} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={listId}
        aria-activedescendant={open && match.list.length ? optId(Math.min(active, match.list.length - 1)) : undefined}
        autoComplete="off" spellCheck={false} className={`${inputCls} pr-8`}
        placeholder={selected ? selected.name : 'Найдите календарь'}
        value={open ? q : selected?.name ?? ''}
        onFocus={(e) => { if (e.currentTarget.dataset.quietFocus) { delete e.currentTarget.dataset.quietFocus; return } setOpen(true); setActive(0) }} onClick={() => setOpen(true)}
        onBlur={() => { setOpen(false); setQ('') }}
        onChange={(e) => { setQ(e.target.value); setActive(0); setOpen(true) }} onKeyDown={onKey} />
      <svg viewBox="0 0 24 24" aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 h-4 w-4 -translate-y-1/2 text-faint" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m7 10 5 5 5-5" /></svg>
      {open && (
        <ul ref={listRef} id={listId} role="listbox" aria-label="Календари" className="popover-in absolute right-0 left-0 z-[70] mt-1 max-h-72 overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-card scroll-thin">
          {!match.list.length && <li role="presentation" className="px-3 py-2 text-sm text-muted">Ничего не нашли. Попробуйте название, систему или команду.</li>}
          {match.list.map((c, i) => (
            <li key={c.id} id={optId(i)} data-idx={i} role="option" aria-selected={c.id === value}
              onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => choose(c)}
              className={`cursor-pointer px-3 py-1.5 text-sm ${i === Math.min(active, match.list.length - 1) ? 'bg-surface-2' : ''}`}>
              <span className="block truncate">{c.name}{c.id === value && <span aria-hidden className="ml-1 text-accent">✓</span>}</span>
              <span className="block truncate text-xs text-muted">{c.team} · {c.product}</span>
            </li>
          ))}
          {match.total > match.list.length && <li role="presentation" className="px-3 py-2 text-xs text-faint">Показаны {match.list.length} из {match.total}. Уточните запрос.</li>}
        </ul>
      )}
    </div>
  )
}
CalendarPicker.isControl = true
