/** Избранные календари — отдельно для каждого пользователя, в localStorage. */
import { useCallback, useEffect, useState } from 'react'

export const favKey = (userId: string) => `oncall-demo-fav-${userId}`

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

export function loadFavorites(userId: string, storage: Storage = localStorage): string[] {
  try {
    const v = JSON.parse(storage.getItem(favKey(userId)) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function toggleFavorite(userId: string, calendarId: string, storage: Storage = localStorage): string[] {
  const cur = loadFavorites(userId, storage)
  const next = cur.includes(calendarId) ? cur.filter((x) => x !== calendarId) : [...cur, calendarId]
  try { storage.setItem(favKey(userId), JSON.stringify(next)) } catch { /* ignore */ }
  return next
}

const EVT = 'oncall-fav-change'

/** Избранное текущего пользователя. Все компоненты видят изменения сразу. */
export function useFavorites(userId: string | null) {
  const [list, setList] = useState<string[]>(() => (userId ? loadFavorites(userId) : []))
  useEffect(() => {
    if (!userId) return
    setList(loadFavorites(userId))
    const h = () => setList(loadFavorites(userId))
    window.addEventListener(EVT, h)
    window.addEventListener('storage', h)
    return () => { window.removeEventListener(EVT, h); window.removeEventListener('storage', h) }
  }, [userId])
  const toggle = useCallback((calendarId: string) => {
    if (!userId) return
    setList(toggleFavorite(userId, calendarId))
    window.dispatchEvent(new Event(EVT))
  }, [userId])
  return { favorites: list, isFav: (id: string) => list.includes(id), toggle }
}
