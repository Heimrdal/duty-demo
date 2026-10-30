import type { Layer } from './types'

export interface FieldError { label: string; message: string }

/** Ошибки формы «Новый календарь». Ключ — поле, label — короткое имя для сводки «Заполните: …». */
export function calendarFormErrors(v: { name: string; teamChoice: string; newTeam: string; leadId: string }) {
  const e: Partial<Record<'name' | 'team' | 'newTeam' | 'lead', FieldError>> = {}
  if (!v.name.trim()) e.name = { label: 'название', message: 'Укажите название календаря' }
  if (!v.teamChoice) e.team = { label: 'команда', message: 'Выберите команду или «Новая команда…»' }
  else if (v.teamChoice === '__new' && !v.newTeam.trim()) e.newTeam = { label: 'название новой команды', message: 'Введите название новой команды' }
  if (!v.leadId) e.lead = { label: 'лид', message: 'Выберите лида группы' }
  return e
}

/** Ошибки шага мастера ротации. */
export function layerStepErrors(step: number, l: Pick<Layer, 'name' | 'participants' | 'rotation' | 'restriction' | 'parallel'> & { startDate: string }) {
  const e: Partial<Record<'name' | 'count' | 'start' | 'participants' | 'days', FieldError>> = {}
  if (step === 0 && !l.name.trim()) e.name = { label: 'название', message: 'Укажите название ротации' }
  if (step === 1) {
    if (!(l.rotation.count >= 1)) e.count = { label: 'длина смены', message: 'Длина смены — минимум 1' }
    if (!l.startDate) e.start = { label: 'дата начала', message: 'Укажите дату начала' }
  }
  if (step === 2 && !l.participants.length) e.participants = { label: 'участники', message: 'Добавьте хотя бы одного участника' }
  if (step === 3) {
    if (l.restriction.type === 'weekly' && !l.restriction.days.length) e.days = { label: 'дни недели', message: 'Отметьте хотя бы один день' }
  }
  return e
}
