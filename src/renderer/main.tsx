import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { useDocumentStore } from './store/document'
import './styles.css'

// E2E テストからファイルを読み込ませるための入口。
// preload 経由の API しか公開していないので、ここが無いとテストが実ファイルを開けない。
;(window as unknown as { __wowdStore: unknown }).__wowdStore = useDocumentStore

// E2E から PDF 出力を直接叩くための入口。
// 保存ダイアログを出さずに出力先を指定できるようにする。
;(window as unknown as { __wowdPrint: unknown }).__wowdPrint = async (
  targetPath: string
): Promise<{ path: string | null; pageCount: number }> => {
  const { getPrintPayload } = await import('./print/exportPdf')
  const payload = getPrintPayload()
  if (!payload) throw new Error('印刷用の文書を組み立てられませんでした')
  return window.wowd.printToPdf({ ...payload, targetPath })
}

const container = document.getElementById('root')
if (!container) throw new Error('#root が見つかりません')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
