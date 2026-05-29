import { useState, useEffect, useRef, useCallback } from 'react'
import '../styles/logs-window.css'

interface LogEntry {
  id: number
  text: string
  type: 'normal' | 'error' | 'warn' | 'info'
}

interface LaunchStatus {
  running?: boolean
  progress?: number
  task?: string
  error?: string
}

interface GameLogsWindowProps {
  externalOpen?: boolean
  onClose?: () => void
}

export default function GameLogsWindow({ externalOpen, onClose }: GameLogsWindowProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const userClosedRef = useRef(false)
  const prevExternalOpen = useRef(false)
  const wasRunningRef = useRef(false)

  // Sync with external open signal — only trigger on rising edge
  useEffect(() => {
    if (externalOpen && !prevExternalOpen.current) {
      setIsOpen(true)
      userClosedRef.current = false
    }
    prevExternalOpen.current = !!externalOpen
  }, [externalOpen])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [currentTask, setCurrentTask] = useState('')
  const [progress, setProgress] = useState(0)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)

  const contentRef = useRef<HTMLDivElement>(null)
  const logIdRef = useRef(0)

  // ── Classify log line ──
  const classifyLog = useCallback((message: string): LogEntry['type'] => {
    const lower = message.toLowerCase()
    if (
      lower.includes('error') ||
      lower.includes('exception') ||
      lower.includes('fatal') ||
      lower.includes('crash')
    )
      return 'error'
    if (lower.includes('warn')) return 'warn'
    if (
      lower.includes('[info]') ||
      lower.includes('/info') ||
      lower.includes('info:') ||
      lower.includes('loading') ||
      lower.includes('loaded') ||
      lower.includes('starting')
    )
      return 'info'
    return 'normal'
  }, [])

  // ── Scroll handling ──
  const scrollToBottom = useCallback(() => {
    const el = contentRef.current
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      setAutoScroll(true)
      setShowScrollBtn(false)
    }
  }, [])

  const handleScroll = useCallback(() => {
    const el = contentRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const isNearBottom = distFromBottom < 60
    setAutoScroll(isNearBottom)
    setShowScrollBtn(!isNearBottom && logs.length > 0)
  }, [logs.length])

  // ── Auto-scroll on new logs ──
  useEffect(() => {
    if (autoScroll && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  // ── IPC listeners ──
  useEffect(() => {
    const removeStatusListener = window.electronAPI?.onLaunchStatus?.(
      (status: LaunchStatus) => {
        if (status.running === true && !wasRunningRef.current) {
          wasRunningRef.current = true
          setIsRunning(true)
          if (!userClosedRef.current) {
            setIsOpen(true)
          }
          setLogs([])
          logIdRef.current = 0
          setAutoScroll(true)
          setShowScrollBtn(false)
        } else if (status.running === false) {
          wasRunningRef.current = false
          setIsRunning(false)
          userClosedRef.current = false
        }

        if (status.task !== undefined) {
          setCurrentTask(status.task)
        }
        if (status.progress !== undefined) {
          setProgress(Math.min(100, Math.max(0, status.progress)))
        }
        if (status.error) {
          logIdRef.current += 1
          setLogs((prev) => {
            const next = [
              ...prev,
              {
                id: logIdRef.current,
                text: `[ERROR] ${status.error}`,
                type: 'error' as const,
              },
            ]
            return next.length > 2000 ? next.slice(-2000) : next
          })
        }
      }
    )

    const removeLogListener = window.electronAPI?.onLaunchLog?.(
      (message: string) => {
        logIdRef.current += 1
        const id = logIdRef.current
        const trimmed = message.trimEnd()
        setLogs((prev) => {
          const next = [
            ...prev,
            { id, text: trimmed, type: classifyLog(trimmed) },
          ]
          return next.length > 2000 ? next.slice(-2000) : next
        })
      }
    )

    return () => {
      if (removeStatusListener) removeStatusListener()
      if (removeLogListener) removeLogListener()
    }
  }, [classifyLog])

  // ── Close panel ──
  const handleClose = useCallback(() => {
    setIsOpen(false)
    userClosedRef.current = true
    onClose?.()
  }, [onClose])

  const handleClear = useCallback(() => {
    setLogs([])
    logIdRef.current = 0
  }, [])

  // ── Error / warn counts ──
  const errorCount = logs.filter((l) => l.type === 'error').length
  const warnCount = logs.filter((l) => l.type === 'warn').length

  return (
    <>
      {/* Backdrop scrim */}
      <div
        className={`logs-backdrop ${isOpen ? 'visible' : ''}`}
        onClick={handleClose}
      />

      {/* Main panel */}
      <div className={`game-logs-overlay ${isOpen ? 'open' : ''}`}>
        {/* ── Header ── */}
        <div className="logs-header">
          <div className="logs-header-left">
            <div className={`logs-status-dot ${isRunning ? 'running' : ''}`} />
            <span className="logs-title">Game Output</span>
          </div>
          <button
            className="logs-close-btn"
            onClick={handleClose}
            aria-label="Close logs"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ── Task / Progress bar ── */}
        <div className="logs-status-bar">
          <span className="logs-task-label">
            {currentTask ? (
              <>
                <span className="task-highlight">›</span> {currentTask}
              </>
            ) : isRunning ? (
              <>
                <span className="task-highlight">›</span> Running…
              </>
            ) : (
              'Idle'
            )}
          </span>
          {progress > 0 && (
            <>
              <div className="logs-progress-track">
                <div
                  className="logs-progress-fill"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="logs-progress-pct">
                {Math.round(progress)}%
              </span>
            </>
          )}
        </div>

        {/* ── Log content ── */}
        <div className="logs-content-wrapper">
          <div
            className="logs-content"
            ref={contentRef}
            onScroll={handleScroll}
          >
            {logs.length === 0 ? (
              <div className="logs-empty-state">
                <div className="logs-empty-icon">
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="4 17 10 11 4 5" />
                    <line x1="12" y1="19" x2="20" y2="19" />
                  </svg>
                </div>
                <span className="logs-empty-title">
                  Waiting for game output
                </span>
                <span className="logs-empty-sub">
                  Launch an instance to see logs here
                  <span className="logs-empty-cursor" />
                </span>
              </div>
            ) : (
              logs.map((log, idx) => (
                <div key={log.id} className={`log-line ${log.type}`}>
                  <span className="log-line-num">{idx + 1}</span>
                  <span className="log-line-text">{log.text}</span>
                </div>
              ))
            )}
          </div>

          {/* ── Scroll to bottom FAB ── */}
          <button
            className={`logs-scroll-fab ${showScrollBtn ? 'visible' : ''}`}
            onClick={scrollToBottom}
            aria-label="Scroll to bottom"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
            New output
          </button>
        </div>

        {/* ── Footer stats ── */}
        <div className="logs-footer">
          <span className="logs-footer-stat">
            <span>{logs.length}</span> lines
            {errorCount > 0 && (
              <>
                {' · '}
                <span style={{ color: 'var(--red)' }}>{errorCount}</span>{' '}
                {errorCount === 1 ? 'error' : 'errors'}
              </>
            )}
            {warnCount > 0 && (
              <>
                {' · '}
                <span style={{ color: 'var(--yellow)' }}>{warnCount}</span>{' '}
                {warnCount === 1 ? 'warning' : 'warnings'}
              </>
            )}
          </span>
          <button className="logs-clear-btn" onClick={handleClear}>
            Clear
          </button>
        </div>
      </div>
    </>
  )
}
