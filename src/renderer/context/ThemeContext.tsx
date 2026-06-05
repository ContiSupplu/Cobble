import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

// ── Theme Definitions ──

export interface ThemeDefinition {
  id: string
  name: string
  description: string
  lockedAccent: string | null  // null = user picks, string = forced accent
  preview: { bg: string; sidebar: string; accent: string }
}

export const THEMES: ThemeDefinition[] = [
  {
    id: 'loom',
    name: 'The Loom Style',
    description: 'Purple & yellow brand theme',
    lockedAccent: '#FFFFFF',
    preview: { bg: '#6A5BE8', sidebar: '#E8E511', accent: '#FFFFFF' },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Classic dark theme',
    lockedAccent: null,
    preview: { bg: '#0d0d0d', sidebar: '#161616', accent: '#0A84FF' },
  },
]

const DEFAULT_THEME = 'loom'

// ── Context ──

interface ThemeContextType {
  activeTheme: string
  theme: ThemeDefinition
  setTheme: (id: string) => void
  themes: ThemeDefinition[]
}

const ThemeContext = createContext<ThemeContextType>({
  activeTheme: DEFAULT_THEME,
  theme: THEMES[0],
  setTheme: () => {},
  themes: THEMES,
})

// ── Provider ──

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [activeTheme, setActiveTheme] = useState<string>(() => {
    // Read from localStorage first (fast), then sync with electron-store
    try {
      const stored = localStorage.getItem('loom_theme')
      if (stored && THEMES.some(t => t.id === stored)) return stored
    } catch { /* ignore */ }
    return DEFAULT_THEME
  })

  // Sync with electron-store on mount
  useEffect(() => {
    const api = (window as any).electronAPI
    api?.getTheme?.().then((stored: string | null) => {
      if (stored && THEMES.some(t => t.id === stored)) {
        setActiveTheme(stored)
      }
    })
  }, [])

  // Apply theme whenever it changes
  useEffect(() => {
    const root = document.documentElement

    // ── Clear ALL inline style overrides before applying the new theme ──
    // This prevents stale accent colors from the previous theme persisting
    root.style.removeProperty('--accent')
    root.style.removeProperty('--accent-hover')
    root.style.removeProperty('--accent-muted')

    // Set the new theme attribute — CSS variables from [data-theme] kick in
    root.dataset.theme = activeTheme

    // Persist to localStorage (instant) and electron-store (durable)
    localStorage.setItem('loom_theme', activeTheme)
    const api = (window as any).electronAPI
    api?.setTheme?.(activeTheme)

    // If the theme has a locked accent, apply it via inline styles
    const themeDef = THEMES.find(t => t.id === activeTheme) || THEMES[0]
    if (themeDef.lockedAccent) {
      root.style.setProperty('--accent', themeDef.lockedAccent)
      const r = parseInt(themeDef.lockedAccent.slice(1, 3), 16)
      const g = parseInt(themeDef.lockedAccent.slice(3, 5), 16)
      const b = parseInt(themeDef.lockedAccent.slice(5, 7), 16)
      root.style.setProperty('--accent-hover', `rgba(${r}, ${g}, ${b}, 0.85)`)
      root.style.setProperty('--accent-muted', `rgba(${r}, ${g}, ${b}, 0.12)`)
    }

    // For non-locked themes, re-apply user's custom accent from customization
    // by dispatching a custom event that CustomizationContext listens for
    window.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme: activeTheme } }))
  }, [activeTheme])

  const setTheme = (id: string) => {
    if (THEMES.some(t => t.id === id)) {
      setActiveTheme(id)
    }
  }

  const theme = THEMES.find(t => t.id === activeTheme) || THEMES[0]

  return (
    <ThemeContext.Provider value={{ activeTheme, theme, setTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
