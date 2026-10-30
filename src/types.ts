export type CalendarType = 'sitcenter' | 'monitoring' | 'product' | 'infra'
export type LayerKind = 'primary' | 'secondary' | 'business' | 'night' | 'shadow'
export type RotationUnit = 'day' | 'week'
export type RestrictionType = 'none' | 'daily' | 'weekly'

export interface Person {
  id: string
  name: string
  title: string
  /** Подразделение по оргструктуре. Не меняется при работе с дежурствами. */
  orgUnit: string
  /** Дежурные команды, в которых участвует сотрудник. Их может быть несколько. */
  teams: string[]
  managerId?: string
  phone: string
  telegram: string
  email: string
}

export interface Restriction {
  type: RestrictionType
  from: string // HH:MM
  to: string // HH:MM
  days: number[] // 0=Пн..6=Вс (для weekly)
}

export interface Layer {
  id: string
  name: string
  kind: LayerKind
  startsAt: string // ISO дата начала ротации (дата), время = handoffTime
  handoffTime: string // HH:MM
  rotation: { unit: RotationUnit; count: number }
  participants: string[]
  parallel: number // сколько человек дежурят одновременно в этом слое
  restriction: Restriction
}

export interface Shift {
  id: string
  personId: string
  start: string
  end: string
  replacesPersonId?: string
  note?: string
  createdAt: string
}

export type EscTarget = 'oncall' | 'next' | 'lead' | 'manager' | 'person' | 'sitcenter'
export interface EscStep {
  id: string
  target: EscTarget
  personId?: string
  delayMin: number
}

export interface Calendar {
  id: string
  name: string
  product: string
  description: string
  type: CalendarType
  team: string
  ownerId: string
  leadId: string
  /** IANA-зона календаря: в ней считаются передачи смен, часы слоёв и дни недели. */
  timezone: string
  layerMode: 'parallel' | 'priority'
  layers: Layer[]
  shifts: Shift[]
  escalation: EscStep[]
  repeat: number
}

export interface NotifySettings {
  telegram: string
  chatLinked: boolean
  onShiftStart: boolean
  beforeShift: 'off' | '1h' | '1d'
  onHandover: boolean
  onEscalation: boolean
  quietHours: boolean
}

export type TgKind = 'shift_start' | 'reminder' | 'handover' | 'escalation' | 'test' | 'signup'
export interface TgMessage {
  id: string
  ts: string
  toPersonId: string
  kind: TgKind
  text: string
  calendarId?: string
  incidentId?: string
}

export interface State {
  version: number
  currentUserId: string | null
  people: Person[]
  calendars: Calendar[]
  notify: Record<string, NotifySettings>
  messages: TgMessage[]
}
