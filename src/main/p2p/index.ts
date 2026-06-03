/**
 * P2P Multiplayer Module — Barrel export
 *
 * Provides zero-config multiplayer via WebRTC tunneling.
 * Coordinates between:
 *   - The in-game mod (via Dynamic Island WebSocket)
 *   - The signaling server (via external WebSocket)
 *   - The WebRTC tunnel (via simple-peer in renderer)
 *   - The TCP proxy (localhost bridge to Minecraft)
 */

export * from './session'
export * from './lan-detect'
export * from './tcp-proxy'
export * from './signaling-client'
export { registerP2PHandlers } from './ipc-handlers'
