import { app } from 'electron'
import { join } from 'path'
import { existsSync, writeFileSync } from 'fs'
import { exec, execSync } from 'child_process'

// ============================================================
// Windows Defender Exclusion
// ============================================================

export async function addDefenderExclusion(): Promise<boolean> {
  if (process.platform !== 'win32') return false

  const mcDataPath = join(app.getPath('userData'), 'minecraft_data')
  const instancesPath = join(app.getPath('userData'), 'instances')

  try {
    // Requires admin — will prompt UAC
    const cmd = `powershell -Command "Start-Process powershell -Verb RunAs -ArgumentList '-Command','Add-MpPreference -ExclusionPath \\\"${mcDataPath}\\\" -ExclusionPath \\\"${instancesPath}\\\"' -Wait"`
    await new Promise<void>((resolve, reject) => {
      exec(cmd, { timeout: 30000 }, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
    console.log('[Perf] Windows Defender exclusion applied:', mcDataPath, instancesPath)
    return true
  } catch (err: any) {
    console.warn('[Perf] Defender exclusion failed (may need admin):', err.message)
    return false
  }
}

// ============================================================
// Power Plan Management
// ============================================================

let savedPowerPlanGuid: string | null = null
const HIGH_PERF_GUID = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c'

export function setHighPerformancePowerPlan(): void {
  if (process.platform !== 'win32') return

  try {
    // Save current power plan
    const output = execSync('powercfg /getactivescheme', { encoding: 'utf8' })
    const match = output.match(/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/)
    if (match) {
      savedPowerPlanGuid = match[1]
    }

    // Switch to High Performance
    execSync(`powercfg /setactive ${HIGH_PERF_GUID}`, { stdio: 'ignore' })
    console.log('[Perf] Power plan set to High Performance')
  } catch (err: any) {
    console.warn('[Perf] Power plan switch failed:', err.message)
  }
}

export function restoreDefaultPowerPlan(): void {
  if (process.platform !== 'win32' || !savedPowerPlanGuid) return

  try {
    execSync(`powercfg /setactive ${savedPowerPlanGuid}`, { stdio: 'ignore' })
    console.log(`[Perf] Power plan restored to ${savedPowerPlanGuid}`)
    savedPowerPlanGuid = null
  } catch (err: any) {
    console.warn('[Perf] Power plan restore failed:', err.message)
  }
}

// ============================================================
// Optimized Game Settings (options.txt)
// ============================================================

const OPTIMIZED_OPTIONS: Record<string, string> = {
  'renderDistance': '12',
  'simulationDistance': '8',
  'maxFps': '0',                  // unlimited
  'enableVsync': 'false',
  'graphicsMode': '1',            // fast
  'ao': 'false',                  // ambient occlusion off
  'renderClouds': '"false"',
  'particles': '1',               // decreased
  'entityShadows': 'false',
  'biomeBlendRadius': '1',
  'guiScale': '3',
  'gamma': '1.0',                 // full bright
  'fov': '0.0',                   // default 70
  'autoJump': 'false',
  'entityDistanceScaling': '1.0',
  'lang': 'en_us',
  'soundCategory_master': '1.0',
  'soundCategory_music': '0.5',
  'mipmapLevels': '4',
  'chatVisibility': '0',
  'reducedDebugInfo': 'false',
}

export function writeOptimizedGameSettings(instancePath: string): void {
  const optionsPath = join(instancePath, 'options.txt')

  // Only write if options.txt doesn't exist (don't overwrite user settings)
  if (existsSync(optionsPath)) {
    console.log('[Perf] options.txt already exists, skipping optimization')
    return
  }

  try {
    const lines = Object.entries(OPTIMIZED_OPTIONS)
      .map(([key, value]) => `${key}:${value}`)
      .join('\n')
    writeFileSync(optionsPath, lines + '\n', 'utf8')
    console.log('[Perf] Optimized options.txt written to', instancePath)
  } catch (err: any) {
    console.warn('[Perf] Failed to write options.txt:', err.message)
  }
}

// ============================================================
// Network Optimization (TCP + DNS)
// ============================================================

/**
 * Apply TCP and DNS optimizations for lower latency gaming.
 * Requires UAC elevation for registry changes.
 * 
 * Tweaks applied:
 * - TcpAckFrequency=1  (disable delayed ACKs — biggest impact)
 * - TcpNoDelay=1       (disable Nagle's algorithm at OS level)
 * - TcpDelAckTicks=0   (reinforces TcpAckFrequency)
 * - NetworkThrottlingIndex=0xFFFFFFFF (removes packet throttling)
 * - SystemResponsiveness=0 (max CPU to foreground)
 * - DNS → Cloudflare 1.1.1.1 (faster initial connections)
 */
export async function applyNetworkOptimizations(): Promise<boolean> {
  if (process.platform !== 'win32') return false

  // PowerShell script to apply all network tweaks
  const script = `
    # --- TCP Tweaks (per-adapter) ---
    $adapters = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -and ($_.InterfaceType -eq 6 -or $_.InterfaceType -eq 71) }
    foreach ($adapter in $adapters) {
      $ip = (Get-NetIPAddress -InterfaceIndex $adapter.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue).IPAddress
      if (-not $ip) { continue }
      $guids = Get-ChildItem 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces'
      foreach ($g in $guids) {
        $dhcpIp = (Get-ItemProperty $g.PSPath -ErrorAction SilentlyContinue).DhcpIPAddress
        $staticIp = (Get-ItemProperty $g.PSPath -ErrorAction SilentlyContinue).IPAddress
        if ($dhcpIp -eq $ip -or $staticIp -contains $ip) {
          Set-ItemProperty -Path $g.PSPath -Name 'TcpNoDelay' -Value 1 -Type DWord -Force
          Set-ItemProperty -Path $g.PSPath -Name 'TcpAckFrequency' -Value 1 -Type DWord -Force
          Set-ItemProperty -Path $g.PSPath -Name 'TcpDelAckTicks' -Value 0 -Type DWord -Force
          Write-Host "TCP tweaks applied to $($adapter.Name)"
        }
      }
    }

    # --- Network Throttling ---
    $mmPath = 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile'
    Set-ItemProperty -Path $mmPath -Name 'NetworkThrottlingIndex' -Value 0xFFFFFFFF -Type DWord -Force
    Set-ItemProperty -Path $mmPath -Name 'SystemResponsiveness' -Value 0 -Type DWord -Force
    Write-Host 'Network throttling disabled'

    # --- DNS (Cloudflare) ---
    $activeAdapters = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' }
    foreach ($a in $activeAdapters) {
      Set-DnsClientServerAddress -InterfaceIndex $a.InterfaceIndex -ServerAddresses ('1.1.1.1','1.0.0.1') -ErrorAction SilentlyContinue
    }
    Clear-DnsClientCache
    Write-Host 'DNS set to Cloudflare 1.1.1.1'
  `.replace(/\n/g, '; ').replace(/;(\s*;)+/g, ';')

  try {
    const cmd = `powershell -Command "Start-Process powershell -Verb RunAs -ArgumentList '-Command','${script.replace(/'/g, "''")}' -Wait"`
    await new Promise<void>((resolve, reject) => {
      exec(cmd, { timeout: 30000 }, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
    console.log('[Perf] Network optimizations applied (TCP + DNS)')
    return true
  } catch (err: any) {
    console.warn('[Perf] Network optimization failed:', err.message)
    return false
  }
}

/**
 * Restore DNS to automatic (DHCP) defaults.
 * TCP registry changes require a reboot to fully revert,
 * so we only restore DNS here.
 */
export async function restoreNetworkSettings(): Promise<boolean> {
  if (process.platform !== 'win32') return false

  try {
    const script = `
      $adapters = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' }
      foreach ($a in $adapters) {
        Set-DnsClientServerAddress -InterfaceIndex $a.InterfaceIndex -ResetServerAddresses -ErrorAction SilentlyContinue
      }
      Clear-DnsClientCache
      Write-Host 'DNS restored to defaults'
    `.replace(/\n/g, '; ').replace(/;(\s*;)+/g, ';')

    const cmd = `powershell -Command "Start-Process powershell -Verb RunAs -ArgumentList '-Command','${script.replace(/'/g, "''")}' -Wait"`
    await new Promise<void>((resolve, reject) => {
      exec(cmd, { timeout: 30000 }, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
    console.log('[Perf] Network settings restored')
    return true
  } catch (err: any) {
    console.warn('[Perf] Network restore failed:', err.message)
    return false
  }
}
