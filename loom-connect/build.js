/**
 * Build script for Loom Connect — creates a distributable folder with:
 *   loom-connect.exe (36MB)
 *   node_datachannel.node (6MB)
 *
 * Total download: ~20MB compressed
 */

const { execSync } = require('child_process')
const { copyFileSync, mkdirSync, existsSync } = require('fs')
const { join } = require('path')

const DIST_DIR = join(__dirname, 'release')
const NATIVE_ADDON = join(__dirname, 'node_modules', 'node-datachannel', 'build', 'Release', 'node_datachannel.node')

console.log('Building Loom Connect...\n')

// 1. Compile TypeScript
console.log('  [1/3] Compiling TypeScript...')
execSync('npx tsc', { stdio: 'inherit' })

// 2. Package with pkg
console.log('  [2/3] Packaging executable...')
execSync('npx pkg dist/index.js -t node18-win-x64 -o release/loom-connect.exe --compress GZip', { stdio: 'inherit' })

// 3. Copy native addon
console.log('  [3/3] Bundling native addon...')
if (!existsSync(DIST_DIR)) mkdirSync(DIST_DIR, { recursive: true })
copyFileSync(NATIVE_ADDON, join(DIST_DIR, 'node_datachannel.node'))

// Done
const exeSize = require('fs').statSync(join(DIST_DIR, 'loom-connect.exe')).size
const addonSize = require('fs').statSync(join(DIST_DIR, 'node_datachannel.node')).size
const totalMB = ((exeSize + addonSize) / 1024 / 1024).toFixed(1)

console.log(`\n  ✓ Build complete!`)
console.log(`    release/loom-connect.exe  (${(exeSize/1024/1024).toFixed(1)} MB)`)
console.log(`    release/node_datachannel.node  (${(addonSize/1024/1024).toFixed(1)} MB)`)
console.log(`    Total: ${totalMB} MB (will be ~${(totalMB * 0.5).toFixed(0)} MB zipped)\n`)
