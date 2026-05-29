import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

export interface CustomizationSettings {
  homeBackground: string | null  // file path or URL
  accentColor: string            // hex color
  fontScale: number              // 0.9 - 1.2
  showGreeting: boolean
  geminiApiKey: string | null    // User's Gemini API key
}

const defaults: CustomizationSettings = {
  homeBackground: null,
  accentColor: '#d4915a',
  fontScale: 1.0,
  showGreeting: true,
  geminiApiKey: null,
}

interface CustomizationContextType {
  settings: CustomizationSettings
  update: <K extends keyof CustomizationSettings>(key: K, value: CustomizationSettings[K]) => void
  reset: () => void
}

const CustomizationContext = createContext<CustomizationContextType>({
  settings: defaults,
  update: () => {},
  reset: () => {},
})

export function CustomizationProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<CustomizationSettings>(() => {
    try {
      const stored = localStorage.getItem('customization')
      if (stored) {
        const parsed = JSON.parse(stored)
        // Remove dead keys from old versions
        delete parsed.sidebarPosition
        delete parsed.compactMode
        return { ...defaults, ...parsed }
      }
      return defaults
    } catch {
      return defaults
    }
  })

  useEffect(() => {
    localStorage.setItem('customization', JSON.stringify(settings))
    if (settings.geminiApiKey) {
      ;(window as any).electronAPI?.storeSet('geminiApiKey', settings.geminiApiKey)
    }

    // Apply accent color as CSS custom property
    const root = document.documentElement
    root.style.setProperty('--accent', settings.accentColor)

    // Compute hover (slightly darker)
    const r = parseInt(settings.accentColor.slice(1, 3), 16)
    const g = parseInt(settings.accentColor.slice(3, 5), 16)
    const b = parseInt(settings.accentColor.slice(5, 7), 16)
    root.style.setProperty('--accent-hover', `rgb(${Math.max(0, r - 20)}, ${Math.max(0, g - 20)}, ${Math.max(0, b - 20)})`)
    root.style.setProperty('--accent-muted', `rgba(${r}, ${g}, ${b}, 0.08)`)

    // Font scale
    root.style.setProperty('font-size', `${settings.fontScale * 16}px`)
  }, [settings])

  const update = <K extends keyof CustomizationSettings>(key: K, value: CustomizationSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
    if (key === 'geminiApiKey') {
      ;(window as any).electronAPI?.storeSet('geminiApiKey', value)
    }
  }

  const reset = () => setSettings(defaults)

  return (
    <CustomizationContext.Provider value={{ settings, update, reset }}>
      {children}
    </CustomizationContext.Provider>
  )
}

export function useCustomization() {
  return useContext(CustomizationContext)
}
