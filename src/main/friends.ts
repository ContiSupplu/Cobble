import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { net } from 'electron'

interface Friend {
  uuid: string
  username: string
  addedAt: number
  note?: string
}

const FRIENDS_PATH = join(app.getPath('userData'), 'friends.json')

function readFriends(): Friend[] {
  try {
    if (existsSync(FRIENDS_PATH)) return JSON.parse(readFileSync(FRIENDS_PATH, 'utf-8'))
  } catch {}
  return []
}

function writeFriends(friends: Friend[]) {
  writeFileSync(FRIENDS_PATH, JSON.stringify(friends, null, 2), 'utf-8')
}

export function getAllFriends(): Friend[] {
  return readFriends()
}

export async function addFriend(username: string): Promise<Friend | { error: string }> {
  // Resolve username to UUID via Mojang API
  try {
    const resp = await net.fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username)}`)
    if (!resp.ok) return { error: 'Player not found' }
    const data = await resp.json()
    const friends = readFriends()
    if (friends.find(f => f.uuid === data.id)) return { error: 'Already added' }
    const friend: Friend = { uuid: data.id, username: data.name, addedAt: Date.now() }
    friends.push(friend)
    writeFriends(friends)
    return friend
  } catch (err: any) {
    return { error: err.message || 'Failed to look up player' }
  }
}

export function removeFriend(uuid: string): boolean {
  const friends = readFriends()
  const filtered = friends.filter(f => f.uuid !== uuid)
  if (filtered.length === friends.length) return false
  writeFriends(filtered)
  return true
}

export function updateFriendNote(uuid: string, note: string): Friend | null {
  const friends = readFriends()
  const friend = friends.find(f => f.uuid === uuid)
  if (!friend) return null
  friend.note = note
  writeFriends(friends)
  return friend
}
