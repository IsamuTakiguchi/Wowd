import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { useDocumentStore } from './store/document'
import './styles.css'

// E2E テストからファイルを読み込ませるための入口。
// preload 経由の API しか公開していないので、ここが無いとテストが実ファイルを開けない。
;(window as unknown as { __wowdStore: unknown }).__wowdStore = useDocumentStore

const container = document.getElementById('root')
if (!container) throw new Error('#root が見つかりません')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
