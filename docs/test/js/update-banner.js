import { APP_VERSION } from './firebase-init.js';

document.getElementById('versionBadge').textContent = `v${APP_VERSION}`;

async function checkForUpdate(){
  try{
    // APP_VERSION now lives in firebase-init.js (see Step 1's modularization)
    // rather than inline in index.html, so that's what gets polled instead.
    const res = await fetch('./js/firebase-init.js', {cache:'no-store'});
    const html = await res.text();
    const match = html.match(/const APP_VERSION\s*=\s*'([^']+)'/);
    if(!match) return;
    const remoteVersion = match[1];
    if(remoteVersion === APP_VERSION) return;
    document.getElementById('updateBanner').style.display = 'flex';
  }catch(e){ /* offline or not yet deployed — ignore */ }
}
// A plain location.reload() doesn't guarantee bypassing the browser's
// HTTP cache for index.html or the module files it loads (unlike
// icon.svg, none of these are cache-busted with a ?v= query string) --
// within GitHub Pages' 10-minute Cache-Control window, clicking Reload
// could still run the old cached code entirely. Fixed by force-refetching
// index.html and every module script first (cache:'reload' bypasses
// reading the cache but still writes the fresh response into it), so the
// actual reload right after picks up what was just fetched instead of
// whatever was cached before.
document.getElementById('reloadBtn').addEventListener('click', async () => {
  const urls = ['./index.html', ...Array.from(document.querySelectorAll('script[type="module"][src]')).map((s) => s.src)];
  await Promise.all(urls.map((url) => fetch(url, { cache: 'reload' }).catch(() => {})));
  location.reload();
});
document.getElementById('dismissBtn').addEventListener('click', ()=>{
  document.getElementById('updateBanner').style.display = 'none';
});
checkForUpdate();
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'visible') checkForUpdate();
});
