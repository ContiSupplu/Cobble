import { NavLink, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import '../styles/sidebar.css'

const api = (window as any).electronAPI

interface SidebarProps {
  onOpenProfiles?: () => void
  onOpenP2P?: () => void
}

const I = {
  width: 18, height: 18, viewBox: '0 0 24 24',
  fill: 'none', stroke: 'currentColor', strokeWidth: 2,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
}

export default function Sidebar({ onOpenProfiles, onOpenP2P }: SidebarProps) {
  const { user, privacyEnabled } = useAuth()
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
        {/* Players tab hidden until we have more users
        <NavLink to="/players" className={({ isActive }) => `sidebar-item${isActive ? ' active' : ''}`} data-tooltip="Players">
          <svg {...I}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
        </NavLink>
        */}
        <NavLink to="/changing-room" className={({ isActive }) => `sidebar-item${isActive ? ' active' : ''}`} data-tooltip="Changing Room">
          <svg {...I}><path d="M20.38 3.46L16 2 12 5.5 8 2 3.62 3.46a2 2 0 00-1.34 2.23l.58 3.47a1 1 0 00.99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 002-2V10h2.15a1 1 0 00.99-.84l.58-3.47a2 2 0 00-1.34-2.23z" /></svg>
        </NavLink>
        <NavLink to="/gemini" className={({ isActive }) => `sidebar-item${isActive ? ' active' : ''}`} data-tooltip="Loomie">
          <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="12" stroke="url(#sidebar-loomie)" strokeWidth="3.5" fill="none" />
            <defs>
              <linearGradient id="sidebar-loomie" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#F59E0B" /><stop offset="0.25" stopColor="#10B981" /><stop offset="0.5" stopColor="#6366F1" /><stop offset="0.75" stopColor="#EC4899" /><stop offset="1" stopColor="#F59E0B" />
              </linearGradient>
            </defs>
          </svg>
        </NavLink>
        <NavLink to="/bedrock" className={({ isActive }) => `sidebar-item${isActive ? ' active' : ''}`} data-tooltip="Bedrock">
          <svg {...I}><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
        </NavLink>
        <NavLink to="/servers" className={({ isActive }) => `sidebar-item${isActive ? ' active' : ''}`} data-tooltip="Quick Servers">
          <svg {...I}><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
        </NavLink>
        <NavLink to="/gallery" className={({ isActive }) => `sidebar-item${isActive ? ' active' : ''}`} data-tooltip="Content">
          <svg {...I}><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
        </NavLink>
        {/* Play with Friends hidden for now
        <button className="sidebar-item" onClick={onOpenP2P} data-tooltip="Play with Friends">
          <svg {...I}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
        </button>
        */}
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
          {privacyEnabled && (
            <span className="sidebar-privacy-dot" title="Privacy Mode" />
          )}
        </button>
      </div>
    </aside>
  )
}
