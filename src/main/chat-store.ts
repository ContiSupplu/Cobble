/**
 * Chat persistence store — saves Gemini conversations to disk.
 * Each chat is a JSON file in userData/chats/
 */
import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'fs'

const CHATS_DIR = join(app.getPath('userData'), 'chats')

export interface ChatData {
  id: string
  title: string
  messages: Array<{ role: 'user' | 'model'; text: string }>
  createdAt: number
  updatedAt: number
}

function ensureDir(): void {
  if (!existsSync(CHATS_DIR)) mkdirSync(CHATS_DIR, { recursive: true })
}

function chatPath(id: string): string {
  return join(CHATS_DIR, `${id}.json`)
}

/** Create a new empty chat */
export function createChat(): ChatData {
  ensureDir()
  const id = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const chat: ChatData = {
    id,
    title: 'New Chat',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  writeFileSync(chatPath(id), JSON.stringify(chat, null, 2), 'utf8')
  return chat
}

/** Save messages to an existing chat */
export function saveChat(
  id: string,
  messages: Array<{ role: 'user' | 'model'; text: string }>,
  title?: string
): ChatData | null {
  ensureDir()
  const path = chatPath(id)
  if (!existsSync(path)) return null

  const chat: ChatData = JSON.parse(readFileSync(path, 'utf8'))
  chat.messages = messages
  chat.updatedAt = Date.now()

  // Auto-title from first user message if still default
  if (title) {
    chat.title = title
  } else if (chat.title === 'New Chat' && messages.length > 0) {
    const firstUser = messages.find((m) => m.role === 'user')
    if (firstUser) {
      chat.title = firstUser.text.slice(0, 50) + (firstUser.text.length > 50 ? '...' : '')
    }
  }

  writeFileSync(path, JSON.stringify(chat, null, 2), 'utf8')
  return chat
}

/** Load a single chat */
export function loadChat(id: string): ChatData | null {
  const path = chatPath(id)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/** List all chats, sorted by most recent */
export function listChats(): ChatData[] {
  ensureDir()
  const files = readdirSync(CHATS_DIR).filter((f) => f.endsWith('.json'))
  const chats: ChatData[] = []

  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(CHATS_DIR, file), 'utf8'))
      chats.push(data)
    } catch {
      // skip corrupted files
    }
  }

  // Sort newest first
  chats.sort((a, b) => b.updatedAt - a.updatedAt)
  return chats
}

/** Delete a chat */
export function deleteChat(id: string): boolean {
  const path = chatPath(id)
  if (!existsSync(path)) return false
  try {
    unlinkSync(path)
    return true
  } catch {
    return false
  }
}

/** Rename a chat */
export function renameChat(id: string, title: string): ChatData | null {
  const path = chatPath(id)
  if (!existsSync(path)) return null
  try {
    const chat: ChatData = JSON.parse(readFileSync(path, 'utf8'))
    chat.title = title
    chat.updatedAt = Date.now()
    writeFileSync(path, JSON.stringify(chat, null, 2), 'utf8')
    return chat
  } catch {
    return null
  }
}
