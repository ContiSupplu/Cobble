/**
 * Basic Video Editor for Loom Launcher
 *
 * Features:
 * - Trim video without re-encoding (stream copy)
 * - Concatenate multiple videos
 * - Add text overlay with drawtext filter
 * - Change playback speed with setpts + atempo
 * - Generate thumbnail from video frame
 * - Progress events for all operations
 *
 * Requires FFmpeg — use recording.ts downloadFFmpeg() first.
 */
import { join } from 'path'
import { existsSync, writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { ChildProcess, spawn } from 'child_process'
import { EventEmitter } from 'events'
import { getFFmpegPath, getFFprobePath } from './recording'

// ============================================================
// Types
// ============================================================

export interface TextOverlayOptions {
  x: number | string    // Pixel position or expression like '(w-text_w)/2'
  y: number | string
  fontSize: number
  color: string          // Hex color like '#FFFFFF' or named color
  fontFamily?: string
  startTime?: number     // Seconds — when to start showing text
  endTime?: number       // Seconds — when to stop showing text
}

export interface EditProgress {
  percent: number
  currentTime: string
  speed: string
}

// ============================================================
// Event Emitter
// ============================================================

class EditorEvents extends EventEmitter {}

export const editorEvents = new EditorEvents()

// ============================================================
// Helpers
// ============================================================

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

/**
 * Get the duration of a video file in seconds using ffprobe
 */
async function getVideoDuration(videoPath: string): Promise<number> {
  const ffprobePath = getFFprobePath()
  if (!ffprobePath) {
    throw new Error('FFprobe not available. Download FFmpeg first.')
  }

  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      videoPath,
    ]

    const proc = spawn(ffprobePath, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (data) => { stdout += data.toString() })
    proc.stderr?.on('data', (data) => { stderr += data.toString() })

    proc.on('close', (code) => {
      if (code === 0) {
        const duration = parseFloat(stdout.trim())
        resolve(isNaN(duration) ? 0 : duration)
      } else {
        reject(new Error(`ffprobe failed (code ${code}): ${stderr}`))
      }
    })

    proc.on('error', reject)
  })
}

/**
 * Parse ffmpeg progress output and emit events.
 * Parses time= and speed= from stderr.
 */
function attachProgressParser(
  proc: ChildProcess,
  totalDuration: number,
  operationName: string
): void {
  proc.stderr?.on('data', (data: Buffer) => {
    const text = data.toString()

    const timeMatch = text.match(/time=(\d+):(\d+):(\d+)\.(\d+)/)
    const speedMatch = text.match(/speed=\s*([0-9.]+)x/)

    if (timeMatch) {
      const hours = parseInt(timeMatch[1])
      const minutes = parseInt(timeMatch[2])
      const seconds = parseInt(timeMatch[3])
      const ms = parseInt(timeMatch[4])
      const currentSeconds = hours * 3600 + minutes * 60 + seconds + ms / 100

      const percent =
        totalDuration > 0
          ? Math.min(100, Math.round((currentSeconds / totalDuration) * 100))
          : 0

      const progress: EditProgress = {
        percent,
        currentTime: `${timeMatch[1]}:${timeMatch[2]}:${timeMatch[3]}.${timeMatch[4]}`,
        speed: speedMatch ? `${speedMatch[1]}x` : '0x',
      }

      editorEvents.emit('edit-progress', { operation: operationName, ...progress })
    }
  })
}

/**
 * Run an ffmpeg command and return a promise that resolves on exit
 */
function runFFmpeg(
  args: string[],
  totalDuration: number,
  operationName: string
): Promise<void> {
  const ffmpegPath = getFFmpegPath()
  if (!ffmpegPath) {
    return Promise.reject(new Error('FFmpeg not downloaded. Call downloadFFmpeg() first.'))
  }

  return new Promise((resolve, reject) => {
    console.log(`[VideoEditor] ${operationName}: ffmpeg ${args.join(' ')}`)

    const proc = spawn(ffmpegPath, args, { windowsHide: true })
    let stderr = ''

    attachProgressParser(proc, totalDuration, operationName)

    proc.stderr?.on('data', (data) => { stderr += data.toString() })

    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`[VideoEditor] ${operationName} completed successfully`)
        editorEvents.emit('edit-complete', { operation: operationName })
        resolve()
      } else {
        const errMsg = `${operationName} failed (code ${code}): ${stderr.slice(-500)}`
        console.error(`[VideoEditor] ${errMsg}`)
        editorEvents.emit('edit-error', { operation: operationName, error: errMsg })
        reject(new Error(errMsg))
      }
    })

    proc.on('error', (err) => {
      console.error(`[VideoEditor] ${operationName} process error:`, err)
      reject(err)
    })
  })
}

// ============================================================
// Video Operations
// ============================================================

/**
 * Trim a video without re-encoding where possible (stream copy).
 *
 * @param inputPath   Path to source video
 * @param outputPath  Path for output video
 * @param startTime   Start time in seconds
 * @param endTime     End time in seconds
 */
export async function trimVideo(
  inputPath: string,
  outputPath: string,
  startTime: number,
  endTime: number
): Promise<void> {
  if (!existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`)
  }

  const outDir = join(outputPath, '..')
  ensureDir(outDir)

  const duration = endTime - startTime
  if (duration <= 0) {
    throw new Error('End time must be after start time')
  }

  const args = [
    '-ss', startTime.toString(),
    '-i', inputPath,
    '-t', duration.toString(),
    '-c', 'copy',          // Stream copy — no re-encoding
    '-avoid_negative_ts', 'make_zero',
    '-y',
    outputPath,
  ]

  await runFFmpeg(args, duration, 'Trim')
}

/**
 * Concatenate multiple videos into one using the concat demuxer.
 * Videos should have the same codec/resolution for stream copy to work.
 *
 * @param inputPaths  Array of video file paths to concatenate
 * @param outputPath  Path for the concatenated output
 */
export async function concatenateVideos(
  inputPaths: string[],
  outputPath: string
): Promise<void> {
  if (inputPaths.length === 0) {
    throw new Error('No input files provided')
  }

  for (const p of inputPaths) {
    if (!existsSync(p)) {
      throw new Error(`Input file not found: ${p}`)
    }
  }

  const outDir = join(outputPath, '..')
  ensureDir(outDir)

  // Create a temporary concat file
  const concatFilePath = join(outDir, `concat_${Date.now()}.txt`)
  const concatContent = inputPaths
    .map((p) => `file '${p.replace(/\\/g, '/')}'`)
    .join('\n')

  writeFileSync(concatFilePath, concatContent, 'utf-8')

  // Estimate total duration
  let totalDuration = 0
  for (const p of inputPaths) {
    try {
      totalDuration += await getVideoDuration(p)
    } catch { /* estimate ~60s if can't determine */ totalDuration += 60 }
  }

  const args = [
    '-f', 'concat',
    '-safe', '0',
    '-i', concatFilePath,
    '-c', 'copy',
    '-y',
    outputPath,
  ]

  try {
    await runFFmpeg(args, totalDuration, 'Concatenate')
  } finally {
    // Clean up concat file
    try { unlinkSync(concatFilePath) } catch { /* ignore */ }
  }
}

/**
 * Add a text overlay to a video using the drawtext filter.
 *
 * @param inputPath   Path to source video
 * @param outputPath  Path for output video
 * @param text        Text to overlay
 * @param options     Position, style, and timing options
 */
export async function addTextOverlay(
  inputPath: string,
  outputPath: string,
  text: string,
  options: TextOverlayOptions
): Promise<void> {
  if (!existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`)
  }

  const outDir = join(outputPath, '..')
  ensureDir(outDir)

  const totalDuration = await getVideoDuration(inputPath)

  // Escape special characters for drawtext filter
  const escapedText = text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "'\\\\\\''")
    .replace(/:/g, '\\:')

  const fontFamily = options.fontFamily || 'Arial'
  const fontColor = options.color.startsWith('#')
    ? options.color
    : options.color

  // Build drawtext filter string
  let filterStr = `drawtext=text='${escapedText}'`
  filterStr += `:x=${options.x}`
  filterStr += `:y=${options.y}`
  filterStr += `:fontsize=${options.fontSize}`
  filterStr += `:fontcolor=${fontColor}`
  filterStr += `:fontfile=''`  // Use default system font
  filterStr += `:font=${fontFamily}`

  // Time-based enable/disable
  if (options.startTime !== undefined && options.endTime !== undefined) {
    filterStr += `:enable='between(t,${options.startTime},${options.endTime})'`
  } else if (options.startTime !== undefined) {
    filterStr += `:enable='gte(t,${options.startTime})'`
  } else if (options.endTime !== undefined) {
    filterStr += `:enable='lte(t,${options.endTime})'`
  }

  const args = [
    '-i', inputPath,
    '-vf', filterStr,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-c:a', 'copy',
    '-y',
    outputPath,
  ]

  await runFFmpeg(args, totalDuration, 'TextOverlay')
}

/**
 * Change playback speed of a video.
 * Uses setpts for video and atempo for audio.
 *
 * @param inputPath    Path to source video
 * @param outputPath   Path for output video
 * @param speedFactor  Speed multiplier (0.5 = half speed, 2.0 = double speed)
 */
export async function changeSpeed(
  inputPath: string,
  outputPath: string,
  speedFactor: number
): Promise<void> {
  if (!existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`)
  }

  if (speedFactor <= 0 || speedFactor > 100) {
    throw new Error('Speed factor must be between 0 and 100')
  }

  const outDir = join(outputPath, '..')
  ensureDir(outDir)

  const totalDuration = await getVideoDuration(inputPath)
  const estimatedDuration = totalDuration / speedFactor

  // Video: setpts=PTS/speedFactor (e.g., PTS/2.0 for 2x speed)
  const videoPts = `setpts=PTS/${speedFactor}`

  // Audio: atempo only supports 0.5 to 100.0 range
  // For extreme speeds, chain multiple atempo filters
  const audioFilters = buildAtempoChain(speedFactor)

  const args = [
    '-i', inputPath,
    '-filter:v', videoPts,
    '-filter:a', audioFilters,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-y',
    outputPath,
  ]

  await runFFmpeg(args, estimatedDuration, 'ChangeSpeed')
}

/**
 * Build an atempo filter chain for audio speed changes.
 * atempo only supports values between 0.5 and 100.0, so we chain
 * multiple filters for extreme values.
 */
function buildAtempoChain(speedFactor: number): string {
  const filters: string[] = []
  let remaining = speedFactor

  // atempo range is 0.5 to 100.0
  while (remaining > 100.0) {
    filters.push('atempo=100.0')
    remaining /= 100.0
  }

  while (remaining < 0.5) {
    filters.push('atempo=0.5')
    remaining /= 0.5
  }

  filters.push(`atempo=${remaining}`)
  return filters.join(',')
}

/**
 * Generate a thumbnail (PNG image) from a video at a specific time.
 *
 * @param videoPath   Path to the source video
 * @param outputPath  Path for the output PNG
 * @param atTime      Time in seconds to capture (default: 1 second in)
 */
export async function generateThumbnail(
  videoPath: string,
  outputPath: string,
  atTime: number = 1
): Promise<void> {
  if (!existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`)
  }

  const outDir = join(outputPath, '..')
  ensureDir(outDir)

  const args = [
    '-ss', atTime.toString(),
    '-i', videoPath,
    '-vframes', '1',
    '-q:v', '2',
    '-y',
    outputPath,
  ]

  await runFFmpeg(args, 0, 'Thumbnail')
}
