import { useMemo, useState } from 'react'
import { fmtDT, fmtDur, readySig } from './engine'
import { ConflictList } from './forms'
import { readiness, readyChecked } from './readiness'
import { peopleById, useStore } from './store'
import { tzLabel } from './tz'
import type { Calendar } from './types'
import { Avatar, Btn, Modal } from './ui'

function Section({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <section data-testid={testId} className="space-y-2">
      <h3 className="text-xs font-medium tracking-wide text-muted uppercase">{title}</h3>
      {children}
    </section>
  )
}

/** «Проверка перед запуском»: участники, старт, дыры, пересечения, эскалация, каналы и открытые вопросы. */
export function ReadinessModal({ c, onClose }: { c: Calendar; onClose: () => void }) {
  const { state, updateCalendar, toast } = useStore()
  const [now] = useState(() => Date.now())
  const tz = c.timezone
  const zl = tzLabel(tz)
  const byId = peopleById(state.people)
  const r = useMemo(() => readiness(c, state.people, state.calendars, state.notify, now, (t) => fmtDT(t, tz)), [c, state.people, state.calendars, state.notify, now, tz])
  const checked = readyChecked(c)
  const confirm = () => {
    updateCalendar(c.id, (cal) => ({ ...cal, readyCheck: { at: new Date().toISOString(), sig: readySig(cal), by: state.currentUserId ?? undefined } }))
    toast(`Готовность календаря «${c.name}» проверена`)
    onClose()
  }
  const launched = Number.isFinite(r.launch) && r.launch <= now
  return (
    <Modal title="Проверка перед запуском" onClose={onClose} wide>
      <div className="-mt-2 mb-6 flex flex-wrap gap-2 text-sm" data-testid="ready-status">
        <span className="rounded-full bg-ok/10 px-3 py-1 text-ok">✓ График сохранён</span>
        {checked
          ? <span className="rounded-full bg-ok/10 px-3 py-1 text-ok">✓ Готовность проверена {fmtDT(c.readyCheck!.at, tz)}</span>
          : <span className="rounded-full bg-surface-2 px-3 py-1 text-muted">Готовность не проверена</span>}
      </div>
      <div className="grid gap-8 md:grid-cols-2">
        <div className="space-y-6">
          <Section title="Старт и участники" testId="ready-start">
            <p className="text-sm">
              {!Number.isFinite(r.launch) ? 'Старта нет: в графике никого.' : launched ? <>Дежурства идут с <span className="font-medium">{fmtDT(r.launch, tz)}</span> {zl}</> : <>Старт: <span className="font-medium">{fmtDT(r.launch, tz)}</span> {zl}. До него — «ещё не запущено», это не дыра.</>}
            </p>
            {r.participants.map((g) => (
              <div key={g.layerId} className="text-sm">
                <div className="text-muted">{g.layerName}</div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">{g.ids.length ? g.ids.map((id) => <span key={id} className="inline-flex items-center gap-1.5"><Avatar p={byId.get(id)} size={20} />{byId.get(id)?.name ?? id}</span>) : <span className="text-danger">никого</span>}</div>
              </div>
            ))}
          </Section>
          <Section title={`Покрытие · 4 недели с ${fmtDT(r.from, tz)}`} testId="ready-holes">
            {!r.holes.length ? <p className="text-sm text-ok">Дыр нет: в каждый час кто-то дежурит.</p> : (
              <ul className="space-y-1 text-sm">
                {r.holes.slice(0, 6).map((h) => <li key={h.start} className="text-danger">Нет дежурного: {fmtDT(h.start, tz)} — {fmtDT(h.end, tz)} ({fmtDur(h.end - h.start)})</li>)}
                {r.holes.length > 6 && <li className="text-xs text-muted">и ещё {r.holes.length - 6}</li>}
              </ul>
            )}
          </Section>
          <Section title="Пересечения" testId="ready-conflicts">
            <ConflictList items={r.conflicts} tz={tz} from={r.from} title="С другими дежурствами тех же людей" />
          </Section>
        </div>
        <div className="space-y-6">
          <Section title="Эскалация: кого уведомим" testId="ready-escalation">
            {!r.chain.length ? <p className="text-sm text-muted">Появится, когда в графике будут дежурные.</p> : (
              <ol className="space-y-2 text-sm">
                {r.chain.map((lv) => (
                  <li key={lv.level} className="flex gap-3">
                    <span className="w-16 shrink-0 text-muted">{lv.level} · {lv.delayMin} мин</span>
                    <span className="min-w-0">
                      <span className="block text-muted">{lv.label}</span>
                      <span className="block">{lv.people.length ? lv.people.map((p) => p.name).join(', ') : lv.already.length ? <span className="text-muted">уже уведомлены выше</span> : <span className="text-danger">некого уведомить</span>}</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Section>
          <Section title="Каналы уведомлений" testId="ready-channels">
            {!r.channels.length ? <p className="text-sm text-muted">Участников пока нет.</p> : (
              <ul className="space-y-1 text-sm">
                {r.channels.map((ch) => (
                  <li key={ch.personId} className="flex flex-wrap justify-between gap-2">
                    <span>{byId.get(ch.personId)?.name ?? ch.personId}</span>
                    <span className={ch.linked ? 'text-muted' : 'text-danger'}>Telegram {ch.telegram} · {ch.linked ? (ch.onEscalation ? 'подключён' : 'эскалации выключены') : 'не подключён'}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Открытые вопросы" testId="ready-issues">
            {!r.issues.length ? <p className="text-sm text-ok">Открытых вопросов нет.</p> : (
              <ul className="list-disc space-y-1 pl-5 text-sm" data-count={r.issues.length}>
                {r.issues.map((x) => <li key={x}>{x}</li>)}
              </ul>
            )}
          </Section>
        </div>
      </div>
      <div className="mt-8 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">Проверка действует, пока не изменится график или эскалация.</p>
        <div className="flex gap-2">
          <Btn variant="ghost" onClick={onClose}>Закрыть</Btn>
          <Btn data-testid="ready-confirm" onClick={confirm}>{r.issues.length ? `Готовность проверена (вопросов: ${r.issues.length})` : 'Готовность проверена'}</Btn>
        </div>
      </div>
    </Modal>
  )
}

/** Строка статуса на вкладке «Слои»: «График сохранён» и «Готовность проверена» — разные вещи. */
export function ReadyStrip({ c, onOpen }: { c: Calendar; onOpen: () => void }) {
  if (!c.layers.length) return null
  const checked = readyChecked(c)
  return (
    <div data-testid="ready-strip" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
      <span className="flex flex-wrap gap-x-3 gap-y-1">
        <span className="text-ok">✓ График сохранён</span>
        {checked ? <span className="text-ok">✓ Готовность проверена {fmtDT(c.readyCheck!.at, c.timezone)}</span> : <span className="text-muted">Готовность не проверена</span>}
      </span>
      <Btn variant={checked ? 'ghost' : 'soft'} data-testid="ready-open" onClick={onOpen}>{checked ? 'Открыть проверку' : 'Проверка перед запуском'}</Btn>
    </div>
  )
}
