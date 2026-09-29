/* Daily Value: installable-app support. Loaded only by the GitHub Pages build (tools/build_site.py);
   the claude.ai artifact never includes it, so DV.pwa is absent there. */
(function () {
  'use strict';
  const DV = window.DV;
  const nav = window.navigator;
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
  // iPadOS reports itself as a Mac; touch support tells them apart.
  const ios = /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);

  const P = (DV.pwa = {
    ios,
    android: /Android/i.test(nav.userAgent),
    installed: standalone(),
    canPrompt: false, // the browser offered its own install dialog (Chrome, Edge, Samsung Internet)
    // Show the browser's install dialog. Resolves 'accepted', 'dismissed' or 'unavailable'.
    async prompt() {
      if (!deferred) return 'unavailable';
      const d = deferred;
      deferred = null;
      P.canPrompt = false;
      d.prompt();
      const choice = await d.userChoice.catch(() => ({ outcome: 'dismissed' }));
      DV.emit();
      return choice.outcome;
    },
  });

  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    P.canPrompt = true;
    DV.emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    P.canPrompt = false;
    P.installed = true;
    DV.emit();
  });
  const mq = window.matchMedia('(display-mode: standalone)');
  if (mq.addEventListener)
    mq.addEventListener('change', () => {
      P.installed = standalone();
      DV.emit();
    });

  // Offline support. A new version waits until the person chooses to reload, so nothing changes mid-entry.
  if ('serviceWorker' in nav) {
    const hadController = !!nav.serviceWorker.controller;
    let reloading = false;
    nav.serviceWorker.addEventListener('controllerchange', () => {
      // The first install takes control without a reload; only updates reload the page.
      if (!hadController || reloading) return;
      reloading = true;
      window.location.reload();
    });
    const offer = (worker) =>
      DV.actions.toast('A new version of Daily Value is ready.', { ms: 60000, action: { label: 'Reload', run: () => worker.postMessage('skip-waiting') } });
    window.addEventListener('load', () => {
      nav.serviceWorker
        .register('sw.js')
        .then((reg) => {
          if (reg.waiting && nav.serviceWorker.controller) offer(reg.waiting);
          reg.addEventListener('updatefound', () => {
            const w = reg.installing;
            if (!w) return;
            w.addEventListener('statechange', () => {
              if (w.state === 'installed' && nav.serviceWorker.controller) offer(w);
            });
          });
          // An installed app can stay open for days; look for updates when it comes back to the front.
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') reg.update().catch(() => {});
          });
        })
        .catch(() => {});
    });
  }

  // Once there's a real diary, ask the browser not to clear this site's storage when space runs low.
  let asked = false;
  DV.subscribe(() => {
    if (asked || DV.state.mode !== 'user') return;
    asked = true;
    if (nav.storage && nav.storage.persist) nav.storage.persist().catch(() => {});
  });
})();
