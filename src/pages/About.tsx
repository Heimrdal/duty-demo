import { Card } from '../ui'

const rows: [string, string, string][] = [
  ['On-Call Schedule', 'Календарь дежурств', 'Расписание с именем продукта/функционала, своим владельцем и лидом.'],
  ['Layers', 'Слои', 'В календаре несколько слоёв. В OneUptime верхний перекрывает нижние — у нас есть этот режим «по приоритету» и дополнительный «параллельно» (требование: несколько групп дежурят одновременно).'],
  ['Rotation (Every N Hour/Day/Week)', 'Ротация', 'Длительность смены — от суток до N недель.'],
  ['Hand-off time / Starts at', 'Время передачи смены', 'Начало ротации и время передачи смены (handoff).'],
  ['Restriction Times (Daily / Weekly)', 'Часы дежурства', 'Слой может работать только в рабочие часы, ночью или по выходным.'],
  ['Users in layer (ordered)', 'Очередь участников', 'Порядок очереди; у нас добавлено «N человек одновременно в слое».'],
  ['Overrides', 'Взятые дежурства / подмены', 'Самозапись «Взять дежурство» и подмена коллеги поверх ротации.'],
  ['Final schedule / On-call timeline', 'ИТОГ в таймлайне', 'Итоговая строка показывает, кому реально придёт алерт; у каждого человека один цвет везде.'],
  ['On-Call Duty Policy + Escalation Rules', 'Цепочка эскалации', 'Уровни с задержкой «escalate after N minutes», повтор политики N раз, ack останавливает эскалацию.'],
  ['Next in rotation', 'Следующий по ротации', 'Уровень эскалации «следующий по очереди того же слоя».'],
  ['User notification rules', 'Настройки уведомлений', 'Каналы и события; у нас канал — Telegram-бот (мок).'],
]

export function About() {
  return (
    <div className="space-y-4">
      <div><h1 className="text-2xl font-bold">О демо-стенде</h1><p className="text-sm text-slate-500">Frontend-only: данные замоканы и хранятся в localStorage браузера. SSO и Telegram — имитация.</p></div>
      <Card className="p-4">
        <h3 className="mb-2 font-semibold">Что взято из OneUptime (github.com/OneUptime/oneuptime)</h3>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">OneUptime</th><th>У нас</th><th>Комментарий</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r[0]} className="border-t border-slate-100 align-top"><td className="py-1.5 pr-3 font-mono text-xs">{r[0]}</td><td className="pr-3 font-medium">{r[1]}</td><td className="text-slate-600">{r[2]}</td></tr>)}</tbody>
        </table>
      </Card>
      <Card className="p-4 text-sm">
        <h3 className="mb-2 font-semibold">Что отличается / добавлено под требования банка</h3>
        <ul className="list-disc space-y-1 pl-5 text-slate-700">
          <li>Роль <b>лида группы</b> в каждом календаре + автоматический уровень «руководитель дежурного» из оргструктуры.</li>
          <li>Параллельные дежурства: несколько мест в одном слое и режим «все слои параллельно».</li>
          <li>Кнопка «✋ Взять дежурство» — запись на себя в 2 клика с пресетами (сутки, выходные, неделя, 2 недели).</li>
          <li>Типы календарей (СЦ, мониторинг, продукт, инфраструктура) и типы слоёв с цветами и бейджами.</li>
          <li>Вход только через корпоративный SSO (в демо — выбор пользователя на фейковой странице IdP).</li>
        </ul>
      </Card>
    </div>
  )
}
