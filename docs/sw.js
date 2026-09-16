// Minimal no-op service worker: only exists to satisfy Chrome/Android's
// installability check (registered SW + fetch handler required for the
// "Install app" / home-screen prompt). No caching or offline support yet.
self.addEventListener('fetch', () => {});
