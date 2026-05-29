// Post-build script: apply icon to Loom.exe via rcedit
// Runs AFTER electron-builder --dir creates the unpacked exe,
// then the NSIS installer is built from the patched exe.

const { execSync } = require('child_process')
const { join } = require('path')
const { existsSync, writeFileSync } = require('fs')

const rcedit = join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache', 'winCodeSign', 'winCodeSign-2.6.0', 'rcedit-x64.exe')
const exe = join(__dirname, 'dist', 'win-unpacked', 'Loom.exe')
const ico = join(__dirname, 'resources', 'icon.ico')
const pkg = require('./package.json')
const ver = pkg.version

if (!existsSync(exe)) {
  console.log('[post-build] No exe found, skipping icon patch')
  process.exit(0)
}

if (!existsSync(rcedit)) {
  console.log('[post-build] rcedit not found, skipping icon patch')
  process.exit(0)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function tryRcedit(attempt) {
  try {
    execSync(
      `"${rcedit}" "${exe}" --set-icon "${ico}" --set-version-string ProductName "Loom" --set-version-string FileDescription "Loom" --set-file-version "${ver}" --set-product-version "${ver}"`,
      { stdio: 'inherit', timeout: 15000 }
    )
    console.log(`[post-build] Icon and version info applied to Loom.exe (v${ver}) on attempt ${attempt}`)
    return true
  } catch (err) {
    console.warn(`[post-build] Attempt ${attempt} failed: ${err.message}`)
    return false
  }
}

async function main() {
  // Generate app-update.yml — electron-updater needs this to find updates
  const appUpdateYml = join(__dirname, 'dist', 'win-unpacked', 'resources', 'app-update.yml')
  const updateConfig = `provider: github\nowner: ContiSupplu\nrepo: Cobble\nupdaterCacheDirName: loom-updater\n`
  writeFileSync(appUpdateYml, updateConfig, 'utf8')
  console.log(`[post-build] Generated app-update.yml`)

  // Try with increasing delays — the exe may be locked by Defender or lingering handles
  const delays = [5000, 8000, 12000, 15000]

  for (let i = 0; i < delays.length; i++) {
    console.log(`[post-build] Waiting ${delays[i] / 1000}s for file handles to release...`)
    await sleep(delays[i])
    if (await tryRcedit(i + 1)) return
  }

  console.warn('[post-build] All attempts failed. The exe will use the default Electron icon.')
  // Don't exit(1) — let the NSIS installer build continue without the custom icon
}

main()
