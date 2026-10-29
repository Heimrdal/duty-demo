import { useState } from 'react'
import { useStore } from '../store'
import { Avatar } from '../ui'

export function Login() {
  const { state, update } = useStore()
  const [stage, setStage] = useState<'start' | 'idp' | 'redirect'>('start')
  const login = (id: string) => {
    setStage('redirect')
    setTimeout(() => { update((s) => ({ ...s, currentUserId: id })); location.hash = '#/' }, 700)
  }
  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 p-6">
      <div className="w-full max-w-md">
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-100 px-3 py-2 text-center text-xs font-medium text-amber-900">
          ⚠️ ДЕМО-СТЕНД. SSO имитируется, пароли не запрашиваются и никуда не отправляются.
        </div>
        {stage === 'start' && (
          <div className="rounded-2xl bg-white p-8 shadow-2xl">
            <div className="mb-6 text-center">
              <div className="text-5xl">📟</div>
              <h1 className="mt-2 text-2xl font-bold">Сервис дежурств</h1>
              <p className="text-sm text-slate-500">Ситуационный центр · Дежурная служба мониторинга</p>
            </div>
            <button onClick={() => setStage('idp')} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-700 py-3 font-semibold text-white hover:bg-blue-800">
              🔐 Войти через корпоративный SSO
            </button>
            <p className="mt-4 text-center text-xs text-slate-400">Доступ — по учётной записи домена BANK. Роли подтягиваются из AD-групп (в демо — замокано).</p>
          </div>
        )}
        {stage === 'idp' && (
          <div className="rounded-2xl bg-white shadow-2xl">
            <div className="rounded-t-2xl bg-slate-800 px-5 py-3 text-sm text-slate-200">
              <div className="font-mono text-xs text-slate-400">https://sso.bank.example/adfs/ls/ <span className="ml-1 rounded bg-amber-400 px-1 font-sans font-bold text-slate-900">DEMO IdP</span></div>
              <div className="mt-1 font-semibold">Корпоративный вход · выберите демо-пользователя</div>
            </div>
            <div className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto scroll-thin">
              {state.people.map((p) => (
                <button key={p.id} onClick={() => login(p.id)} className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-blue-50">
                  <Avatar p={p} />
                  <div className="flex-1"><div className="text-sm font-medium">{p.name}</div><div className="text-xs text-slate-500">{p.title} · {p.team}</div></div>
                  <span className="text-xs text-slate-400">BANK\{p.telegram.slice(1)}</span>
                </button>
              ))}
            </div>
            <div className="px-5 py-3 text-right"><button onClick={() => setStage('start')} className="text-sm text-slate-500 hover:text-slate-800">← Назад</button></div>
          </div>
        )}
        {stage === 'redirect' && (
          <div className="rounded-2xl bg-white p-10 text-center shadow-2xl">
            <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-blue-200 border-t-blue-700" />
            <div className="text-sm text-slate-600">Получаем SAML-ответ от IdP… (демо)</div>
          </div>
        )}
      </div>
    </div>
  )
}
