import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export type Theme = 'light' | 'dark'
const KEY = 'oncall-theme'

const ThemeCtx = createContext<{ theme: Theme; toggle: () => void }>({ theme: 'light', toggle: () => {} })

function readTheme(): Theme {
  try {
    const s = localStorage.getItem(KEY)
    if (s === 'dark' || s === 'light') return s
  } catch { /* ignore */ }
  return 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readTheme)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    try { localStorage.setItem(KEY, theme) } catch { /* ignore */ }
  }, [theme])
  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  return <ThemeCtx.Provider value={{ theme, toggle }}>{children}</ThemeCtx.Provider>
}

export const useTheme = () => useContext(ThemeCtx)
