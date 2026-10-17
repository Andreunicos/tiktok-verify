'use strict';
const $ = id => document.getElementById(id);
const CONCURRENCY = 3;

const store = {
  get(k, d) { try { const v = localStorage.getItem('cw.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('cw.' + k, JSON.stringify(v)); } catch { /* sem armazenamento: tudo bem */ } },
};

const items = new Map(); // caminho -> { path, rel, li, st, detail, done }
let running = false;
let outDir = store.get('outDir', '');

// ---------- opções ----------
async function initOptions() {
  const presets = await api.presets();
  const chosen = new Set(store.get('presets', ['16bit-44k']));
  for (const p of presets) {
    const l = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.value = p.id; cb.checked = chosen.has(p.id);
    cb.onchange = () => store.set('presets', selectedPresets());
    l.append(cb, p.label);
    $('presets').appendChild(l);
  }
  const mode = store.get('outmode', 'same');
  document.querySelector(`input[name=outmode][value=${mode}]`).checked = true;
  document.querySelectorAll('input[name=outmode]').forEach(r => r.onchange = () => store.set('outmode', outMode()));
  $('outDir').textContent = outDir;
  $('trash').checked = store.get('trash', false);
  $('trashHint').hidden = !$('trash').checked;
  $('trash').onchange = () => { store.set('trash', $('trash').checked); $('trashHint').hidden = !$('trash').checked; };
}
const selectedPresets = () => [...$('presets').querySelectorAll('input:checked')].map(c => c.value);
const outMode = () => document.querySelector('input[name=outmode]:checked').value;

$('pickOut').onclick = async e => {
  e.preventDefault();
  const d = await api.pickOutDir();
  if (!d) return;
  outDir = d;
  store.set('outDir', d);
  $('outDir').textContent = d;
  document.querySelector('input[name=outmode][value=other]').checked = true;
  store.set('outmode', 'other');
};

// ---------- lista ----------
function add(found) {
  let added = 0;
  for (const f of found) {
    if (items.has(f.path)) continue;
    const li = document.createElement('li');
    const name = document.createElement('span'); name.className = 'name'; name.textContent = f.rel; name.title = f.path;
    const st = document.createElement('span'); st.className = 'st'; st.textContent = 'Na fila';
    const detail = document.createElement('span'); detail.className = 'detail'; detail.hidden = true;
    li.append(name, st, detail);
    $('list').appendChild(li);
    items.set(f.path, { ...f, li, st, detail, done: false });
    added++;
  }
  refreshButtons();
  setSummary(added ? `${added} arquivo(s) adicionado(s), ${items.size} na lista` : (found.length ? 'Esses arquivos já estão na lista' : 'Nenhum áudio encontrado (WAV é ignorado)'));
}

function refreshButtons() {
  const pending = [...items.values()].some(i => !i.done);
  $('go').disabled = running || !pending;
  $('clear').disabled = running || !items.size;
  ['addFiles', 'addFolder', 'pickOut'].forEach(id => $(id).disabled = running);
}
const setSummary = t => { $('summary').textContent = t; };

$('addFiles').onclick = async () => add(await api.pickFiles());
$('addFolder').onclick = async () => add(await api.pickFolder());
$('clear').onclick = () => { items.clear(); $('list').textContent = ''; refreshButtons(); setSummary(''); };

const drop = $('drop');
['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); if (!running) drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
document.addEventListener('drop', async e => {
  if (running || !e.dataTransfer.files.length) return;
  add(await api.expandDropped(e.dataTransfer.files));
});

// ---------- conversão ----------
function setStatus(it, text, cls = '', detail = '', revealPath = '') {
  it.st.className = 'st ' + cls;
  it.st.textContent = text;
  it.detail.hidden = !detail && !revealPath;
  it.detail.textContent = detail;
  if (revealPath) {
    const a = document.createElement('a');
    a.textContent = ' Mostrar na pasta';
    a.onclick = () => api.reveal(revealPath);
    it.detail.appendChild(a);
  }
}

async function runItem(it, presets, opts) {
  setStatus(it, 'Convertendo…');
  const results = [];
  for (let i = 0; i < presets.length; i++) {
    const last = i === presets.length - 1;
    results.push(await api.convert({
      src: it.path, rel: it.rel, outRoot: opts.outRoot, presetId: presets[i], tagged: presets.length > 1,
      // o original só vai para a Lixeira depois da última versão, e se todas foram criadas agora
      trash: opts.trash && last && results.every(r => r.status === 'ok'),
    }));
  }
  const err = results.find(r => r.status === 'error');
  const made = results.filter(r => r.status === 'ok');
  if (err) { setStatus(it, 'Erro', 'err', err.message); return { kind: 'err' }; }
  const outs = results.map(r => r.out.split(/[\\/]/).pop()).join(', ');
  const trashNote = results.some(r => r.trashed) ? ' · original na Lixeira' : results.some(r => r.trashError) ? ' · não consegui mover o original para a Lixeira' : '';
  if (!made.length) { setStatus(it, 'Já existe', 'skip', outs, results[0].out); it.done = true; return { kind: 'skip' }; }
  setStatus(it, 'Pronto', 'ok', outs + trashNote, results[0].out);
  it.done = true;
  return { kind: 'ok' };
}

$('go').onclick = async () => {
  const presets = selectedPresets();
  if (!presets.length) return setSummary('Escolha pelo menos um formato.');
  if (outMode() === 'other' && !outDir) return setSummary('Escolha a pasta de saída.');
  const opts = { outRoot: outMode() === 'other' ? outDir : null, trash: $('trash').checked };
  if (opts.trash && !confirm('Os originais convertidos com sucesso vão para a Lixeira. Continuar?')) return;

  const todo = [...items.values()].filter(i => !i.done);
  running = true; api.setBusy(true); refreshButtons();
  const count = { ok: 0, skip: 0, err: 0 };
  let next = 0, finished = 0;
  const worker = async () => {
    while (next < todo.length) {
      const it = todo[next++];
      const r = await runItem(it, presets, opts);
      count[r.kind]++;
      setSummary(`Convertendo… ${++finished}/${todo.length}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  running = false; api.setBusy(false); refreshButtons();
  setSummary(`Pronto: ${count.ok} convertido(s)` + (count.skip ? `, ${count.skip} já existia(m)` : '') + (count.err ? `, ${count.err} com erro` : ''));
};

// ---------- atualização ----------
function renderUpdate(s) {
  const t = $('upText');
  t.className = 'up-text';
  $('upInstall').hidden = s.state !== 'ready';
  $('upCheck').disabled = ['checking', 'downloading', 'ready'].includes(s.state);
  $('upProgress').hidden = s.state !== 'downloading';
  $('upProgress').firstElementChild.style.width = (s.percent || 0) + '%';
  t.title = '';
  switch (s.state) {
    case 'checking': t.textContent = 'Verificando atualizações…'; break;
    case 'uptodate': t.textContent = 'Você está na versão mais recente.'; t.classList.add('ok'); break;
    case 'downloading': t.textContent = `Baixando a versão ${s.version || ''}… ${s.percent || 0}%`; break;
    case 'ready': t.textContent = `Versão ${s.version} pronta. O app reinicia para instalar.`; t.classList.add('ok'); break;
    case 'dev': t.textContent = 'Modo desenvolvimento: a atualização só funciona no app instalado.'; t.classList.add('warn'); break;
    case 'error': t.textContent = 'Não foi possível verificar agora. Tente de novo.'; t.title = s.message || ''; t.classList.add('err'); break;
    default: t.textContent = '';
  }
}
$('upCheck').onclick = () => api.checkUpdate();
$('upInstall').onclick = () => api.installUpdate();

(async function init() {
  $('ver').textContent = 'v' + await api.version();
  await initOptions();
  api.onUpdate(renderUpdate);
})();
