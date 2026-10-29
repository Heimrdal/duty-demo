import type { ReactNode } from 'react'
import { PEOPLE } from './data'
import type { Calendar, CalendarType, EscStep, LayerKind, Person } from './types'
import { calendarOnCall, layerOnCall, managerOf, nextInRotation } from './engine'

export const TYPE_META: Record<CalendarType, { label: string; color: string; bg: string; icon: string }> = {
  sitcenter: { label: 'Ситуационный центр', color: '#b91c1c', bg: '#fee2e2', icon: '🛰️' },
  monitoring: { label: 'Мониторинг', color: '#b45309', bg: '#fef3c7', icon: '📈' },
  product: { label: 'Продукт / разработка', color: '#1d4ed8', bg: '#dbeafe', icon: '🧩' },
  infra: { label: 'Инфраструктура', color: '#6d28d9', bg: '#ede9fe', icon: '🖧' },
}
export const KIND_META: Record<LayerKind | 'override', { label: string; color: string; bg: string; pattern?: boolean }> = {
  primary: { label: 'Основной', color: '#047857', bg: '#d1fae5' },
  secondary: { label: 'Резерв', color: '#475569', bg: '#e2e8f0' },
  business: { label: 'Рабочие часы', color: '#0369a1', bg: '#e0f2fe' },
  night: { label: 'Ночь / выходные', color: '#4338ca', bg: '#e0e7ff' },
  shadow: { label: 'Стажёр (shadow)', color: '#a16207', bg: '#fef9c3' },
  override: { label: 'Взял сам / подмена', color: '#be185d', bg: '#fce7f3', pattern: true },
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

export function Avatar({ p, size = 32 }: { p?: Person; size?: number }) {
  if (!p) return null
  return (
    <span title={p.name} className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: personColor(p.id), fontSize: size * 0.38 }}>
      {initials(p.name)}
    </span>
  )
}

export function Badge({ children, color, bg, className = '' }: { children: ReactNode; color: string; bg: string; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${className}`} style={{ color, background: bg }}>{children}</span>
}
export const TypeBadge = ({ t }: { t: CalendarType }) => <Badge color={TYPE_META[t].color} bg={TYPE_META[t].bg}>{TYPE_META[t].icon} {TYPE_META[t].label}</Badge>
export const KindBadge = ({ k }: { k: string }) => {
  const m = KIND_META[k as LayerKind] ?? KIND_META.override
  return <Badge color={m.color} bg={m.bg}>{m.label}</Badge>
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>
}

export function Btn({ children, onClick, variant = 'primary', className = '', type = 'button', disabled, title }: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'ghost' | 'danger' | 'soft'; className?: string; type?: 'button' | 'submit'; disabled?: boolean; title?: string
}) {
  const v = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700',
    soft: 'bg-blue-50 text-blue-700 hover:bg-blue-100',
    ghost: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50',
    danger: 'bg-white text-red-600 border border-red-200 hover:bg-red-50',
  }[variant]
  return <button type={type} title={title} disabled={disabled} onClick={onClick} className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-40 ${v} ${className}`}>{children}</button>
}

export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-12" onMouseDown={onClose}>
      <div className={`w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} rounded-2xl bg-white shadow-xl`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="text-2xl leading-none text-slate-400 hover:text-slate-700">×</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="block">
      <div className="mb-1 block text-sm font-medium text-slate-700">{label}</div>
      {children}
      {hint && <div className="mt-1 block text-xs text-slate-500">{hint}</div>}
    </div>
  )
}
export const inputCls = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100'

export function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="font-medium text-slate-500">Типы календарей:</span>
      {(Object.keys(TYPE_META) as CalendarType[]).map((t) => <TypeBadge key={t} t={t} />)}
      <span className="ml-3 font-medium text-slate-500">Типы дежурств (слои):</span>
      {Object.keys(KIND_META).map((k) => <KindBadge key={k} k={k} />)}
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
      note = 'руководители текущих дежурных (из оргструктуры)'
    }
    if (s.target === 'person' && s.personId) ps = [byId(s.personId)!].filter(Boolean)
    if (s.target === 'sitcenter') { ps = [byId('u-sc-mgr')!].filter(Boolean); note = '+ звонок в дежурную смену СЦ' }
    return { level: i + 1, delayMin: acc, label: ESC_LABEL[s.target], people: ps, note }
  })
}

export function EscalationChain({ c, people, t, compact }: { c: Calendar; people: Person[]; t: number; compact?: boolean }) {
  const chain = resolveChain(c, people, t)
  const colors = ['#16a34a', '#0284c7', '#f59e0b', '#ea580c', '#dc2626', '#7c3aed']
  return (
    <div className={compact ? 'flex flex-wrap items-center gap-1.5' : 'space-y-2'}>
      {chain.map((lv, i) => compact ? (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-slate-300">→</span>}
          <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs" title={lv.label}>
            <b style={{ color: colors[i % colors.length] }}>{lv.level}</b>
            {lv.people.length ? lv.people.map((p) => p.name.split(' ')[0]).join(', ') : '—'}
            <span className="text-slate-400">{lv.delayMin ? `+${lv.delayMin}м` : ''}</span>
          </span>
        </span>
      ) : (
        <div key={i} className="flex items-start gap-3">
          <div className="flex flex-col items-center">
            <span className="flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold text-white" style={{ background: colors[i % colors.length] }}>{lv.level}</span>
            {i < chain.length - 1 && <span className="h-8 w-0.5 bg-slate-200" />}
          </div>
          <div className="flex-1 pb-1">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <b>{lv.label}</b>
              <span className="text-xs text-slate-500">{lv.delayMin === 0 ? 'сразу' : `через ${lv.delayMin} мин без подтверждения`}</span>
              {lv.note && <span className="text-xs text-slate-400">· {lv.note}</span>}
            </div>
            <div className="mt-1 flex flex-wrap gap-2">
              {lv.people.length ? lv.people.map((p) => <PersonPill key={p.id} p={p} />) : <span className="text-xs text-red-500">никого — дыра в покрытии</span>}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function PersonPill({ p, extra }: { p: Person; extra?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white py-0.5 pl-0.5 pr-3 text-sm">
      <Avatar p={p} size={24} />
      <span>{p.name}</span>
      <a href={`tel:${p.phone}`} onClick={(e) => e.preventDefault()} title={`Позвонить ${p.phone} (демо)`} className="text-slate-400 hover:text-green-600">📞</a>
      <span title={`Telegram ${p.telegram}`} className="text-xs text-sky-600">{p.telegram}</span>
      {extra}
    </span>
  )
}
