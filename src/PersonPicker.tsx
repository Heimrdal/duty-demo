import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { filterPeople } from './search'
import type { Person } from './types'
import { Avatar, inputCls } from './ui'

export interface PersonPickerProps {
  people: Person[]
  value: string
  onChange: (id: string) => void
  /** эти люди показываются первыми (команда календаря) */
  teamFirst?: string[]
  teamLabel?: string
  allowEmpty?: boolean
  /** подпись пустого значения: «Выберите», «Все» */
  emptyLabel?: string
  placeholder?: string
  /** режим «добавить»: после выбора поле очищается (участники ротации) */
  addMode?: boolean
  /** скрыть этих людей (уже добавленные участники) */
  exclude?: string[]
  /** подпись справа от имени, например слой */
  note?: (p: Person) => string | undefined
  testId?: string
  id?: string
  className?: string
  'aria-describedby'?: string
  'aria-label'?: string
  'aria-invalid'?: boolean
}

const LIMIT = 50

/**
 * Выбор сотрудника с поиском по имени, telegram, подразделению и должности.
 * ARIA combobox + listbox: стрелки, Enter, Esc. Пункты не забирают фокус при нажатии (Safari/iOS).
 */
export function PersonPicker({ people, value, onChange, teamFirst = [], teamLabel = 'Команда', allowEmpty = true, emptyLabel = 'Выберите', placeholder, addMode, exclude, note, testId, id, className = '', ...aria }: PersonPickerProps) {
  const auto = useId()
  const inputId = id ?? `${auto}-in`
  const listId = `${auto}-list`
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const selected = people.find((p) => p.id === value)
  const pool = useMemo(() => (exclude?.length ? people.filter((p) => !exclude.includes(p.id)) : people), [people, exclude])
  const match = useMemo(() => (open ? filterPeople(pool, q, teamFirst, LIMIT) : null), [open, pool, q, teamFirst])
  const showEmpty = allowEmpty && !addMode && !q
  const options: (Person | null)[] = match ? [...(showEmpty ? [null] : []), ...match.team, ...match.rest] : []
  const shown = match ? match.team.length + match.rest.length : 0

  const choose = (p: Person | null) => {
    onChange(p?.id ?? '')
    setQ('')
    setActive(0)
    if (!addMode) setOpen(false)
  }
  const move = (d: number) => {
    if (!open) { setOpen(true); return }
    const n = options.length
    if (!n) return
    const next = (active + d + n) % n
    setActive(next)
    listRef.current?.querySelector(`[data-idx="${next}"]`)?.scrollIntoView({ block: 'nearest' })
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
    else if (e.key === 'Enter') { if (open && options.length) { e.preventDefault(); choose(options[Math.min(active, options.length - 1)]) } }
    else if (e.key === 'Escape') { if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false); setQ('') } }
    else if (e.key === 'Tab') setOpen(false)
  }
  const optId = (i: number) => `${auto}-o${i}`
  const display = open ? q : addMode ? '' : selected?.name ?? ''
  const teamCount = match?.team.length ?? 0
  const offset = showEmpty ? 1 : 0

  return (
    <div className={`relative ${className}`} data-esc-own={open ? 'true' : undefined}>
      <input
        {...aria}
        id={inputId}
        data-testid={testId}
        data-value={value || undefined}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && options.length ? optId(Math.min(active, options.length - 1)) : undefined}
        autoComplete="off"
        spellCheck={false}
        className={`${inputCls} pr-8`}
        placeholder={placeholder ?? (addMode ? 'Добавить: имя, telegram, подразделение' : selected ? selected.name : allowEmpty ? emptyLabel : 'Имя, telegram, подразделение')}
        value={display}
        onFocus={(e) => { if (e.currentTarget.dataset.quietFocus) { delete e.currentTarget.dataset.quietFocus; return } setOpen(true); setActive(0) }}
        onClick={() => setOpen(true)}
        onBlur={() => { setOpen(false); setQ('') }}
        onChange={(e) => { setQ(e.target.value); setActive(0); setOpen(true) }}
        onKeyDown={onKey}
      />
      <svg viewBox="0 0 24 24" aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 h-4 w-4 -translate-y-1/2 text-faint" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m7 10 5 5 5-5" /></svg>
      {open && (
        <ul ref={listRef} id={listId} role="listbox" aria-label="Сотрудники"
          className="popover-in absolute right-0 left-0 z-[70] mt-1 max-h-72 overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-card scroll-thin">
          {options.length === 0 && <li role="presentation" className="px-3 py-2 text-sm text-muted">Никого не нашли. Попробуйте фамилию, @telegram или подразделение.</li>}
          {options.map((p, i) => {
            const head = !p || !teamCount ? null : i === offset ? teamLabel : i === offset + teamCount ? 'Остальные сотрудники' : null
            const isActive = i === Math.min(active, options.length - 1)
            return [
              head && <li key={'h' + i} role="presentation" className="px-3 pt-2 pb-1 text-[11px] font-medium tracking-wide text-faint uppercase">{head}</li>,
              <li key={p?.id ?? 'empty'} id={optId(i)} data-idx={i} role="option" aria-selected={p ? p.id === value : !value}
                onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => choose(p)}
                className={`flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm ${isActive ? 'bg-surface-2' : ''}`}>
                {p ? (
                  <>
                    <Avatar p={p} size={24} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{p.name}{note?.(p) && <span className="text-muted"> · {note(p)}</span>}</span>
                      <span className="block truncate text-xs text-muted">{p.title} · {p.orgUnit} · {p.telegram}</span>
                    </span>
                    {p.id === value && <span aria-hidden className="text-accent">✓</span>}
                  </>
                ) : <span className="text-muted">{emptyLabel}</span>}
              </li>,
            ]
          })}
          {match && match.total > shown && <li role="presentation" className="px-3 py-2 text-xs text-faint">Показаны {shown} из {match.total}. Уточните запрос.</li>}
        </ul>
      )}
    </div>
  )
}
PersonPicker.isControl = true
