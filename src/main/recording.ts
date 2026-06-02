/**
 * Recording System for Loom Launcher
 *
 * Features:
 * - FFmpeg binary management (auto-download from BtbN/FFmpeg-Builds)
 * - Screen recording using gdigrab (Windows)
 * - Replay buffer using ffmpeg segment muxer
 * - Gallery management for recordings and screenshots
 */
import { app, net } from 'electron'
import { join, basename, extname } from 'path'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  copyFileSync,
  createWriteStream,
  unlinkSync,
  renameSync,
} from 'fs'
import { ChildProcess, spawn } from 'child_process'
import { pipeline } from 'stream/promises'
import { createReadStream } from 'fs'
import { EventEmitter } from 'events'

// ============================================================
// Types
// ============================================================

export interface RecordingOptions {
  outputPath: string
  width?: number
  height?: number
  fps?: number
}

export interface ReplayBufferOptions {
  durationSeconds: number
  outputDir: string
}

export interface RecordingStatus {
  isRecording: boolean
  isBuffering: boolean
  duration: number
  outputPath: string | null
}

export interface GalleryItem {
  id: string
  filename: string
  path: string
  type: 'video' | 'screenshot'
  size: number
  createdAt: number
  duration?: number
  width?: number
  height?: number
  thumbnail?: string
  tags?: string[]
  notes?: string
}

// ============================================================
// Event Emitter
// ============================================================

class RecordingEvents extends EventEmitter {}

export const recordingEvents = new RecordingEvents()

// ============================================================
// Constants & State
// ============================================================

const FFMPEG_DIR = () => join(app.getPath('userData'), 'ffmpeg')
const GALLERY_DIR = () => join(app.getPath('userData'), 'gallery')
const FFMPEG_DOWNLOAD_URL =
  'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'

let recordingProcess: ChildProcess | null = null
let replayProcess: ChildProcess | null = null
let recordingStartTime: number | null = null
let currentOutputPath: string | null = null
let replayOutputDir: string | null = null
let replayDuration = 30
let isDownloadingFFmpeg = false

// ============================================================
// Helpers
// ============================================================

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function generateId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

function formatTimestamp(): string {
  const now = new Date()
  return (
    now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    '_' +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0')
  )
}

// ============================================================
// FFmpeg Management
// ============================================================

/**
 * Get the path to ffmpeg.exe, or null if not downloaded
 */
export function getFFmpegPath(): string | null {
  const ffmpegExe = join(FFMPEG_DIR(), 'ffmpeg.exe')
  if (existsSync(ffmpegExe)) return ffmpegExe
  return null
}

/**
 * Get the path to ffprobe.exe, or null if not downloaded
 */
export function getFFprobePath(): string | null {
  const ffprobeExe = join(FFMPEG_DIR(), 'ffprobe.exe')
  if (existsSync(ffprobeExe)) return ffprobeExe
  return null
}

/**
 * Download FFmpeg binary to userData/ffmpeg/ on first use.
 * Downloads from BtbN/FFmpeg-Builds GitHub releases for Windows x64.
 * Emits 'ffmpeg-download-progress' events with { percent, downloaded, total }.
 */
export async function downloadFFmpeg(): Promise<string> {
  const ffmpegExe = getFFmpegPath()
  if (ffmpegExe) {
    console.log('[Recording] FFmpeg already downloaded at', ffmpegExe)
    return ffmpegExe
  }

  if (isDownloadingFFmpeg) {
    throw new Error('FFmpeg download already in progress')
  }

  isDownloadingFFmpeg = true
  const dir = FFMPEG_DIR()
  ensureDir(dir)

  const zipPath = join(dir, 'ffmpeg-download.zip')

  try {
    console.log('[Recording] Downloading FFmpeg from BtbN/FFmpeg-Builds...')
    recordingEvents.emit('ffmpeg-download-progress', {
      percent: 0,
      downloaded: 0,
      total: 0,
    })

    // Download the zip
    const response = await net.fetch(FFMPEG_DOWNLOAD_URL)
    if (!response.ok) {
      throw new Error(`FFmpeg download failed: ${response.status}`)
    }

    const totalSize = parseInt(response.headers.get('content-length') || '0', 10)
    let downloadedSize = 0

    const fileStream = createWriteStream(zipPath)
    const reader = response.body?.getReader()

    if (!reader) {
      throw new Error('Failed to get download stream')
    }

    // Stream download with progress
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      fileStream.write(Buffer.from(value))
      downloadedSize += value.byteLength

      const percent = totalSize > 0 ? Math.round((downloadedSize / totalSize) * 100) : 0
      recordingEvents.emit('ffmpeg-download-progress', {
        percent,
        downloaded: downloadedSize,
        total: totalSize,
      })
    }

    fileStream.end()
    await new Promise<void>((resolve, reject) => {
      fileStream.on('finish', resolve)
      fileStream.on('error', reject)
    })

    console.log('[Recording] Download complete, extracting...')
    recordingEvents.emit('ffmpeg-download-progress', {
      percent: 100,
      downloaded: downloadedSize,
      total: totalSize,
    })

    // Extract using PowerShell (built into Windows)
    await extractZip(zipPath, dir)

    // Find the ffmpeg.exe in the extracted directory tree
    const ffmpegPath = findFFmpegInDir(dir)
    if (!ffmpegPath) {
      throw new Error('Could not find ffmpeg.exe in extracted archive')
    }

    // Move ffmpeg.exe and ffprobe.exe to the ffmpeg root dir
    const ffmpegDest = join(dir, 'ffmpeg.exe')
    if (ffmpegPath !== ffmpegDest) {
      copyFileSync(ffmpegPath, ffmpegDest)
    }

    const ffprobeSrc = ffmpegPath.replace('ffmpeg.exe', 'ffprobe.exe')
    if (existsSync(ffprobeSrc)) {
      copyFileSync(ffprobeSrc, join(dir, 'ffprobe.exe'))
    }

    // Clean up zip
    try { unlinkSync(zipPath) } catch { /* ignore */ }

    console.log('[Recording] FFmpeg ready at', ffmpegDest)
    return ffmpegDest
  } catch (err) {
    console.error('[Recording] FFmpeg download failed:', err)
    // Clean up on failure
    try { if (existsSync(zipPath)) unlinkSync(zipPath) } catch { /* ignore */ }
    throw err
  } finally {
    isDownloadingFFmpeg = false
  }
}

/**
 * Extract a zip file using PowerShell Expand-Archive
 */
async function extractZip(zipPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force`,
    ])

    let stderr = ''
    ps.stderr?.on('data', (data) => { stderr += data.toString() })

    ps.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Extraction failed (code ${code}): ${stderr}`))
      }
    })

    ps.on('error', reject)
  })
}

/**
 * Recursively search a directory for ffmpeg.exe
 */
function findFFmpegInDir(dir: string): string | null {
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isFile() && entry.name.toLowerCase() === 'ffmpeg.exe') {
        return fullPath
      }
      if (entry.isDirectory()) {
        const found = findFFmpegInDir(fullPath)
        if (found) return found
      }
    }
  } catch { /* ignore */ }
  return null
}

// ============================================================
// Screen Recording
// ============================================================

/**
 * Start screen recording using ffmpeg with gdigrab.
 */
export async function startRecording(options: RecordingOptions): Promise<void> {
  if (recordingProcess) {
    throw new Error('Recording already in progress')
  }

  const ffmpegPath = getFFmpegPath()
  if (!ffmpegPath) {
    throw new Error('FFmpeg not downloaded. Call downloadFFmpeg() first.')
  }

  const { outputPath, width, height, fps = 30 } = options

  // Ensure output directory exists
  const outDir = join(outputPath, '..')
  ensureDir(outDir)

  const args: string[] = [
    '-f', 'gdigrab',
    '-framerate', fps.toString(),
  ]

  // Resolution (offset_x/offset_y + video_size for region, or full desktop)
  if (width && height) {
    args.push('-video_size', `${width}x${height}`)
  }

  args.push(
    '-i', 'desktop',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-y',
    outputPath
  )

  console.log(`[Recording] Starting: ffmpeg ${args.join(' ')}`)

  recordingProcess = spawn(ffmpegPath, args, {
    windowsHide: true,
  })

  recordingStartTime = Date.now()
  currentOutputPath = outputPath

  recordingProcess.stderr?.on('data', (data: Buffer) => {
    const text = data.toString()
    // Parse ffmpeg progress: frame=  123 fps=30 ...
    const frameMatch = text.match(/frame=\s*(\d+)/)
    const timeMatch = text.match(/time=(\d+:\d+:\d+\.\d+)/)
    if (frameMatch || timeMatch) {
      recordingEvents.emit('recording-progress', {
        frame: frameMatch ? parseInt(frameMatch[1]) : 0,
        time: timeMatch ? timeMatch[1] : '00:00:00.00',
      })
    }
  })

  recordingProcess.on('error', (err) => {
    console.error('[Recording] FFmpeg process error:', err)
    recordingProcess = null
    recordingStartTime = null
    recordingEvents.emit('recording-error', err.message)
  })

  recordingProcess.on('close', (code) => {
    console.log(`[Recording] FFmpeg exited with code ${code}`)
    recordingProcess = null
    recordingStartTime = null
    recordingEvents.emit('recording-stopped', {
      code,
      outputPath: currentOutputPath,
    })
  })

  console.log('[Recording] Recording started')
  recordingEvents.emit('recording-started', { outputPath })
}

/**
 * Stop the current recording gracefully by sending 'q' to ffmpeg stdin
 */
export function stopRecording(): void {
  if (!recordingProcess) {
    console.warn('[Recording] No recording in progress')
    return
  }

  console.log('[Recording] Stopping recording...')
  try {
    // Send 'q' to ffmpeg stdin for graceful stop
    recordingProcess.stdin?.write('q')
  } catch (err) {
    console.error('[Recording] Error sending stop signal:', err)
    // Force kill as fallback
    try { recordingProcess.kill('SIGTERM') } catch { /* ignore */ }
  }
}

// ============================================================
// Replay Buffer
// ============================================================

/**
 * Start a replay buffer that continuously records, keeping the last N seconds.
 * Uses ffmpeg segment muxer to write rolling segments.
 */
export async function startReplayBuffer(
  options: ReplayBufferOptions
): Promise<void> {
  if (replayProcess) {
    throw new Error('Replay buffer already running')
  }

  const ffmpegPath = getFFmpegPath()
  if (!ffmpegPath) {
    throw new Error('FFmpeg not downloaded. Call downloadFFmpeg() first.')
  }

  const { durationSeconds, outputDir } = options
  replayDuration = durationSeconds
  replayOutputDir = outputDir
  ensureDir(outputDir)

  const segmentPattern = join(outputDir, 'replay_segment_%03d.mp4')

  const args: string[] = [
    '-f', 'gdigrab',
    '-framerate', '30',
    '-i', 'desktop',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-f', 'segment',
    '-segment_time', '10',
    '-segment_wrap', Math.ceil(durationSeconds / 10).toString(),
    '-reset_timestamps', '1',
    '-y',
    segmentPattern,
  ]

  console.log(`[Recording] Starting replay buffer (${durationSeconds}s)`)

  replayProcess = spawn(ffmpegPath, args, {
    windowsHide: true,
  })

  replayProcess.stderr?.on('data', (data: Buffer) => {
    // Suppress normal ffmpeg output, only log errors
    const text = data.toString()
    if (text.includes('Error') || text.includes('error')) {
      console.error('[Recording] Replay buffer error:', text.trim())
    }
  })

  replayProcess.on('error', (err) => {
    console.error('[Recording] Replay buffer process error:', err)
    replayProcess = null
    recordingEvents.emit('replay-error', err.message)
  })

  replayProcess.on('close', (code) => {
    console.log(`[Recording] Replay buffer exited with code ${code}`)
    replayProcess = null
    recordingEvents.emit('replay-stopped', { code })
  })

  recordingEvents.emit('replay-started', { durationSeconds, outputDir })
}

/**
 * Save the replay buffer — concatenate the last N seconds of segments
 * into a permanent file.
 */
export async function saveReplayBuffer(): Promise<string | null> {
  if (!replayProcess || !replayOutputDir) {
    console.warn('[Recording] No replay buffer running')
    return null
  }

  const ffmpegPath = getFFmpegPath()
  if (!ffmpegPath) return null

  const galleryDir = GALLERY_DIR()
  ensureDir(galleryDir)

  try {
    // Read available segment files, sorted by modification time (most recent last)
    const segments = readdirSync(replayOutputDir)
      .filter((f) => f.startsWith('replay_segment_') && f.endsWith('.mp4'))
      .map((f) => ({
        name: f,
        path: join(replayOutputDir!, f),
        mtime: statSync(join(replayOutputDir!, f)).mtimeMs,
      }))
      .sort((a, b) => a.mtime - b.mtime)

    if (segments.length === 0) {
      console.warn('[Recording] No replay segments found')
      return null
    }

    // Create a concat file for ffmpeg
    const concatFile = join(replayOutputDir, 'concat_list.txt')
    const concatContent = segments
      .map((s) => `file '${s.path.replace(/\\/g, '/')}'`)
      .join('\n')
    writeFileSync(concatFile, concatContent, 'utf-8')

    // Output path
    const outputFilename = `replay_${formatTimestamp()}.mp4`
    const outputPath = join(galleryDir, outputFilename)

    // Concatenate segments
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpegPath!, [
        '-f', 'concat',
        '-safe', '0',
        '-i', concatFile,
        '-c', 'copy',
        '-y',
        outputPath,
      ], { windowsHide: true })

      proc.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`Concat failed with code ${code}`))
      })
      proc.on('error', reject)
    })

    // Clean up concat file
    try { unlinkSync(concatFile) } catch { /* ignore */ }

    // Save gallery metadata
    const stat = statSync(outputPath)
    const item: GalleryItem = {
      id: generateId(),
      filename: outputFilename,
      path: outputPath,
      type: 'video',
      size: stat.size,
      createdAt: Date.now(),
      duration: replayDuration,
    }
    saveGalleryMetadata(item)

    console.log(`[Recording] Replay saved to ${outputPath}`)
    recordingEvents.emit('replay-saved', { path: outputPath })
    return outputPath
  } catch (err) {
    console.error('[Recording] Failed to save replay buffer:', err)
    return null
  }
}

/**
 * Stop the replay buffer
 */
export function stopReplayBuffer(): void {
  if (!replayProcess) {
    console.warn('[Recording] No replay buffer running')
    return
  }

  console.log('[Recording] Stopping replay buffer...')
  try {
    replayProcess.stdin?.write('q')
  } catch {
    try { replayProcess.kill('SIGTERM') } catch { /* ignore */ }
  }
}

// ============================================================
// Status
// ============================================================

/**
 * Get current recording status
 */
export function getRecordingStatus(): RecordingStatus {
  const isRecording = recordingProcess !== null
  const isBuffering = replayProcess !== null
  const duration = recordingStartTime
    ? Math.floor((Date.now() - recordingStartTime) / 1000)
    : 0

  return {
    isRecording,
    isBuffering,
    duration,
    outputPath: currentOutputPath,
  }
}

// ============================================================
// Gallery
// ============================================================

/**
 * Get all gallery items (recordings and screenshots with metadata)
 */
export function getGalleryItems(): GalleryItem[] {
  const dir = GALLERY_DIR()
  ensureDir(dir)

  const items: GalleryItem[] = []

  try {
    const files = readdirSync(dir)

    for (const file of files) {
      const ext = extname(file).toLowerCase()

      // Skip metadata files and non-media files
      if (ext === '.json') continue
      if (!['.mp4', '.mkv', '.avi', '.webm', '.png', '.jpg', '.jpeg'].includes(ext)) {
        continue
      }

      const filePath = join(dir, file)
      const metaPath = join(dir, `${file}.json`)

      // Load metadata if exists
      if (existsSync(metaPath)) {
        try {
          const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as GalleryItem
          meta.path = filePath // Ensure path is correct
          items.push(meta)
          continue
        } catch { /* fallback to basic info */ }
      }

      // Create basic item from file info
      const stat = statSync(filePath)
      const isVideo = ['.mp4', '.mkv', '.avi', '.webm'].includes(ext)
      let type: string = 'screenshot'
      if (isVideo) {
        if (file.startsWith('replay_')) type = 'replay'
        else type = 'recording'
      }

      items.push({
        id: generateId(),
        filename: file,
        path: filePath,
        type: type as any,
        size: stat.size,
        createdAt: stat.birthtimeMs || stat.mtimeMs,
      })
    }
  } catch (err) {
    console.error('[Recording] Failed to read gallery:', err)
  }

  // Sort by creation date, newest first
  items.sort((a, b) => b.createdAt - a.createdAt)
  return items
}

/**
 * Save metadata JSON alongside a gallery item
 */
export function saveGalleryMetadata(item: GalleryItem): void {
  const dir = GALLERY_DIR()
  ensureDir(dir)

  const metaPath = join(dir, `${item.filename}.json`)
  try {
    writeFileSync(metaPath, JSON.stringify(item, null, 2), 'utf-8')
  } catch (err) {
    console.error('[Recording] Failed to save gallery metadata:', err)
  }
}
