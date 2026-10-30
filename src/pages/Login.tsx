import { useState } from 'react'
import { useStore } from '../store'
import { Avatar } from '../ui'

export function Login() {
  const { state, update } = useStore()
  const [stage, setStage] = useState<'start' | 'idp' | 'redirect'>('start')
  // Кто какой календарь ведёт: лидов легко перепутать по должности, поэтому роль видна прямо в списке.
  const roleOf = (id: string) => {
    const lead = state.calendars.filter((c) => c.leadId === id).map((c) => c.name)
    const owner = state.calendars.filter((c) => c.ownerId === id && c.leadId !== id).map((c) => c.name)
    return [lead.length ? `лид: ${lead.join(', ')}` : '', owner.length ? `владелец: ${owner.join(', ')}` : ''].filter(Boolean).join(' · ')
  }
  const login = (id: string) => {
    setStage('redirect')
    setTimeout(() => { update((s) => ({ ...s, currentUserId: id })); location.hash = '#/' }, 700)
  }
  return (
    <div className="flex min-h-full items-center justify-center bg-canvas px-6 py-16">
      <div className="w-full max-w-md">
        <p className="mb-8 text-center text-sm text-muted">Демо-стенд. Пароль не нужен и никуда не отправляется — SSO только имитация.</p>
        {stage === 'start' && (
          <div className="rounded-2xl border border-line bg-surface px-8 py-10 text-center shadow-card">
            <h1 className="text-2xl font-semibold">Дежурства</h1>
            <p className="mt-2 text-sm text-muted">Ситуационный центр и мониторинг</p>
            <button onClick={() => setStage('idp')} className="mt-8 w-full rounded-lg bg-accent py-2.5 text-sm font-medium text-white hover:bg-accent-2">
              Войти через корпоративный SSO
            </button>
          </div>
        )}
        {stage === 'idp' && (
          <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
            <div className="border-b border-line px-5 py-4">
              <div className="text-xs text-faint">sso.bank.example · демо</div>
              <div className="mt-1 text-sm font-medium">Выберите пользователя</div>
            </div>
            <div className="max-h-[60vh] overflow-y-auto scroll-thin">
              {state.people.map((p) => (
                <button key={p.id} onClick={() => login(p.id)} className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-surface-2">
                  <Avatar p={p} />
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{p.name}</div><div className="truncate text-xs text-muted">{p.title}</div></div>
                  {roleOf(p.id) && <span data-testid="login-role" className="max-w-[45%] shrink-0 truncate rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent" title={roleOf(p.id)}>{roleOf(p.id)}</span>}
                </button>
              ))}
            </div>
            <div className="px-5 py-3 text-right"><button onClick={() => setStage('start')} className="text-sm text-muted hover:text-ink">Назад</button></div>
          </div>
        )}
        {stage === 'redirect' && (
          <div className="rounded-2xl border border-line bg-surface px-8 py-12 text-center shadow-card">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent" />
            <div className="text-sm text-muted">Входим…</div>
          </div>
        )}
      </div>
    </div>
  )
}
