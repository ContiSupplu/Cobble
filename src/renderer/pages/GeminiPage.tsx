import { useState, useRef, useEffect, useCallback } from 'react'
import { useCustomization } from '../context/CustomizationContext'
import { useAuth } from '../context/AuthContext'
import { usePebble } from '../context/PebbleContext'
import './GeminiPage.css'

const api = (window as any).electronAPI

/* ── Types ── */
interface ChatMessage { role: 'user' | 'model'; text: string }
interface ChatSummary { id: string; title: string; updatedAt: number; messages: ChatMessage[] }

/* ── Markdown-lite renderer ── */
function renderFormattedText(raw: string): React.ReactNode[] {
  const lines = raw.split('\n')
  const elements: React.ReactNode[] = []
  let i = 0, key = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trimStart().startsWith('```')) {
      const lang = line.trimStart().slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) { codeLines.push(lines[i]); i++ }
      i++
      elements.push(<div className="gem-code-block" key={key++}>{lang && <span className="gem-code-lang">{lang}</span>}<pre><code>{codeLines.join('\n')}</code></pre></div>)
      continue
    }
    if (line.trim() === '') { elements.push(<div className="gem-spacer" key={key++} />); i++; continue }
    elements.push(<p className="gem-p" key={key++}>{renderInline(line)}</p>)
    i++
  }
  return elements
}
function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const regex = /(\*\*(.+?)\*\*)|(`([^`]+?)`)/g
  let lastIndex = 0, match: RegExpExecArray | null, key = 0
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    if (match[1]) parts.push(<strong key={key++}>{match[2]}</strong>)
    else if (match[3]) parts.push(<code className="gem-inline-code" key={key++}>{match[4]}</code>)
    lastIndex = regex.lastIndex
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}

/* ── Pebble Logo ── */
function PebbleLogo({ size = 32, className = '' }: { size?: number; className?: string }) {
  const id = `pbl-${size}-${Math.random().toString(36).slice(2, 6)}`
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 28 28" fill="none">
      <path d="M14 0C14 7.732 7.732 14 0 14c7.732 0 14 6.268 14 14 0-7.732 6.268-14 14-14-7.732 0-14-6.268-14-14z" fill={`url(#${id})`} />
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4285F4" /><stop offset="0.33" stopColor="#9B72CB" /><stop offset="0.66" stopColor="#D96570" /><stop offset="1" stopColor="#D96570" />
        </linearGradient>
      </defs>
    </svg>
  )
}

/* ── Screen-aware detection ── */
const SCREEN_KW = ['looking at', 'on my screen', 'what is this', 'what am i', 'see on screen', 'this page', 'what page', "what's this", 'current screen']
function isScreenQ(t: string) { return SCREEN_KW.some(k => t.toLowerCase().includes(k)) }

/* ── Main Component ── */
export default function GeminiPage() {
  const { settings } = useCustomization()
  const { user } = useAuth()
  const pebble = usePebble()
  const hasKey = !!settings.geminiApiKey

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const [chatList, setChatList] = useState<ChatSummary[]>([])
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const messagesRef = useRef<ChatMessage[]>([])
  const activeChatRef = useRef<string | null>(null)

  useEffect(() => { messagesRef.current = messages }, [messages])
  useEffect(() => { activeChatRef.current = activeChatId }, [activeChatId])

  // Tell PebbleContext we're on the Gemini page
  useEffect(() => {
    pebble.setOnGeminiPage(true)
    return () => { pebble.setOnGeminiPage(false) }
  }, [])

  // Sync messages to PebbleContext so the island can show them
  useEffect(() => {
    if (pebble.isOnTheGo) {
      pebble.setLastMessages(messages)
      pebble.setActiveChatId(activeChatId)
    }
  }, [messages, activeChatId, pebble.isOnTheGo])

  // If island sent a message while we were away, sync it back
  useEffect(() => {
    if (pebble.isOnTheGo && pebble.lastMessages.length > messages.length) {
      setMessages(pebble.lastMessages)
      if (pebble.activeChatId && pebble.activeChatId !== activeChatId) {
        setActiveChatId(pebble.activeChatId)
      }
    }
  }, [pebble.lastMessages])

  const hasMessages = messages.length > 0
  const firstName = user?.displayName?.split(' ')[0] || user?.username || 'there'

  useEffect(() => { loadChatList() }, [])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 150) + 'px'
    }
  }, [input])

  // ── Chat History ──
  const loadChatList = async () => { setChatList((await api.chatList()) || []) }
  const createNewChat = async () => {
    const chat = await api.chatCreate()
    setActiveChatId(chat.id); setMessages([]); setInput('')
    await loadChatList()
  }
  const loadExistingChat = async (id: string) => {
    const chat = await api.chatLoad(id)
    if (chat) { setActiveChatId(chat.id); setMessages(chat.messages || []) }
  }
  const deleteExistingChat = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    await api.chatDelete(id)
    if (activeChatId === id) { setActiveChatId(null); setMessages([]) }
    await loadChatList()
  }

  // ── Send ──
  const sendMessage = useCallback(async (text?: string) => {
    const msg = (text || input).trim()
    if (!msg || loading) return

    let chatId = activeChatRef.current
    if (!chatId) {
      const chat = await api.chatCreate()
      chatId = chat.id; setActiveChatId(chat.id)
      await loadChatList()
    }

    const userMsg: ChatMessage = { role: 'user', text: msg }
    const next = [...messagesRef.current, userMsg]
    setMessages(next); setInput(''); setLoading(true)

    try {
      let response: any
      if (isScreenQ(msg)) {
        const capture = await api.screenCapture()
        if (capture?.image) {
          const history = next.slice(0, -1).map(m => ({ role: m.role, parts: [{ text: m.text }] }))
          response = await api.geminiChatVision(settings.geminiApiKey, msg, capture.image, history)
        } else {
          response = await api.geminiChatWithTools(settings.geminiApiKey, next.map(m => ({ role: m.role, parts: [{ text: m.text }] })))
        }
      } else {
        response = await api.geminiChatWithTools(settings.geminiApiKey, next.map(m => ({ role: m.role, parts: [{ text: m.text }] })))
      }

      const aiText = response?.error ? `Error: ${response.error}` : (response?.text ?? 'No response received.')
      const final = [...next, { role: 'model' as const, text: aiText }]
      setMessages(final)
      if (chatId) { await api.chatSave(chatId, final); await loadChatList() }
      if (response?.actionsPerformed?.length) {
        window.dispatchEvent(new CustomEvent('pebble-action', { detail: response.actionsPerformed }))
      }
    } catch (err: any) {
      const final = [...next, { role: 'model' as const, text: `Failed to reach Pebble: ${err?.message || 'Unknown error'}` }]
      setMessages(final)
      if (chatId) await api.chatSave(chatId, final)
    } finally {
      setLoading(false)
    }
  }, [input, loading, settings.geminiApiKey])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  const toggleOnTheGo = () => {
    pebble.setOnTheGo(!pebble.isOnTheGo)
    if (!pebble.isOnTheGo) {
      // Turning ON — sync current state
      pebble.setLastMessages(messages)
      pebble.setActiveChatId(activeChatId)
    }
  }

  const formatDate = (ts: number) => {
    const d = new Date(ts), now = new Date()
    if (d.toDateString() === now.toDateString()) return 'Today'
    const y = new Date(now); y.setDate(now.getDate() - 1)
    if (d.toDateString() === y.toDateString()) return 'Yesterday'
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  /* ── No API Key ── */
  if (!hasKey) {
    return (
      <div className="gem-page page-enter">
        <div className="gem-empty-center">
          <PebbleLogo size={48} className="gem-logo-pulse" />
          <h2 className="gem-greeting">Set up Pebble</h2>
          <p className="gem-subtitle">Add your Gemini API key in<br /><strong>Settings - Connected Apps - Gemini</strong></p>
          <p className="gem-powered">Powered by Gemini</p>
        </div>
      </div>
    )
  }

  /* ── Chat ── */
  return (
    <div className="gem-page page-enter">
      <div className={`gem-sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
        <div className="gem-sidebar-header">
          <button className="gem-sidebar-new" onClick={createNewChat}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            New chat
          </button>
          <button className="gem-sidebar-toggle" onClick={() => setSidebarOpen(false)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="11 17 6 12 11 7" /><polyline points="18 17 13 12 18 7" /></svg>
          </button>
        </div>
        <div className="gem-sidebar-list">
          {chatList.map(chat => (
            <div key={chat.id} className={`gem-sidebar-item ${chat.id === activeChatId ? 'active' : ''}`} onClick={() => loadExistingChat(chat.id)}>
              <div className="gem-sidebar-item-title">{chat.title}</div>
              <div className="gem-sidebar-item-meta">
                <span>{formatDate(chat.updatedAt)}</span>
                <button className="gem-sidebar-item-delete" onClick={(e) => deleteExistingChat(chat.id, e)}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
            </div>
          ))}
          {chatList.length === 0 && <div className="gem-sidebar-empty">No chats yet</div>}
        </div>
      </div>

      <div className="gem-main">
        {!sidebarOpen && (
          <button className="gem-sidebar-open-btn" onClick={() => setSidebarOpen(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>
        )}

        {hasMessages && (
          <div className="gem-header">
            <div className="gem-header-left">
              <PebbleLogo size={20} />
              <span className="gem-header-title">Pebble</span>
              <span className="gem-header-powered">Powered by Gemini</span>
            </div>
            <div className="gem-header-right">
              <button className={`gem-otg-btn ${pebble.isOnTheGo ? 'active' : ''}`} onClick={toggleOnTheGo}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
                </svg>
                {pebble.isOnTheGo ? 'On the Go' : 'On the Go'}
              </button>
              <button className="gem-clear" onClick={createNewChat}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                New chat
              </button>
            </div>
          </div>
        )}

        <div className="gem-body">
          {!hasMessages && !loading ? (
            <div className="gem-empty-center">
              <div className="gem-glow" />
              <PebbleLogo size={40} className="gem-logo-pulse" />
              <h1 className="gem-greeting">What's next, {firstName}?</h1>
              <p className="gem-powered" style={{ marginTop: 4 }}>Powered by Gemini</p>
              <button className={`gem-otg-btn gem-otg-center ${pebble.isOnTheGo ? 'active' : ''}`} onClick={toggleOnTheGo}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
                </svg>
                {pebble.isOnTheGo ? 'On the Go' : 'On the Go'}
              </button>
              <div className="gem-input-center">
                <div className="gem-input-wrap">
                  <textarea ref={inputRef} className="gem-input" value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown} placeholder="Ask Pebble anything about Minecraft..." rows={1} />
                  <button className={`gem-send ${input.trim() ? 'active' : ''}`} onClick={() => sendMessage()} disabled={!input.trim()}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
                  </button>
                </div>
              </div>
              <div className="gem-chips">
                {['How do I make a brewing stand?', 'Best enchantments for a sword?', 'Help me read a crash log', 'Suggest some fun mods'].map(s => (
                  <button className="gem-chip" key={s} onClick={() => sendMessage(s)}>{s}</button>
                ))}
              </div>
            </div>
          ) : (
            <div className="gem-messages">
              {messages.map((msg, i) => (
                <div className={`gem-msg gem-msg--${msg.role}`} key={i}>
                  {msg.role === 'model' && <div className="gem-msg-avatar"><PebbleLogo size={18} /></div>}
                  <div className="gem-msg-body">{renderFormattedText(msg.text)}</div>
                </div>
              ))}
              {loading && (
                <div className="gem-typing"><div className="gem-typing-avatar"><PebbleLogo size={18} /></div><div className="gem-typing-dots"><span className="gem-dot" /><span className="gem-dot" /><span className="gem-dot" /></div></div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {hasMessages && (
          <div className="gem-bottom">
            <div className="gem-input-wrap">
              <textarea ref={inputRef} className="gem-input" value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown} placeholder="Ask Pebble anything about Minecraft..." rows={1} disabled={loading} />
              <button className={`gem-send ${input.trim() && !loading ? 'active' : ''}`} onClick={() => sendMessage()} disabled={!input.trim() || loading}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
