/*
 * ブラウザ版のサービスワーカー。
 *
 * 目的は 2 つだけ:
 *   1. 「ホーム画面に追加」の条件を満たす (PWA には SW が要る)
 *   2. 一度開いたあとは電波が無くても起動できる
 *
 * 更新で古い画面が残らないよう、入口 (index.html) は毎回ネットワークを先に見る。
 * ハッシュ付きの assets/ は中身が変わると名前も変わるので、キャッシュを先に見てよい。
 * 文書そのものは扱わない (IndexedDB 側の仕事)。
 */
const VERSION = '__APP_VERSION__'
const CACHE = `wowd-${VERSION}`

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(['./', './manifest.webmanifest']))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // 入口はネットワークを先に。落ちていたらキャッシュ
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((cache) => cache.put('./', copy))
          return res
        })
        .catch(() => caches.match('./'))
    )
    return
  }

  // それ以外 (assets / templates / アイコン) はキャッシュを先に
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy))
          }
          return res
        })
    )
  )
})
