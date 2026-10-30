import { DatasetToggle } from '../DatasetToggle'
import { Card, Legend } from '../ui'

const rows: [string, string, string][] = [
  ['On-Call Schedule', 'Календарь', 'Продукт, владелец и лид группы.'],
  ['Layers', 'Слои', 'Несколько ротаций. Режим приоритета — как в OneUptime, режим «параллельно» — своё.'],
  ['Rotation', 'Ротация', 'Смена от суток до нескольких недель. Шаблоны заполняют мастер за один клик.'],
  ['Hand-off / Starts at', 'Передача смены', 'Дата старта и время handoff.'],
  ['Restriction times', 'Часы', 'Только рабочие часы, ночь или выходные.'],
  ['Ordered users', 'Очередь', 'Порядок и число людей одновременно в слое.'],
  ['Overrides', 'Подмены', 'Самозапись и подмена коллеги поверх ротации, в том числе с таймлайна команды.'],
  ['Final schedule', 'Итог', 'Кому реально придёт алерт. На таймлайнах цвет полосы — человек, штриховка — подмена.'],
  ['Escalation rules', 'Эскалация', 'Задержка, повтор, подтверждение останавливает цепочку.'],
  ['Next in rotation', 'Следующий', 'Отдельный уровень эскалации.'],
  ['Notifications', 'Уведомления', 'Telegram-бот, в демо — журнал сообщений.'],
]

export function About() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">О демо</h1>
        <p className="mt-1 max-w-xl text-sm text-muted">Только фронтенд. Данные в localStorage. Вход и Telegram — имитация. Светлая и тёмная тема запоминаются в браузере.</p>
      </header>
      <Card className="p-5">
        <DatasetToggle />
        <p className="mt-2 max-w-xl text-sm text-muted">Большой набор — 300 команд, ~1500 сотрудников из 25 подразделений, сгенерирован детерминированно. Нужен, чтобы проверить поиск, избранное и фильтры на масштабе банка.</p>
      </Card>
      <Card className="p-5">
        <h3 className="mb-3 font-medium">Опора на OneUptime</h3>
        <table className="w-full text-sm">
          <tbody>{rows.map((r) => <tr key={r[0]} className="border-t border-line align-top"><td className="py-2 pr-4 font-mono text-xs text-faint">{r[0]}</td><td className="py-2 pr-4 font-medium">{r[1]}</td><td className="py-2 text-muted">{r[2]}</td></tr>)}</tbody>
        </table>
      </Card>
      <Card className="p-5 text-sm">
        <h3 className="mb-2 font-medium">Что добавлено для банка</h3>
        <ul className="space-y-1.5 text-muted">
          <li>Лид группы и руководитель дежурного из оргструктуры.</li>
          <li>Несколько человек в слое и параллельные слои.</li>
          <li>Таймлайн команды: день, неделя, две недели, месяц. Пересечения и дыры в покрытии видны сразу.</li>
          <li>Дежурство создаётся протягиванием по своей строке, подмена — перетаскиванием чужой смены.</li>
        </ul>
      </Card>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">Цвета типов</summary>
        <div className="mt-3"><Legend /></div>
      </details>
    </div>
  )
}
