import { createContext, useContext, useState, useRef, useCallback, useEffect, ReactNode } from 'react'
import { useCustomization } from './CustomizationContext'

const api = (window as any).electronAPI

/* ── Types ── */
interface ChatMessage { role: 'user' | 'model'; text: string }

interface LoomieContextType {
  isOnTheGo: boolean
  setOnTheGo: (val: boolean) => void
  lastMessages: ChatMessage[]
  setLastMessages: (msgs: ChatMessage[]) => void
  activeChatId: string | null
  setActiveChatId: (id: string | null) => void
  sendFromIsland: (text: string) => Promise<void>
  isLoading: boolean
  onGeminiPage: boolean
  setOnGeminiPage: (val: boolean) => void
}

const LoomieContext = createContext<LoomieContextType>({
  isOnTheGo: false,
  setOnTheGo: () => {},
  lastMessages: [],
  setLastMessages: () => {},
  activeChatId: null,
  setActiveChatId: () => {},
  sendFromIsland: async () => {},
  isLoading: false,
  onGeminiPage: false,
  setOnGeminiPage: () => {},
})

/* ── Screen-aware detection ── */
const SCREEN_KW = ['looking at', 'on my screen', 'what is this', 'what am i', 'see on screen', 'this page', 'what page', "what's this", 'current screen']
function isScreenQ(t: string) { return SCREEN_KW.some(k => t.toLowerCase().includes(k)) }

export function LoomieProvider({ children }: { children: ReactNode }) {
  const { settings } = useCustomization()
  const [isOnTheGo, setOnTheGo] = useState(false)
  const [lastMessages, setLastMessages] = useState<ChatMessage[]>([])
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [onGeminiPage, setOnGeminiPage] = useState(false)

  const messagesRef = useRef<ChatMessage[]>([])
  const chatIdRef = useRef<string | null>(null)

  useEffect(() => { messagesRef.current = lastMessages }, [lastMessages])
  useEffect(() => { chatIdRef.current = activeChatId }, [activeChatId])

  const sendFromIsland = useCallback(async (text: string) => {
    if (!text.trim() || isLoading || !settings.geminiApiKey) return

    let chatId = chatIdRef.current
    if (!chatId) {
      const chat = await api.chatCreate()
      chatId = chat.id
      setActiveChatId(chat.id)
    }

    const userMsg: ChatMessage = { role: 'user', text }
    const allMsgs = [...messagesRef.current, userMsg]
    setLastMessages(allMsgs)
    setIsLoading(true)

    try {
      let response: any
      if (isScreenQ(text)) {
        const capture = await api.screenCapture()
        if (capture?.image) {
          const history = allMsgs.slice(0, -1).map(m => ({ role: m.role, parts: [{ text: m.text }] }))
          response = await api.geminiChatVision(settings.geminiApiKey, text, capture.image, history)
        } else {
          response = await api.geminiChatWithTools(settings.geminiApiKey, allMsgs.map(m => ({ role: m.role, parts: [{ text: m.text }] })))
        }
      } else {
        response = await api.geminiChatWithTools(settings.geminiApiKey, allMsgs.map(m => ({ role: m.role, parts: [{ text: m.text }] })))
      }

      const aiText = response?.error ? `Error: ${response.error}` : (response?.text ?? 'No response.')
      const final = [...allMsgs, { role: 'model' as const, text: aiText }]
      setLastMessages(final)
      if (chatId) await api.chatSave(chatId, final)
      // Notify other pages that Loomie performed actions (so they refresh data)
      if (response?.actionsPerformed?.length) {
        window.dispatchEvent(new CustomEvent('loomie-action', { detail: response.actionsPerformed }))
      }
    } catch (err: any) {
      const final = [...allMsgs, { role: 'model' as const, text: `Error: ${err?.message || 'Unknown'}` }]
      setLastMessages(final)
      if (chatId) await api.chatSave(chatId, final)
    } finally {
      setIsLoading(false)
    }
  }, [isLoading, settings.geminiApiKey])

  return (
    <LoomieContext.Provider value={{
      isOnTheGo, setOnTheGo,
      lastMessages, setLastMessages,
      activeChatId, setActiveChatId,
      sendFromIsland, isLoading,
      onGeminiPage, setOnGeminiPage,
    }}>
      {children}
    </LoomieContext.Provider>
  )
}

export function useLoomie() { return useContext(LoomieContext) }
