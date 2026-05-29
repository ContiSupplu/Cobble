/* ═══════════════════════════════════════════════════
   Game Overlay — Dynamic Island Logic
   Runs inside the transparent overlay BrowserWindow
   ═══════════════════════════════════════════════════ */

const api = window.overlayAPI

// ── State ──────────────────────────────────────────
let currentState = null    // { spotify, time }
let isExpanded = false
let isLoomieOpen = false
let isPlaying = false
let loomieLoading = false
const loomieMessages = []

// ── DOM refs ───────────────────────────────────────
const island = document.getElementById('island')
const contentIdle = document.getElementById('content-idle')
const contentMusic = document.getElementById('content-music')
const contentMusicExpanded = document.getElementById('content-music-expanded')
const contentTime = document.getElementById('content-time')
const contentLoomie = document.getElementById('content-loomie')
const loomiePanel = document.getElementById('loomie-panel')
const loomieMessagesEl = document.getElementById('loomie-messages')
const loomieInput = document.getElementById('loomie-input')
const playPauseBtn = document.getElementById('play-pause-btn')

// ── State Provider ─────────────────────────────────
api.onState((state) => {
  currentState = state
  updateIsland()
})

// Also update time every second
setInterval(() => {
  if (!currentState) {
    currentState = {}
  }
  currentState.time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  updateIsland()
}, 1000)

// ── Update Island Display ──────────────────────────
function updateIsland() {
  if (!currentState) return

  // Hide all content
  contentIdle.classList.remove('active')
  contentMusic.classList.remove('active')
  contentMusicExpanded.classList.remove('active')
  contentTime.classList.remove('active')
  contentLoomie.classList.remove('active')

  const spotify = currentState.spotify

  if (isLoomieOpen) {
    // Loomie panel is open, show loomie indicator
    contentLoomie.classList.add('active')
    island.className = 'loomie-mode'
    return
  }

  if (spotify && spotify.playing) {
    isPlaying = true
    // Update album art
    const art = document.getElementById('album-art')
    const artGlow = document.getElementById('art-glow')
    const artLg = document.getElementById('album-art-lg')
    const artGlowLg = document.getElementById('art-glow-lg')

    if (spotify.albumArtSmall || spotify.albumArt) {
      const src = spotify.albumArtSmall || spotify.albumArt
      art.src = src
      artGlow.style.backgroundImage = `url(${src})`
      artLg.src = src
      artGlowLg.style.backgroundImage = `url(${src})`
    }

    document.getElementById('track-title').textContent = spotify.title || ''
    document.getElementById('track-artist').textContent = spotify.artist || ''
    document.getElementById('track-title-lg').textContent = spotify.title || ''
    document.getElementById('track-artist-lg').textContent = spotify.artist || ''

    // Progress
    const pct = spotify.duration > 0 ? (spotify.progress / spotify.duration) * 100 : 0
    document.getElementById('progress-fill').style.width = pct + '%'
    document.getElementById('time-current').textContent = formatTime(spotify.progress || 0)
    document.getElementById('time-total').textContent = formatTime(spotify.duration || 0)

    // Update play/pause button
    updatePlayPauseIcon(true)

    if (isExpanded) {
      contentMusicExpanded.classList.add('active')
      island.className = 'music-expanded'
    } else {
      contentMusic.classList.add('active')
      island.className = 'music'
    }
  } else if (spotify && !spotify.playing && spotify.title) {
    isPlaying = false
    // Paused state - show music but paused
    const art = document.getElementById('album-art')
    const artGlow = document.getElementById('art-glow')
    if (spotify.albumArtSmall || spotify.albumArt) {
      const src = spotify.albumArtSmall || spotify.albumArt
      art.src = src
      artGlow.style.backgroundImage = `url(${src})`
    }
    document.getElementById('track-title').textContent = spotify.title || ''
    document.getElementById('track-artist').textContent = spotify.artist || ''

    // Hide eq bars when paused
    document.getElementById('eq').style.display = 'none'

    contentMusic.classList.add('active')
    island.className = 'music'
  } else if (currentState.time) {
    // Show time
    document.getElementById('time-display').textContent = currentState.time
    contentTime.classList.add('active')
    island.className = 'time-display'
  } else {
    contentIdle.classList.add('active')
    island.className = 'idle'
  }

  // Restore eq display when playing
  if (spotify && spotify.playing) {
    document.getElementById('eq').style.display = ''
  }
}

// ── Island Click ───────────────────────────────────
function handleIslandClick() {
  const spotify = currentState?.spotify
  if (spotify && (spotify.playing || spotify.title)) {
    isExpanded = !isExpanded
    if (isExpanded) {
      // Enable mouse interaction for the expanded controls
      api.setInteractive(true)
    } else {
      api.setInteractive(false)
    }
    updateIsland()
  }
}

// ── Spotify Controls ───────────────────────────────
function spotifyControl(action) {
  api.spotifyControl(action)
}

function togglePlayPause() {
  if (isPlaying) {
    api.spotifyControl('pause')
    isPlaying = false
  } else {
    api.spotifyControl('play')
    isPlaying = true
  }
  updatePlayPauseIcon(isPlaying)
}

function updatePlayPauseIcon(playing) {
  if (!playPauseBtn) return
  if (playing) {
    playPauseBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>'
  } else {
    playPauseBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>'
  }
}

// ── Loomie ─────────────────────────────────────────
function openLoomie() {
  isLoomieOpen = true
  loomiePanel.classList.remove('hidden')
  api.setInteractive(true)
  loomieInput.focus()
  updateIsland()
}

function closeLoomie() {
  isLoomieOpen = false
  loomiePanel.classList.add('hidden')
  api.setInteractive(false)
  isExpanded = false
  updateIsland()
}

async function sendLoomie(e) {
  e.preventDefault()
  const text = loomieInput.value.trim()
  if (!text || loomieLoading) return

  loomieInput.value = ''
  addLoomieMessage('user', text)
  loomieLoading = true
  showTypingIndicator()

  try {
    const result = await api.askLoomie(text)
    hideTypingIndicator()
    if (result.error) {
      addLoomieMessage('model', 'Error: ' + result.error)
    } else {
      addLoomieMessage('model', result.text || 'No response')
    }
  } catch (err) {
    hideTypingIndicator()
    addLoomieMessage('model', 'Error: ' + (err.message || 'Failed to reach Loomie'))
  }

  loomieLoading = false
}

function addLoomieMessage(role, text) {
  loomieMessages.push({ role, text })
  renderLoomieMessages()
}

function renderLoomieMessages() {
  const msgs = loomieMessages.slice(-6)  // Show last 6
  loomieMessagesEl.innerHTML = msgs.map(m => {
    const isUser = m.role === 'user'
    return `
      <div class="loomie-msg loomie-msg--${m.role}">
        ${!isUser ? '<div class="msg-avatar"><svg width="12" height="12" viewBox="0 0 28 28" fill="none"><path d="M14 0C14 7.732 7.732 14 0 14c7.732 0 14 6.268 14 14 0-7.732 6.268-14 14-14-7.732 0-14-6.268-14-14z" fill="url(#pbl-grad)"/></svg></div>' : ''}
        <div class="msg-bubble">${escapeHtml(m.text)}</div>
      </div>
    `
  }).join('')
  loomieMessagesEl.scrollTop = loomieMessagesEl.scrollHeight
}

function showTypingIndicator() {
  const indicator = document.createElement('div')
  indicator.id = 'typing-indicator'
  indicator.className = 'loomie-msg loomie-msg--model'
  indicator.innerHTML = `
    <div class="msg-avatar"><svg width="12" height="12" viewBox="0 0 28 28" fill="none"><path d="M14 0C14 7.732 7.732 14 0 14c7.732 0 14 6.268 14 14 0-7.732 6.268-14 14-14-7.732 0-14-6.268-14-14z" fill="url(#pbl-grad)"/></svg></div>
    <div class="loomie-typing"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>
  `
  loomieMessagesEl.appendChild(indicator)
  loomieMessagesEl.scrollTop = loomieMessagesEl.scrollHeight
}

function hideTypingIndicator() {
  const el = document.getElementById('typing-indicator')
  if (el) el.remove()
}

// ── Hotkey: P to toggle Loomie ─────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (isLoomieOpen) closeLoomie()
    else if (isExpanded) {
      isExpanded = false
      api.setInteractive(false)
      updateIsland()
    }
  }
})

// ── Utilities ──────────────────────────────────────
function formatTime(ms) {
  const s = Math.floor(ms / 1000)
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

function escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

// ── Initial state ──────────────────────────────────
updateIsland()
console.log('[GameOverlay] Overlay script loaded')
