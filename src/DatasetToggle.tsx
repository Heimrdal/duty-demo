import { useStore } from './store'
import type { Dataset } from './types'

const OPTS: [Dataset, string][] = [['small', '6 команд'], ['large', '300 команд']]

/** Переключатель демо-набора. Смена набора сбрасывает локальные изменения. */
export function DatasetToggle({ className = '' }: { className?: string }) {
  const { state, setDataset, toast } = useStore()
  const cur = state.dataset ?? 'small'
  const pick = (d: Dataset) => {
    if (d === cur) return
    if (!window.confirm('Локальные изменения (смены, подмены, настройки календарей) будут сброшены. Переключить демо-набор?')) return
    setDataset(d)
    toast(d === 'large' ? 'Загружен большой набор: 300 команд, ~1500 сотрудников' : 'Загружен исходный набор: 6 команд')
  }
  return (
    <div className={`flex flex-wrap items-center gap-2 text-sm ${className}`}>
      <span id="dataset-label" className="text-muted">Демо-набор:</span>
      <div role="radiogroup" aria-labelledby="dataset-label" className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
        {OPTS.map(([d, label]) => (
          <button key={d} type="button" role="radio" aria-checked={cur === d} data-testid={`dataset-${d}`} onClick={() => pick(d)}
            className={`rounded-md px-3 py-1 text-[13px] ${cur === d ? 'bg-surface font-medium text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
