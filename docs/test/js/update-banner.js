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
document.getElementById('reloadBtn').addEventListener('click', ()=> location.reload());
document.getElementById('dismissBtn').addEventListener('click', ()=>{
  document.getElementById('updateBanner').style.display = 'none';
});
checkForUpdate();
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'visible') checkForUpdate();
});
