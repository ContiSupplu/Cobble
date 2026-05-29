// afterPack hook: apply icon and version info to the exe
// Runs AFTER packaging but BEFORE the NSIS installer is built,
// so the installer will contain the exe with the correct icon.

const { execSync } = require('child_process')
const { join } = require('path')
const { existsSync } = require('fs')

module.exports = async function afterPack(context) {
  if (process.platform !== 'win32') return

  const rcedit = join(
    process.env.LOCALAPPDATA,
    'electron-builder', 'Cache', 'winCodeSign', 'winCodeSign-2.6.0', 'rcedit-x64.exe'
  )

  const exe = join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`)
  const ico = join(__dirname, 'resources', 'icon.ico')
  const ver = context.packager.appInfo.version

  if (!existsSync(rcedit)) {
    console.log('[afterPack] rcedit not found, skipping icon patch')
    return
  }

  if (!existsSync(exe)) {
    console.log('[afterPack] exe not found, skipping icon patch')
    return
  }

  // Small delay to ensure file handles are released
  await new Promise(resolve => setTimeout(resolve, 1000))

  try {
    execSync(
      `"${rcedit}" "${exe}" --set-icon "${ico}" --set-version-string ProductName "Loom" --set-version-string FileDescription "Loom" --set-file-version "${ver}" --set-product-version "${ver}"`,
      { stdio: 'inherit', timeout: 15000 }
    )
    console.log(`[afterPack] Icon and version info applied to ${exe}`)
  } catch (err) {
    console.warn('[afterPack] rcedit failed, retrying in 3s...')
    await new Promise(resolve => setTimeout(resolve, 3000))
    try {
      execSync(
        `"${rcedit}" "${exe}" --set-icon "${ico}" --set-version-string ProductName "Loom" --set-version-string FileDescription "Loom" --set-file-version "${ver}" --set-product-version "${ver}"`,
        { stdio: 'inherit', timeout: 15000 }
      )
      console.log(`[afterPack] Icon applied on retry`)
    } catch (err2) {
      console.error('[afterPack] Failed to apply icon after retry:', err2.message)
    }
  }
}
