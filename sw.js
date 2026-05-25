const CACHE_NAME = 'pscamera-pwa-v24-shooting-mode-fix';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

const INJECT_MARKER = 'pscamera-shooting-mode-fix-v24';
const INJECT_SCRIPT = `
<script id="${INJECT_MARKER}">
(() => {
  const FIX_VERSION = 'v1.24-shooting-mode-fix';

  function $(id) {
    return document.getElementById(id);
  }

  function setVersionText() {
    const footerVersion = document.querySelector('.footer span:last-child');
    if (footerVersion) footerVersion.textContent = FIX_VERSION;
  }

  function forceSquareModeForShooting() {
    const body = document.body;
    if (!body || !body.classList.contains('shooting-mode')) return;

    // 表示モードを■にする。shooting-mode クラスは残したまま切り替える。
    body.classList.remove('mode-disk');
    body.classList.add('mode-gift');

    const btnDisk = $('btn-disk');
    const btnGift = $('btn-gift');
    const btnDiskShooting = $('btn-disk-shooting');
    const btnGiftShooting = $('btn-gift-shooting');

    if (btnDisk) btnDisk.classList.remove('active');
    if (btnGift) btnGift.classList.add('active');
    if (btnDiskShooting) btnDiskShooting.classList.remove('active');
    if (btnGiftShooting) btnGiftShooting.classList.add('active');
  }

  function keepShootingModeAfterClear() {
    const body = document.body;
    if (!body) return;

    // 撮影モード中に全削除しても、通常表示に戻さない。
    body.classList.add('shooting-mode');

    const btnShootingMode = $('btn-shooting-mode');
    if (btnShootingMode) btnShootingMode.textContent = '通常表示に戻る';

    forceSquareModeForShooting();
  }

  function bindFixes() {
    const body = document.body;
    const btnShootingMode = $('btn-shooting-mode');
    const btnClearAllShooting = $('btn-clear-all-shooting');

    setVersionText();

    if (btnShootingMode && !btnShootingMode.dataset.shootingFixBound) {
      btnShootingMode.dataset.shootingFixBound = '1';
      btnShootingMode.addEventListener('click', () => {
        // 既存の撮影モード切替処理が終わった直後に、■へ補正する。
        setTimeout(forceSquareModeForShooting, 0);
      });
    }

    if (btnClearAllShooting && !btnClearAllShooting.dataset.shootingFixBound) {
      btnClearAllShooting.dataset.shootingFixBound = '1';
      btnClearAllShooting.addEventListener('click', () => {
        const wasShootingMode = body && body.classList.contains('shooting-mode');
        // 既存の全削除処理・確認ダイアログ後に、撮影モードを維持する。
        setTimeout(() => {
          if (wasShootingMode) keepShootingModeAfterClear();
        }, 0);
      });
    }

    if (body && !body.dataset.shootingFixObserver) {
      body.dataset.shootingFixObserver = '1';
      let lastShootingMode = body.classList.contains('shooting-mode');

      const observer = new MutationObserver(() => {
        const nowShootingMode = body.classList.contains('shooting-mode');
        if (nowShootingMode && !lastShootingMode) {
          forceSquareModeForShooting();
        }
        lastShootingMode = nowShootingMode;
      });

      observer.observe(body, {
        attributes: true,
        attributeFilter: ['class']
      });
    }

    // すでに撮影モードで開いている場合にも対応。
    forceSquareModeForShooting();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindFixes, { once: true });
  } else {
    bindFixes();
  }
})();
</script>`;

function injectIntoHtml(html) {
  if (!html || html.includes(INJECT_MARKER)) return html;

  let nextHtml = html.replace(/v1\.21-image-management/g, 'v1.24-shooting-mode-fix');

  if (nextHtml.includes('</body>')) {
    return nextHtml.replace('</body>', `${INJECT_SCRIPT}\n</body>`);
  }

  return `${nextHtml}\n${INJECT_SCRIPT}`;
}

async function responseWithInjectedHtml(response) {
  const html = await response.text();
  return new Response(injectIntoHtml(html), {
    status: response.status,
    statusText: response.statusText,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache'
    }
  });
}

async function cacheInjectedIndex(response) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const injected = await responseWithInjectedHtml(response.clone());
    await cache.put('./index.html', injected.clone());
  } catch (error) {
    console.log('index.html cache update skipped:', error);
  }
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys
        .filter(key => key !== CACHE_NAME)
        .map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') return;

  // ページ遷移は、通信できれば最新版の index.html に補正コードを注入する。
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .then(async response => {
          const cloned = response.clone();
          cacheInjectedIndex(cloned);
          return responseWithInjectedHtml(response);
        })
        .catch(async () => {
          const cached = await caches.match('./index.html');
          if (cached) return responseWithInjectedHtml(cached);
          throw new Error('No cached index.html');
        })
    );
    return;
  }

  // 画像・manifest・JS/CSSなどはキャッシュ優先。裏で可能なら更新。
  event.respondWith(
    caches.match(request).then(cached => {
      const networkFetch = fetch(request)
        .then(response => {
          if (response && response.status === 200) {
            const responseCopy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, responseCopy));
          }
          return response;
        })
        .catch(() => cached);

      return cached || networkFetch;
    })
  );
});
