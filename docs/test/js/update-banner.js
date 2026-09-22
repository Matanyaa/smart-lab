import { APP_VERSION } from './firebase-init.js?v=0.4.1-t12';

document.getElementById('versionBadge').textContent = `v${APP_VERSION}`;

async function checkForUpdate(){
  try{
    // APP_VERSION now lives in firebase-init.js (see Step 1's modularization)
    // rather than inline in index.html, so that's what gets polled instead.
    // Deliberately the bare, unversioned URL -- this is asking the server
    // "what's actually live right now", not loading a specific version.
    const res = await fetch('./js/firebase-init.js', {cache:'no-store'});
    const html = await res.text();
    const match = html.match(/const APP_VERSION\s*=\s*'([^']+)'/);
    if(!match) return;
    const remoteVersion = match[1];
    if(remoteVersion === APP_VERSION) return;
    document.getElementById('updateBanner').style.display = 'flex';
  }catch(e){ /* offline or not yet deployed — ignore */ }
}
// A first attempt at this (force-refetching index.html and every module
// script with cache:'reload' before calling location.reload()) was tested
// live and found NOT to work -- module content stayed stale even though
// the fetches returned 200. Real fix: every module file is now loaded
// through a ?v=<version> URL (index.html's <script src> tags, and each
// module's own internal cross-imports -- see firebase-init.js's note),
// the same cache-busting already proven to work for icon.svg. That makes
// module staleness impossible by construction, but index.html itself is
// still served from its bare (unversioned) URL, so a plain reload could
// still return a cached copy of the OLD index.html within GitHub Pages'
// cache window -- navigating to a throwaway-querystring variant of the
// same URL forces a genuinely new top-level fetch instead.
document.getElementById('reloadBtn').addEventListener('click', () => {
  location.href = location.pathname + '?_r=' + Date.now();
});
document.getElementById('dismissBtn').addEventListener('click', ()=>{
  document.getElementById('updateBanner').style.display = 'none';
});
checkForUpdate();
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'visible') checkForUpdate();
});
