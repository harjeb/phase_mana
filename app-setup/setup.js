'use strict';
const { invoke } = window.__TAURI__.core;
const status = document.querySelector('#status');
const error = document.querySelector('#error');
const progress = document.querySelector('#progress');
const retry = document.querySelector('#retry');
let selected;
async function action(operation) {
  error.textContent = '';
  document.querySelectorAll('button').forEach(b => { b.disabled = true; });
  try { await operation(); }
  catch (e) { error.textContent = String(e); status.textContent = 'Setup failed. Choose another file or retry.'; }
  finally {
    document.querySelectorAll('button').forEach(b => { b.disabled = false; });
    retry.hidden = !selected;
    progress.hidden = true;
  }
}
async function launch(path) {
  if (!path) return;
  selected = path;
  status.textContent = 'Starting local server…';
  // Rust performs navigation only after validating the child readiness message.
  await invoke('start_server', { path });
}
document.querySelector('#choose').onclick = () => action(async () => launch(await invoke('choose_database')));
document.querySelector('#download').onclick = () => action(async () => {
  status.textContent = 'Connecting to MTGJSON…'; progress.hidden = false; progress.removeAttribute('value');
  await launch(await invoke('download_database'));
});
retry.onclick = () => action(() => launch(selected));
(async () => {
  await window.__TAURI__.event.listen('setup-progress', ({ payload }) => {
    status.textContent = payload.message + (payload.received ? ` (${(payload.received / 1048576).toFixed(1)} MiB)` : '');
    if (payload.total) { progress.hidden = false; progress.max = payload.total; progress.value = payload.received; }
  });
  await action(async () => { const saved = await invoke('saved_database'); if (saved) await launch(saved); });
})().catch(e => { error.textContent = String(e); });
