'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { expand, convert } = require('../convert');
const ffmpeg = require('ffmpeg-static');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-test-'));
const sons = path.join(root, 'Sons');
fs.mkdirSync(path.join(sons, 'Carro', 'Motor'), { recursive: true });
fs.mkdirSync(path.join(sons, 'Passos'), { recursive: true });

function gen(file, ...extra) {
  const r = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', ...extra, file]);
  assert.strictEqual(r.status, 0, `ffmpeg falhou gerando ${file}: ${r.stderr}`);
}
gen(path.join(sons, 'Carro', 'buzina.ogg'), '-c:a', 'libvorbis');
gen(path.join(sons, 'Carro', 'Motor', 'ronco.flac'));
gen(path.join(sons, 'Passos', 'passo 1.mp3'));
gen(path.join(sons, 'Passos', 'ja.wav'));
fs.writeFileSync(path.join(sons, 'Passos', 'quebrado.mp3'), 'isto não é áudio');
fs.writeFileSync(path.join(sons, 'nota.txt'), 'x');

function wavInfo(file) {
  const b = fs.readFileSync(file);
  assert.strictEqual(b.toString('ascii', 0, 4), 'RIFF');
  assert.strictEqual(b.toString('ascii', 8, 12), 'WAVE');
  // percorre os blocos até achar "fmt "
  for (let o = 12; o + 8 <= b.length;) {
    const id = b.toString('ascii', o, o + 4), len = b.readUInt32LE(o + 4);
    if (id === 'fmt ') {
      let fmt = b.readUInt16LE(o + 8);
      if (fmt === 0xFFFE) fmt = b.readUInt16LE(o + 8 + 24); // WAVE_FORMAT_EXTENSIBLE: formato real no sub-GUID
      return { fmt, ch: b.readUInt16LE(o + 10), rate: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22), size: b.length, firstChunkAt: 12 };
    }
    o += 8 + len + (len & 1);
  }
  assert.fail('sem bloco fmt');
}

(async () => {
  // varredura recursiva ignora .wav e arquivos que não são áudio
  const found = await expand([sons]);
  const rels = found.map(f => f.rel.split(path.sep).join('/')).sort();
  assert.deepStrictEqual(rels, ['Sons/Carro/Motor/ronco.flac', 'Sons/Carro/buzina.ogg', 'Sons/Passos/passo 1.mp3', 'Sons/Passos/quebrado.mp3']);

  // converte ao lado do original, 16-bit 44.1k
  const buzina = found.find(f => f.path.endsWith('buzina.ogg'));
  let r = await convert({ src: buzina.path, rel: buzina.rel, outRoot: null, presetId: '16bit-44k', tagged: false, trash: false });
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.out, path.join(sons, 'Carro', 'buzina.wav'));
  let w = wavInfo(r.out);
  assert.deepStrictEqual([w.fmt, w.ch, w.rate, w.bits], [1, 1, 44100, 16]);
  assert.ok(!fs.existsSync(r.out + '.part'), 'sobrou arquivo temporário');

  // segunda vez pula, sem tocar no que existe
  r = await convert({ src: buzina.path, rel: buzina.rel, outRoot: null, presetId: '16bit-44k', tagged: false, trash: true }, () => assert.fail('não deveria ir para a Lixeira'));
  assert.strictEqual(r.status, 'skipped');

  // 24-bit 96k com sufixo + outra pasta preservando a estrutura + Lixeira
  const ronco = found.find(f => f.path.endsWith('ronco.flac'));
  const out = path.join(root, 'Saida');
  const trashed = [];
  r = await convert({ src: ronco.path, rel: ronco.rel, outRoot: out, presetId: '24bit-96k', tagged: true, trash: true }, async p => trashed.push(p));
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.out, path.join(out, 'Sons', 'Carro', 'Motor', 'ronco - 24bit-96k.wav'));
  w = wavInfo(r.out);
  assert.deepStrictEqual([w.fmt, w.rate, w.bits], [1, 96000, 24]);
  assert.deepStrictEqual(trashed, [ronco.path]);
  assert.ok(r.trashed);

  // mono e float
  const passo = found.find(f => f.path.endsWith('passo 1.mp3'));
  r = await convert({ src: passo.path, rel: passo.rel, outRoot: null, presetId: 'float-48k', tagged: true, trash: false });
  w = wavInfo(r.out);
  assert.deepStrictEqual([w.fmt, w.rate, w.bits], [3, 48000, 32]);
  r = await convert({ src: passo.path, rel: passo.rel, outRoot: null, presetId: 'mono-16bit-22k', tagged: true, trash: false });
  w = wavInfo(r.out);
  assert.deepStrictEqual([w.ch, w.rate, w.bits], [1, 22050, 16]);

  // arquivo quebrado dá erro, não deixa .wav nem .part e não vai para a Lixeira
  const bad = found.find(f => f.path.endsWith('quebrado.mp3'));
  r = await convert({ src: bad.path, rel: bad.rel, outRoot: null, presetId: '16bit-44k', tagged: false, trash: true }, () => assert.fail('original quebrado não pode ir para a Lixeira'));
  assert.strictEqual(r.status, 'error');
  assert.ok(r.message);
  assert.deepStrictEqual(fs.readdirSync(path.join(sons, 'Passos')).filter(n => /quebrado\./.test(n)), ['quebrado.mp3']);

  // saída fora da pasta escolhida é recusada
  r = await convert({ src: buzina.path, rel: '../../fora/x.ogg', outRoot: out, presetId: '16bit-44k', tagged: false, trash: false });
  assert.strictEqual(r.status, 'error');

  fs.rmSync(root, { recursive: true, force: true });
  console.log('ok: todos os testes passaram');
})().catch(e => { console.error(e); process.exit(1); });
