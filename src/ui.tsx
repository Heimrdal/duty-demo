import { cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { PEOPLE } from './data'
import type { Calendar, CalendarType, LayerKind, Person } from './types'
import { resolveChain } from './escalation'
import { useStore } from './store'

export { ESC_LABEL, resolveChain, type ChainLevel } from './escalation'

export const TYPE_META: Record<CalendarType, { label: string; color: string; bg: string; icon: string }> = {
  sitcenter: { label: 'Ситуационный центр', color: '#e5484d', bg: '#fee2e2', icon: '' },
  monitoring: { label: 'Мониторинг', color: '#f0a04b', bg: '#fef3c7', icon: '' },
  product: { label: 'Продукт', color: '#5e6ad2', bg: '#e0e7ff', icon: '' },
  infra: { label: 'Инфраструктура', color: '#8b5cf6', bg: '#ede9fe', icon: '' },
}
export const KIND_META: Record<LayerKind | 'override' | 'oneoff', { label: string; color: string; bg: string; pattern?: boolean }> = {
  primary: { label: 'Основной', color: '#0f766e', bg: '#ccfbf1' },
  secondary: { label: 'Резерв', color: '#64748b', bg: '#e2e8f0' },
  business: { label: 'Рабочие часы', color: '#0369a1', bg: '#e0f2fe' },
  night: { label: 'Ночь и выходные', color: '#4f46e5', bg: '#e0e7ff' },
  shadow: { label: 'Стажёр', color: '#a16207', bg: '#fef9c3' },
  oneoff: { label: 'Разовое', color: '#be185d', bg: '#fce7f3' },
  override: { label: 'Подмена', color: '#be185d', bg: '#fce7f3', pattern: true },
}
const PALETTE = ['#2563eb', '#16a34a', '#db2777', '#ea580c', '#7c3aed', '#0891b2', '#ca8a04', '#dc2626', '#4f46e5', '#059669', '#9333ea', '#0d9488', '#c2410c', '#be123c', '#65a30d', '#0284c7', '#a21caf', '#b45309']
export function personColor(id: string) {
  const idx = PEOPLE.findIndex((p) => p.id === id)
  if (idx >= 0) return PALETTE[idx % PALETTE.length]
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}
export const initials = (n: string) => n.split(' ').map((x) => x[0]).slice(0, 2).join('')

/** «Имя Фамилия» → «И. Фамилия». Полное имя остаётся в подсказке. */
export function shortName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) return name
  const surname = parts[parts.length - 1]
  const ini = parts.slice(0, -1).map((p) => `${p[0]}.`).join('')
  return `${ini} ${surname}`
}
export const teamHref = (team: string) => `#/teams/${encodeURIComponent(team)}`

export function Avatar({ p, size = 28 }: { p?: Person; size?: number }) {
  if (!p) return null
  return (
    <span title={p.name} className="inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white"
      style={{ width: size, height: size, background: personColor(p.id), fontSize: size * 0.36 }}>
      {initials(p.name)}
    </span>
  )
}

export function Badge({ children, color, bg, className = '' }: { children: ReactNode; color: string; bg: string; className?: string }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${className}`} style={{ color, background: bg }}>{children}</span>
}
export const TypeBadge = ({ t }: { t: CalendarType }) => <Badge color={TYPE_META[t].color} bg={TYPE_META[t].bg}>{TYPE_META[t].label}</Badge>
export const KindBadge = ({ k }: { k: string }) => {
  const m = KIND_META[k as LayerKind] ?? KIND_META.override
  return <Badge color={m.color} bg={m.bg}>{m.label}</Badge>
}
export function KindMark({ k }: { k: string }) {
  const m = KIND_META[k as LayerKind] ?? KIND_META.override
  return <span className="inline-flex items-center gap-1.5 text-muted"><span className="h-1.5 w-1.5 rounded-full" style={{ background: m.color }} />{m.label}</span>
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-line bg-surface shadow-card ${className}`}>{children}</div>
}

export function Btn({ children, onClick, variant = 'primary', className = '', type = 'button', disabled, title }: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'ghost' | 'danger' | 'soft'; className?: string; type?: 'button' | 'submit'; disabled?: boolean; title?: string
}) {
  const v = {
    primary: 'bg-accent text-white hover:bg-accent-2',
    soft: 'bg-accent-soft text-accent hover:brightness-95',
    ghost: 'bg-transparent text-ink hover:bg-surface-2',
    danger: 'bg-transparent text-danger hover:bg-danger/10',
  }[variant]
  return <button type={type} title={title} disabled={disabled} onClick={onClick} className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-40 ${v} ${className}`}>{children}</button>
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
const openModals: HTMLElement[] = []

/** Доступное модальное окно: role=dialog, aria-modal, фокус внутри, Esc закрывает, фокус возвращается к кнопке-инициатору, фон inert. */
export function Modal({ title, children, onClose, wide, describedBy }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean; describedBy?: string }) {
  const closeRef = useRef(onClose)
  const boxRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useEffect(() => { closeRef.current = onClose })
  useLayoutEffect(() => {
    const box = boxRef.current!
    const opener = document.activeElement as HTMLElement | null
    openModals.push(box)
    const root = document.getElementById('root')
    root?.setAttribute('inert', '')
    root?.setAttribute('aria-hidden', 'true')
    const first = box.querySelector<HTMLElement>('[autofocus], [data-autofocus]') ?? box.querySelector<HTMLElement>(`.modal-body ${FOCUSABLE}`) ?? box
    first.focus()
    const key = (e: KeyboardEvent) => {
      if (openModals[openModals.length - 1] !== box) return
      if (e.key === 'Escape') {
        // открытый список выбора сотрудника сам закрывается по Esc, окно остаётся
        if ((e.target as HTMLElement | null)?.closest?.('[data-esc-own="true"]')) return
        e.stopPropagation(); closeRef.current(); return
      }
      if (e.key !== 'Tab') return
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement)
      if (!items.length) { e.preventDefault(); box.focus(); return }
      const a = items[0]
      const z = items[items.length - 1]
      const cur = document.activeElement
      if (e.shiftKey && (cur === a || !box.contains(cur))) { e.preventDefault(); z.focus() }
      else if (!e.shiftKey && (cur === z || !box.contains(cur))) { e.preventDefault(); a.focus() }
    }
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('keydown', key, true)
      openModals.splice(openModals.indexOf(box), 1)
      if (!openModals.length) { root?.removeAttribute('inert'); root?.removeAttribute('aria-hidden') }
      if (opener && document.contains(opener)) opener.focus()
    }
  }, [])
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-16" onMouseDown={onClose}>
      <div ref={boxRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={describedBy} tabIndex={-1}
        className={`popover-in w-full outline-none ${wide ? 'max-w-3xl' : 'max-w-lg'} rounded-2xl border border-line bg-surface shadow-card`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 pt-5 pb-1">
          <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Закрыть" title="Закрыть" className="rounded-md px-2 text-xl leading-none text-faint hover:text-ink">×</button>
        </div>
        <div className="modal-body px-6 pt-3 pb-6">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

const CONTROL_TAGS = new Set(['input', 'select', 'textarea'])
type ControlProps = { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }

/**
 * Подпись поля. Для одиночного input/select/textarea — настоящий <label for>, подсказка и ошибка
 * связаны через aria-describedby. Для группы кнопок — role=group с aria-labelledby.
 */
export function Field({ label, children, hint, error }: { label: string; children: ReactNode; hint?: string; error?: string }) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errId = error ? `${id}-err` : undefined
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined
  const single = isValidElement(children) && (typeof children.type === 'string' ? CONTROL_TAGS.has(children.type) : !!(children.type as { isControl?: boolean }).isControl)
  if (single) {
    const el = children as ReactElement<ControlProps>
    const ctlId = el.props.id ?? `${id}-ctl`
    return (
      <div className="block">
        <label htmlFor={ctlId} className="mb-1.5 block text-sm font-medium">{label}</label>
        {cloneElement(el, { id: ctlId, 'aria-describedby': [el.props['aria-describedby'], describedBy].filter(Boolean).join(' ') || undefined, ...(error ? { 'aria-invalid': true } : {}) })}
        {hint && <div id={hintId} className="mt-1.5 text-xs text-muted">{hint}</div>}
        {error && <div id={errId} role="alert" className="mt-1.5 text-xs text-danger">{error}</div>}
      </div>
    )
  }
  return (
    <div className="block" role="group" aria-labelledby={`${id}-lbl`} aria-describedby={describedBy}>
      <div id={`${id}-lbl`} className="mb-1.5 text-sm font-medium">{label}</div>
      {children}
      {hint && <div id={hintId} className="mt-1.5 text-xs text-muted">{hint}</div>}
      {error && <div id={errId} role="alert" className="mt-1.5 text-xs text-danger">{error}</div>}
    </div>
  )
}
export const inputCls = 'w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20'

export function Empty({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-6 py-16 text-center">
      <div className="text-sm font-medium">{title}</div>
      {text && <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Menu({ label = 'Ещё', items }: { label?: string; items: { label: string; onClick: () => void; danger?: boolean; disabled?: boolean }[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen((v) => !v)} className="rounded-md px-2 py-1 text-sm tracking-widest text-faint hover:bg-surface-2 hover:text-ink">···</button>
      {open && (
        <div className="popover-in absolute right-0 z-30 mt-1 min-w-44 rounded-lg border border-line bg-surface p-1 shadow-card">
          {items.map((it) => (
            <button key={it.label} type="button" disabled={it.disabled} onClick={() => { setOpen(false); it.onClick() }} className={`block w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-surface-2 disabled:opacity-40 ${it.danger ? 'text-danger' : 'text-ink'}`}>{it.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Подмена: белая штриховка и пунктирная рамка внутри полосы. */
export const SUBST_STYLE: CSSProperties = {
  backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,.45) 0 3px, transparent 3px 7px)',
  boxShadow: 'inset 0 0 0 1.5px rgba(255,255,255,.95)',
  outline: '1.5px dashed rgba(0,0,0,.35)',
  outlineOffset: '-1.5px',
}
/** Конфликт: две смены одного человека сразу — сплошная оранжевая рамка и значок «!». Без штриховки. */
export const CONFLICT_STYLE: CSSProperties = {
  border: '2px solid var(--c-warn)',
  background: 'color-mix(in srgb, var(--c-warn) 14%, transparent)',
}

/** Одна и та же легенда для всех таймлайнов. */
export function ScheduleLegend() {
  return (
    <div data-testid="schedule-legend" className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm" style={{ background: '#2563eb' }} />цвет — человек</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-3 w-5 rounded-sm" style={{ background: '#2563eb', ...SUBST_STYLE }} />штриховка с пунктиром — подмена</span>
      <span className="inline-flex items-center gap-1.5"><span className="relative inline-flex h-3 w-5 items-center justify-center rounded-sm text-[9px] font-bold text-warn" style={CONFLICT_STYLE}>!</span>оранжевая рамка с «!» — конфликт: две смены одного человека сразу</span>
      <span className="inline-flex items-center gap-1.5"><span className="gap-band h-2.5 w-4 rounded-sm" />розовое «Нет дежурного» — никто не назначен</span>
      <span>нажмите на смену — подробности</span>
    </div>
  )
}

export interface BarAction { label: string; onClick: () => void; danger?: boolean }
export interface BarInfo { title: string; lines: string[]; rect: { left: number; top: number; bottom: number }; actions?: BarAction[] }

/** Карточка смены по клику или фокусу на полосе таймлайна. */
export function BarCard({ info, onClose }: { info: BarInfo; onClose: () => void }) {
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current() }
    const down = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest?.('[data-bar], [data-bar-card]')) closeRef.current() }
    window.addEventListener('keydown', key)
    window.addEventListener('pointerdown', down, true)
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('pointerdown', down, true) }
  }, [])
  const acts = info.actions ?? []
  const h = 190 + (acts.length ? 44 : 0)
  const below = info.rect.bottom + h < window.innerHeight
  return createPortal(
    <div data-bar-card role={acts.length ? 'group' : 'status'} aria-label={acts.length ? `Смена: ${info.title}` : undefined} data-testid="bar-card" className="popover-in fixed z-50 w-72 rounded-lg border border-line bg-surface px-3 py-2.5 text-sm shadow-card"
      style={{ left: Math.max(8, Math.min(info.rect.left, window.innerWidth - 300)), top: below ? info.rect.bottom + 6 : Math.max(8, info.rect.top - h - 6) }}>
      <div className="font-medium">{info.title}</div>
      {info.lines.map((l) => <div key={l} className="mt-0.5 text-muted">{l}</div>)}
      {acts.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1 border-t border-line pt-2">
          {acts.map((a) => (
            <button key={a.label} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onClose(); a.onClick() }} className={`rounded-md px-2 py-1 text-xs font-medium hover:bg-surface-2 ${a.danger ? 'text-danger' : 'text-accent'}`}>{a.label}</button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  )
}
/**
 * Закрывать ли карточку смены, когда полоса теряет фокус. Только если фокус ушёл на другой элемент
 * вне карточки (Tab с клавиатуры). В Safari/iOS кнопка при клике фокус не получает и relatedTarget = null:
 * раньше карточка закрывалась до click, и кнопки в ней «не работали». Клики мимо закрывает обработчик pointerdown.
 */
export function blurClosesCard(related: EventTarget | null) {
  const el = related as HTMLElement | null
  return !!el && !el.closest?.('[data-bar-card]')
}

export function barRect(el: Element) {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, bottom: r.bottom }
}

export function Legend() {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {(Object.keys(TYPE_META) as CalendarType[]).map((t) => (
          <span key={t} className="inline-flex items-center gap-2 text-muted"><span className="h-2 w-2 rounded-full" style={{ background: TYPE_META[t].color }} />{TYPE_META[t].label}</span>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {Object.entries(KIND_META).map(([k, m]) => (
          <span key={k} className="inline-flex items-center gap-2 text-muted"><span className="h-2 w-2 rounded-full" style={{ background: m.color }} />{m.label}</span>
        ))}
      </div>
    </div>
  )
}

export function EscalationChain({ c, people, t, compact, calendars }: { c: Calendar; people: Person[]; t: number; compact?: boolean; calendars?: Calendar[] }) {
  const chain = resolveChain(c, people, t, calendars)
  const alreadyText = (lv: ReturnType<typeof resolveChain>[number]) => lv.already.map((a) => `${shortName(a.person.name)} — уже на уровне ${a.level}`).join(', ')
  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {chain.map((lv, i) => (
          <span key={i} className="inline-flex items-center gap-2">
            {i > 0 && <span className="text-faint">→</span>}
            <span title={lv.note ? `${lv.label}. ${lv.note}` : lv.label}>
              <span className="text-faint">{lv.label}: </span>
              {lv.people.length ? lv.people.map((p) => shortName(p.name)).join(', ') : lv.already.length ? <span className="text-faint">пропуск, {alreadyText(lv)}</span> : '—'}
              {lv.delayMin > 0 && <span className="text-faint"> +{lv.delayMin} мин</span>}
            </span>
          </span>
        ))}
      </div>
    )
  }
  return (
    <div className="space-y-4">
      {chain.map((lv) => (
        <div key={lv.level} className="flex items-start gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-medium">{lv.level}</span>
          <div className="min-w-0">
            <div className="text-sm">
              <span className="font-medium">{lv.label}</span>
              <span className="text-muted"> · {lv.delayMin === 0 ? 'сразу' : `через ${lv.delayMin} мин`}</span>
              {lv.note && <span className="text-faint"> · {lv.note}</span>}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
              {lv.people.map((p) => <PersonPill key={p.id} p={p} />)}
              {!lv.people.length && !lv.already.length && <span className="text-sm text-danger">Никого — дыра в покрытии</span>}
            </div>
            {lv.already.length > 0 && (
              <div data-testid="esc-skip" className="mt-1 text-xs text-faint">
                {lv.people.length ? 'Не дублируем: ' : 'Уровень пропущен — уже уведомлены: '}{alreadyText(lv)}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export function PersonPill({ p, extra }: { p: Person; extra?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <Avatar p={p} size={22} />
      <span>{p.name}</span>
      <span className="text-muted">{p.phone}</span>
      <ContactActions p={p} />
      {extra}
    </span>
  )
}

const telHref = (phone: string) => 'tel:' + phone.replace(/[^\d+]/g, '')

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try { ok = document.execCommand('copy') } catch { ok = false }
    ta.remove()
    return ok
  }
}

const iconBtn = 'inline-flex h-6 w-6 items-center justify-center rounded-md text-faint hover:bg-surface-2 hover:text-ink focus-visible:text-ink'

/** Быстрые действия: позвонить (tel:) и скопировать номер. */
export function ContactActions({ p }: { p: Person }) {
  const { toast } = useStore()
  return (
    <span className="inline-flex items-center gap-0.5" data-testid="contact-actions">
      <a href={telHref(p.phone)} className={iconBtn} aria-label={`Позвонить: ${p.name}, ${p.phone}`} title={`Позвонить ${p.phone}`}>
        <svg viewBox="0 0 24 24" aria-hidden className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" /></svg>
      </a>
      <button type="button" className={iconBtn} aria-label={`Скопировать номер: ${p.name}`} title="Скопировать номер"
        onClick={async () => toast((await copyText(p.phone)) ? `Номер ${p.phone} скопирован` : `Не удалось скопировать. Номер: ${p.phone}`)}>
        <svg viewBox="0 0 24 24" aria-hidden className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 9h10v11H9z M5 15H4V4h11v1" /></svg>
      </button>
    </span>
  )
}
