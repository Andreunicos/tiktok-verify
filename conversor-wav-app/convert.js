'use strict';
// Lógica de conversão sem dependência do Electron (testável com `npm test`).
const { spawn } = require('child_process');
const fsp = require('fs').promises;
const path = require('path');

let ffmpegPath = require('ffmpeg-static');
if (ffmpegPath) ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');

const AUDIO_EXT = new Set([
  '.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.flac', '.webm', '.mp4', '.mka', '.mov',
  '.aif', '.aiff', '.wma', '.amr', '.ac3', '.mp2', '.3gp', '.caf',
]);

const PRESETS = [
  { id: '16bit-44k',      label: '16-bit · 44.1 kHz',        tag: '16bit-44k',      rate: 44100, bits: 16, mono: false },
  { id: '16bit-48k',      label: '16-bit · 48 kHz',          tag: '16bit-48k',      rate: 48000, bits: 16, mono: false },
  { id: '24bit-48k',      label: '24-bit · 48 kHz',          tag: '24bit-48k',      rate: 48000, bits: 24, mono: false },
  { id: '24bit-96k',      label: '24-bit · 96 kHz',          tag: '24bit-96k',      rate: 96000, bits: 24, mono: false },
  { id: 'float-48k',      label: '32-bit float · 48 kHz',    tag: 'float-48k',      rate: 48000, bits: 32, mono: false },
  { id: 'mono-16bit-44k', label: 'Mono · 16-bit · 44.1 kHz', tag: 'mono-16bit-44k', rate: 44100, bits: 16, mono: true },
  { id: 'mono-16bit-22k', label: 'Mono · 16-bit · 22 kHz',   tag: 'mono-16bit-22k', rate: 22050, bits: 16, mono: true },
];

const isAudio = name => AUDIO_EXT.has(path.extname(name).toLowerCase());

// Aceita arquivos e pastas; pastas são varridas recursivamente (links simbólicos são ignorados).
async function expand(paths) {
  const items = [];
  for (const p of paths) {
    let st;
    try { st = await fsp.stat(p); } catch { continue; }
    if (st.isDirectory()) await walk(p, path.basename(p), items);
    else if (isAudio(p)) items.push({ path: p, rel: path.basename(p), size: st.size });
  }
  return items;
}

async function walk(dir, rel, items) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, path.join(rel, e.name), items);
    else if (e.isFile() && isAudio(e.name)) {
      const st = await fsp.stat(full);
      items.push({ path: full, rel: path.join(rel, e.name), size: st.size });
    }
  }
}

function runFfmpeg(src, dest, p) {
  const codec = p.bits === 16 ? 'pcm_s16le' : p.bits === 24 ? 'pcm_s24le' : 'pcm_f32le';
  const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-map', '0:a:0', '-vn', '-ar', String(p.rate)];
  if (p.mono) args.push('-ac', '1');
  args.push('-c:a', codec, '-f', 'wav', dest); // cabeçalho WAV clássico, o mais compatível

  return new Promise((resolve, reject) => {
    const cp = spawn(ffmpegPath, args, { windowsHide: true });
    let err = '';
    cp.stderr.on('data', d => { err = (err + d).slice(-4000); });
    cp.on('error', reject);
    cp.on('close', code => {
      if (code === 0) return resolve();
      if (/matches no streams/i.test(err)) return reject(new Error('o arquivo não tem faixa de áudio'));
      const last = err.trim().split(/\r?\n/).pop();
      reject(new Error(last || `ffmpeg terminou com código ${code}`));
    });
  });
}

const exists = p => fsp.access(p).then(() => true, () => false);

// job: { src, rel, outRoot|null, presetId, tagged, trash }
// trashFn(path) move o original para a Lixeira (no app vem de shell.trashItem).
async function convert(job, trashFn) {
  const p = PRESETS.find(x => x.id === job.presetId);
  if (!p) return { status: 'error', message: 'formato desconhecido' };

  const base = path.parse(job.src).name;
  const outDir = job.outRoot ? path.join(job.outRoot, path.dirname(job.rel)) : path.dirname(job.src);
  if (job.outRoot && path.relative(job.outRoot, outDir).startsWith('..')) {
    return { status: 'error', message: 'caminho de saída inválido' };
  }
  const out = path.join(outDir, job.tagged ? `${base} - ${p.tag}.wav` : `${base}.wav`);
  const tmp = out + '.part';

  try {
    await fsp.mkdir(outDir, { recursive: true });
    if (await exists(out)) return { status: 'skipped', out };
    await runFfmpeg(job.src, tmp, p);
    await fsp.rename(tmp, out); // só aparece como .wav quando está completo
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    return { status: 'error', message: e.message };
  }

  const res = { status: 'ok', out };
  if (job.trash) {
    try { await trashFn(job.src); res.trashed = true; }
    catch (e) { res.trashError = e.message; }
  }
  return res;
}

module.exports = { PRESETS, expand, convert, isAudio };
