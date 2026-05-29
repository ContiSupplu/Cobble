import { NavLink, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import '../styles/sidebar.css'

const api = (window as any).electronAPI

interface SidebarProps {
  onOpenProfiles?: () => void
}

const I = {
  width: 18, height: 18, viewBox: '0 0 24 24',
  fill: 'none', stroke: 'currentColor', strokeWidth: 2,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
}

export default function Sidebar({ onOpenProfiles }: SidebarProps) {
  const { user, incognitoEnabled } = useAuth()
  const navigate = useNavigate()
  const [skinDataUrl, setSkinDataUrl] = useState<string | null>(null)

  // Resolve skin from Mojang on user change
  useEffect(() => {
    if (!user?.uuid || !api?.resolveSkinUrl) return
    setSkinDataUrl(null)
    api.resolveSkinUrl(user.uuid, 28).then((url: string | null) => {
      if (url) setSkinDataUrl(url)
    })
  }, [user?.uuid])

  return (
    <aside className="sidebar">
      <nav className="sidebar-nav">
        <NavLink to="/" end className={({ isActive }) => `sidebar-item${isActive ? ' active' : ''}`} data-tooltip="Library">
          <svg {...I}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
        </NavLink>
        <NavLink to="/browse" className={({ isActive }) => `sidebar-item${isActive ? ' active' : ''}`} data-tooltip="Browse">
          <svg {...I}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
        </NavLink>
        <NavLink to="/players" className={({ isActive }) => `sidebar-item${isActive ? ' active' : ''}`} data-tooltip="Players">
          <svg {...I}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
        </NavLink>
        <NavLink to="/changing-room" className={({ isActive }) => `sidebar-item${isActive ? ' active' : ''}`} data-tooltip="Changing Room">
          <svg {...I}><path d="M20.38 3.46L16 2 12 5.5 8 2 3.62 3.46a2 2 0 00-1.34 2.23l.58 3.47a1 1 0 00.99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 002-2V10h2.15a1 1 0 00.99-.84l.58-3.47a2 2 0 00-1.34-2.23z" /></svg>
        </NavLink>
        <NavLink to="/gemini" className={({ isActive }) => `sidebar-item${isActive ? ' active' : ''}`} data-tooltip="Pebble">
          <svg width="18" height="18" viewBox="0 0 28 28" fill="none">
            <path d="M14 0C14 7.732 7.732 14 0 14c7.732 0 14 6.268 14 14 0-7.732 6.268-14 14-14-7.732 0-14-6.268-14-14z" fill="url(#sidebar-gem)" />
            <defs>
              <linearGradient id="sidebar-gem" x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse">
                <stop stopColor="#4285F4" /><stop offset="0.33" stopColor="#9B72CB" /><stop offset="0.66" stopColor="#D96570" /><stop offset="1" stopColor="#D96570" />
              </linearGradient>
            </defs>
          </svg>
        </NavLink>
      </nav>

      <div className="sidebar-spacer" />

      <div className="sidebar-bottom">
        <NavLink to="/settings" className={({ isActive }) => `sidebar-item${isActive ? ' active' : ''}`} data-tooltip="Settings">
          <svg {...I}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>
        </NavLink>

        {/* Profile avatar -- click for Account page, right-click for profile switcher */}
        <button
          className="sidebar-avatar"
          onClick={() => navigate('/account')}
          onContextMenu={(e) => { e.preventDefault(); onOpenProfiles?.() }}
          data-tooltip={user?.displayName ?? user?.username ?? 'Account'}
        >
          {user ? (
            <img src={skinDataUrl || `https://mc-heads.net/avatar/${user.uuid}/28`} alt={user.username} />
          ) : (
            <div className="sidebar-avatar-placeholder" />
          )}
          {incognitoEnabled && (
            <span className="sidebar-incognito-dot" />
          )}
        </button>
      </div>
    </aside>
  )
}
