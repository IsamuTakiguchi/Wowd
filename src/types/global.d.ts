import type { WowdApi } from '../shared/ipc'

declare global {
  interface Window {
    wowd: WowdApi
  }
}

export {}
