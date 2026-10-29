import { useEffect, useRef, useState, type ReactNode } from 'react'
import { PEOPLE } from './data'
import type { Calendar, CalendarType, EscStep, LayerKind, Person } from './types'
import { calendarOnCall, layerOnCall, managerOf, nextInRotation } from './engine'

export const TYPE_META: Record<CalendarType, { label: string; color: string; bg: string; icon: string }> = {
  sitcenter: { label: 'Ситуационный центр', color: '#e5484d', bg: '#fee2e2', icon: '' },
  monitoring: { label: 'Мониторинг', color: '#f0a04b', bg: '#fef3c7', icon: '' },
  product: { label: 'Продукт', color: '#5e6ad2', bg: '#e0e7ff', icon: '' },
  infra: { label: 'Инфраструктура', color: '#8b5cf6', bg: '#ede9fe', icon: '' },
}
export const KIND_META: Record<LayerKind | 'override', { label: string; color: string; bg: string; pattern?: boolean }> = {
  primary: { label: 'Основной', color: '#0f766e', bg: '#ccfbf1' },
  secondary: { label: 'Резерв', color: '#64748b', bg: '#e2e8f0' },
  business: { label: 'Рабочие часы', color: '#0369a1', bg: '#e0f2fe' },
  night: { label: 'Ночь и выходные', color: '#4f46e5', bg: '#e0e7ff' },
  shadow: { label: 'Стажёр', color: '#a16207', bg: '#fef9c3' },
  override: { label: 'Подмена', color: '#be185d', bg: '#fce7f3', pattern: true },
}
export const ESC_LABEL: Record<EscStep['target'], string> = {
  oncall: 'Дежурные сейчас',
  next: 'Следующий по ротации',
  lead: 'Лид группы',
  manager: 'Руководитель дежурного',
  person: 'Конкретный сотрудник',
  sitcenter: 'Ситуационный центр',
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

export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-16" onMouseDown={onClose}>
      <div className={`popover-in w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} rounded-2xl border border-line bg-surface shadow-card`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 pt-5 pb-1">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} aria-label="Закрыть" className="rounded-md px-2 text-xl leading-none text-faint hover:text-ink">×</button>
        </div>
        <div className="px-6 pt-3 pb-6">{children}</div>
      </div>
    </div>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="block">
      <div className="mb-1.5 text-sm font-medium">{label}</div>
      {children}
      {hint && <div className="mt-1.5 text-xs text-muted">{hint}</div>}
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

export interface ChainLevel { level: number; delayMin: number; label: string; people: Person[]; note?: string }

/** Разворачивает правила эскалации календаря в конкретных людей на момент t */
export function resolveChain(c: Calendar, people: Person[], t: number): ChainLevel[] {
  const byId = (id: string) => people.find((p) => p.id === id)
  const onCall = calendarOnCall(c, t).map((e) => byId(e.personId)).filter(Boolean) as Person[]
  let acc = 0
  return c.escalation.map((s, i) => {
    acc += i === 0 ? 0 : s.delayMin
    let ps: Person[] = []
    let note: string | undefined
    if (s.target === 'oncall') ps = onCall
    if (s.target === 'next') {
      const l = c.layers.find((x) => layerOnCall(x, t).length) ?? c.layers[0]
      ps = l ? (nextInRotation(l, t).map(byId).filter(Boolean) as Person[]) : []
      note = l ? `из слоя «${l.name}»` : undefined
    }
    if (s.target === 'lead') ps = [byId(c.leadId)!].filter(Boolean)
    if (s.target === 'manager') {
      const m = new Map<string, Person>()
      onCall.forEach((p) => { const mg = managerOf(people, p.id); if (mg) m.set(mg.id, mg) })
      ps = [...m.values()]
      note = 'руководители текущих дежурных'
    }
    if (s.target === 'person' && s.personId) ps = [byId(s.personId)!].filter(Boolean)
    if (s.target === 'sitcenter') { ps = [byId('u-sc-mgr')!].filter(Boolean); note = 'и звонок в дежурную смену СЦ' }
    return { level: i + 1, delayMin: acc, label: ESC_LABEL[s.target], people: ps, note }
  })
}

export function EscalationChain({ c, people, t, compact }: { c: Calendar; people: Person[]; t: number; compact?: boolean }) {
  const chain = resolveChain(c, people, t)
  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {chain.map((lv, i) => (
          <span key={i} className="inline-flex items-center gap-2">
            {i > 0 && <span className="text-faint">→</span>}
            <span title={lv.label}>
              {lv.people.length ? lv.people.map((p) => p.name.split(' ')[0]).join(', ') : '—'}
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
              {lv.people.length ? lv.people.map((p) => <PersonPill key={p.id} p={p} />) : <span className="text-sm text-danger">Никого — дыра в покрытии</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function PersonPill({ p, extra }: { p: Person; extra?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm" title={`${p.telegram} · ${p.phone}`}>
      <Avatar p={p} size={22} />
      <span>{p.name}</span>
      <span className="text-muted">{p.phone}</span>
      {extra}
    </span>
  )
}
