import type { ElectronAPI } from '../preload/index'

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

declare module '*.jpg' {
  const src: string
  export default src
}

declare module '*.png' {
  const src: string
  export default src
}

declare module '*.svg' {
  const src: string
  export default src
}
