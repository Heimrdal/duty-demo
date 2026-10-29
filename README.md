# Сервис дежурств — демо-стенд (frontend-only)

Демо централизованного сервиса дежурств для ситуационного центра и дежурной службы мониторинга банка.
Бэкенда нет: данные замоканы и хранятся в localStorage браузера. SSO и Telegram — имитация.

## Как открыть
- Без сервера: двойной клик по `oncall-demo.html` (один самодостаточный файл).
- Dev: `npm install && npm run dev`
- Сборка: `npm run build` → `dist/`, `npm run preview` (порт 4173)
- Один HTML: `npm run build:single` → `oncall-demo.html`
- Smoke-тест (нужен Chrome): `node smoke.mjs [url]`

## Экраны
Вход через корпоративный SSO (мок) · Кто дежурит сейчас · Календари (+создание) · Календарь: таймлайн 1/2/4 недели и месяц, слои, эскалация, взятые дежурства, настройки · Мастер слоя ротации · «Взять дежурство» · Эскалации + симуляция инцидента · Уведомления Telegram (мок) · Сотрудники · О демо / OneUptime.

## Что взято из OneUptime
Schedules → Layers (rotation every N day/week, starts at, hand-off time, restriction times daily/weekly, упорядоченные участники, приоритет слоёв), Overrides, Final schedule, On-Call Duty Policy с Escalation Rules (escalate after N min, repeat policy, ack останавливает), «Next in rotation», один цвет на человека.
Добавлено: роль лида группы, руководитель дежурного из оргструктуры, N человек одновременно в слое, режим «все слои параллельно», самозапись «Взять дежурство», типы календарей/дежурств с цветами.
