// The local music library: scans folders (internal or external drives), reads tags with ffprobe,
// groups tracks into albums and artists, and converts formats Chromium can't play natively.
// No Electron imports here, so it can be tested with plain Node.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { FFMPEG, FFPROBE, run } = require('./tools');

const AUDIO_EXT = new Set([
  'mp3', 'mp2', 'mpga', 'm4a', 'm4b', 'mp4', 'aac', 'alac', 'flac', 'wav', 'wave', 'w64', 'ogg', 'oga', 'opus',
  'aif', 'aiff', 'aifc', 'wma', 'asf', 'ape', 'wv', 'dsf', 'dff', 'mpc', 'tta', 'ac3', 'dts', 'mka', 'caf', 'au', 'snd', 'amr', 'webm', 'spx', 'tak', 'ofr'
]);
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif']);
const SKIP_DIRS = new Set(['$recycle.bin', 'system volume information', 'node_modules', '.git', '@eadir', '.trash', '.trashes']);

// What Chromium (and so Electron) decodes itself. Everything else is converted to FLAC on first play.
const NATIVE = {
  codecs: new Set(['mp3', 'aac', 'flac', 'vorbis', 'opus', 'pcm_s16le', 'pcm_s24le', 'pcm_u8', 'pcm_f32le']),
  containers: new Set(['mp3', 'm4a', 'm4b', 'mp4', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wav', 'wave', 'webm'])
};
const LOSSLESS = new Set(['flac', 'alac', 'ape', 'wavpack', 'tta', 'tak', 'mlp', 'truehd', 'dsd_lsbf', 'dsd_msbf', 'dsd_lsbf_planar', 'dsd_msbf_planar']);
const CODEC_LABEL = { mp3: 'MP3', aac: 'AAC', flac: 'FLAC', alac: 'ALAC', vorbis: 'Ogg Vorbis', opus: 'Opus', wmav2: 'WMA', wmav1: 'WMA', wmapro: 'WMA Pro', wmalossless: 'WMA Lossless', ape: 'APE', wavpack: 'WavPack', tta: 'TTA', mp2: 'MP2', ac3: 'AC3', dts: 'DTS', musepack7: 'Musepack', musepack8: 'Musepack', tak: 'TAK', speex: 'Speex', amrnb: 'AMR', amrwb: 'AMR-WB' };

const hash = (s, n = 16) => crypto.createHash('sha1').update(s).digest('hex').slice(0, n);
const extOf = (f) => path.extname(f).slice(1).toLowerCase();
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const pathKey = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
const trackIdFor = (file) => hash(pathKey(path.resolve(file)));

// ------------------------------------------------------------------ tags
function firstInt(v) { const m = String(v ?? '').match(/\d+/); return m ? +m[0] : null; }
function ofTotal(v) { const m = String(v ?? '').match(/\/\s*(\d+)/); return m ? +m[1] : null; }
function yearOf(v) { const m = String(v ?? '').match(/(1[89]\d\d|20\d\d)/); return m ? +m[1] : null; }

// "01 - Artist - Title.flac" / "01. Title.mp3" / "Title.wav"
function fromFilename(file) {
  let base = path.basename(file, path.extname(file)).replace(/_/g, ' ').trim();
  let num = null;
  const m = base.match(/^(?:(\d)[-.])?(\d{1,3})\s*[-.)\]]?\s+(.+)$/);
  if (m) { num = +m[2]; base = m[3]; }
  const parts = base.split(/\s+-\s+/);
  return parts.length >= 2 ? { track: num, artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() } : { track: num, title: base };
}

function parseProbe(file, j) {
  const streams = j.streams || [];
  const fmt = j.format || {};
  const a = streams.find((s) => s.codec_type === 'audio');
  if (!a) return null;
  const tags = {};
  const take = (obj) => { for (const [k, v] of Object.entries(obj || {})) { const key = k.toLowerCase().replace(/[\s_-]+/g, ''); if (!(key in tags) && v !== '') tags[key] = String(v); } };
  take(fmt.tags); take(a.tags);
  const pic = streams.find((s) => s.codec_type === 'video' && ((s.disposition && s.disposition.attached_pic) || /mjpeg|png|bmp/.test(s.codec_name)));
  const fn = fromFilename(file);
  const dir = path.dirname(file);
  const parentName = path.basename(path.dirname(dir));
  const dirName = path.basename(dir);
  const bits = +a.bits_per_raw_sample || +a.bits_per_sample || (/^pcm_[su](\d+)/.exec(a.codec_name) || [])[1] || null;
  const codec = a.codec_name;
  const container = extOf(file);
  const lossless = LOSSLESS.has(codec) || /^pcm_/.test(codec) || /^dsd_/.test(codec) || codec === 'wmalossless';
  const compilation = /^(1|true|yes)$/i.test(tags.compilation || tags.tcmp || tags.itunescompilation || '');
  return {
    title: tags.title || fn.title,
    artist: tags.artist || tags.performer || fn.artist || (dirName && parentName ? parentName : '') || 'Unknown artist',
    albumArtist: tags.albumartist || tags.band || tags.albumartistsort || '',
    album: tags.album || '',
    track: firstInt(tags.track || tags.tracknumber) ?? fn.track,
    trackTotal: ofTotal(tags.track) || firstInt(tags.tracktotal || tags.totaltracks),
    disc: firstInt(tags.disc || tags.discnumber) || 1,
    discTotal: ofTotal(tags.disc) || firstInt(tags.disctotal || tags.totaldiscs),
    year: yearOf(tags.originaldate || tags.originalyear || tags.date || tags.year || tags.tdor || tags.tyer),
    genre: (tags.genre || '').split(/[;\/\\]/)[0].trim(),
    composer: tags.composer || '',
    compilation,
    mbAlbumId: tags.musicbrainzalbumid || tags.musicbrainzreleaseid || '',
    mbReleaseGroupId: tags.musicbrainzreleasegroupid || '',
    duration: +fmt.duration || +a.duration || 0,
    codec,
    codecLabel: CODEC_LABEL[codec] || (/^pcm_/.test(codec) ? (container.startsWith('aif') ? 'AIFF' : 'WAV') : /^dsd_/.test(codec) ? 'DSD' : codec.toUpperCase()),
    container,
    sampleRate: +a.sample_rate || 0,
    bits: bits ? +bits : null,
    channels: +a.channels || 2,
    bitrate: +a.bit_rate || +fmt.bit_rate || 0,
    lossless,
    native: NATIVE.codecs.has(codec) && NATIVE.containers.has(container) && (+a.sample_rate || 0) <= 384000,
    embeddedArt: pic ? { w: pic.width || 0, h: pic.height || 0, index: pic.index, codec: pic.codec_name } : null
  };
}

async function probe(file) {
  const out = await run(FFPROBE, ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file], { timeout: 30000 });
  return parseProbe(file, JSON.parse(out.toString('utf8') || '{}'));
}

// ------------------------------------------------------------------ the library
class Library extends EventEmitter {
  constructor(dataDir) {
    super();
    this.dataDir = dataDir;
    this.cacheDir = path.join(dataDir, 'cache');
    this.transcodeDir = path.join(this.cacheDir, 'converted');
    this.file = path.join(dataDir, 'music-index.json');
    this.tracks = new Map();   // id -> track
    this.loose = new Map();    // files opened directly (not in a library folder)
    this.roots = [];           // [{ path, online }]
    this.albums = [];
    this.albumById = new Map();
    this.scanning = null;      // { done, total, phase }
    this.peaks = new Map();
    this.jobs = new Map();     // transcode jobs
    this.watchers = [];
    this.saveTimer = null;
    fs.mkdirSync(this.transcodeDir, { recursive: true });
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const t of d.tracks || []) this.tracks.set(t.id, t);
      this.roots = (d.roots || []).map((r) => ({ path: r.path || r, online: true }));
    } catch { /* first run */ }
    this.rebuild();
  }

  // ---------------- persistence
  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 1500);
  }
  flush() {
    clearTimeout(this.saveTimer);
    try {
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, roots: this.roots.map((r) => r.path), tracks: [...this.tracks.values()] }));
      fs.renameSync(tmp, this.file);
    } catch (e) { console.error('library save failed', e); }
  }

  // ---------------- folders
  addRoot(dir) {
    dir = path.resolve(dir);
    const k = pathKey(dir);
    if (this.roots.some((r) => pathKey(r.path) === k || k.startsWith(pathKey(r.path) + path.sep))) return false;
    // a new parent folder absorbs any existing child folders
    this.roots = this.roots.filter((r) => !pathKey(r.path).startsWith(k + path.sep));
    this.roots.push({ path: dir, online: true });
    this.save();
    this.scan();
    return true;
  }
  removeRoot(dir) {
    const k = pathKey(path.resolve(dir));
    this.roots = this.roots.filter((r) => pathKey(r.path) !== k);
    for (const [id, t] of this.tracks) if (pathKey(t.path).startsWith(k + path.sep)) this.tracks.delete(id);
    this.rebuild();
    this.save();
    this.emit('changed');
  }
  rootOf(file) {
    const k = pathKey(file);
    const r = this.roots.find((x) => k.startsWith(pathKey(x.path) + path.sep));
    return r ? r.path : null;
  }

  // ---------------- scanning
  async walk(dir, out, depth = 0) {
    if (depth > 24) return;
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name.toLowerCase())) await this.walk(p, out, depth + 1); }
      else if (e.isFile() && AUDIO_EXT.has(extOf(e.name))) out.push(p);
    }
  }

  // Incremental: unchanged files (same size + modified time) keep their cached tags.
  scan() {
    if (this.scanning) { this.rescanQueued = true; return this.scanPromise; }
    this.scanning = { phase: 'Looking for music', done: 0, total: 0 };
    this.emit('progress', this.scanning);
    this.scanPromise = (async () => {
      const files = [];
      for (const r of this.roots) {
        r.online = fs.existsSync(r.path);
        if (r.online) await this.walk(r.path, files);
      }
      const seen = new Set();
      const todo = [];
      for (const f of files) {
        const id = trackIdFor(f);
        seen.add(id);
        let st;
        try { st = await fsp.stat(f); } catch { continue; }
        const old = this.tracks.get(id);
        if (old && old.size === st.size && old.mtime === Math.round(st.mtimeMs)) { old.offline = false; continue; }
        todo.push({ f, id, st, old });
      }
      // Tracks that disappeared: drop them, unless their drive is just unplugged.
      for (const [id, t] of this.tracks) {
        if (seen.has(id)) continue;
        const root = this.roots.find((r) => pathKey(t.path).startsWith(pathKey(r.path) + path.sep));
        if (root && !root.online) t.offline = true;
        else this.tracks.delete(id);
      }
      this.scanning = { phase: 'Reading tags', done: 0, total: todo.length };
      this.emit('progress', this.scanning);
      let i = 0, lastEmit = 0, sinceRebuild = 0;
      const worker = async () => {
        while (i < todo.length) {
          const { f, id, st, old } = todo[i++];
          try {
            const meta = await probe(f);
            if (meta) {
              this.tracks.set(id, { id, path: f, dir: path.dirname(f), size: st.size, mtime: Math.round(st.mtimeMs), addedAt: old ? old.addedAt : Date.now(), ...meta });
              sinceRebuild++;
            }
          } catch (e) { /* unreadable file: skip */ }
          this.scanning.done++;
          const now = Date.now();
          if (now - lastEmit > 250) { lastEmit = now; this.emit('progress', { ...this.scanning }); }
          // let new music show up while a big first scan is still running
          if (sinceRebuild >= 400) { sinceRebuild = 0; this.rebuild(); this.emit('changed'); }
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      this.rebuild();
      this.save();
      this.scanning = null;
      this.emit('progress', null);
      this.emit('changed');
      this.watch();
      if (this.rescanQueued) { this.rescanQueued = false; return this.scan(); }
    })();
    return this.scanPromise;
  }

  // Re-scan when files change. Recursive watching works on Windows and macOS.
  watch() {
    for (const w of this.watchers) try { w.close(); } catch {}
    this.watchers = [];
    const kick = debounce(() => this.scan(), 4000);
    for (const r of this.roots) {
      if (!r.online) continue;
      try {
        const w = fs.watch(r.path, { recursive: true }, (_ev, name) => {
          if (!name) return kick();
          const ext = extOf(String(name));
          if (!ext || AUDIO_EXT.has(ext)) kick();
        });
        w.on('error', () => {});
        this.watchers.push(w);
      } catch { /* recursive watch unsupported here */ }
    }
  }

  // Files opened straight from Explorer / dragged in, outside any library folder.
  async openFiles(paths) {
    const files = [];
    for (const p of paths) {
      try {
        const st = await fsp.stat(p);
        if (st.isDirectory()) await this.walk(p, files);
        else if (AUDIO_EXT.has(extOf(p))) files.push(p);
      } catch {}
    }
    const out = [];
    for (const f of files.sort(naturalCompare)) {
      const id = trackIdFor(f);
      let t = this.tracks.get(id) || this.loose.get(id);
      if (!t) {
        try {
          const st = await fsp.stat(f);
          const meta = await probe(f);
          if (!meta) continue;
          t = { id, path: f, dir: path.dirname(f), size: st.size, mtime: Math.round(st.mtimeMs), addedAt: Date.now(), loose: true, ...meta };
          this.loose.set(id, t);
        } catch { continue; }
      }
      out.push(t);
    }
    return out;
  }
  getTrack(id) { return this.tracks.get(id) || this.loose.get(id) || null; }

  // ---------------- albums + artists
  rebuild() {
    // 1. cluster by folder + album tag
    const clusters = new Map();
    for (const t of this.tracks.values()) {
      const albumTitle = t.album || path.basename(t.dir);
      const k = pathKey(t.dir) + '\u0000' + norm(albumTitle);
      if (!clusters.has(k)) clusters.set(k, { title: albumTitle, tracks: [] });
      clusters.get(k).tracks.push(t);
    }
    // 2. work out each cluster's album artist, then merge clusters of the same album (CD1/CD2 folders)
    const albums = new Map();
    for (const c of clusters.values()) {
      const aa = mostCommon(c.tracks.map((t) => t.albumArtist).filter(Boolean));
      const artists = new Set(c.tracks.map((t) => norm(t.artist)));
      const comp = c.tracks.some((t) => t.compilation);
      const artist = aa || (artists.size === 1 ? c.tracks[0].artist : comp || artists.size > 2 ? 'Various Artists' : mostCommon(c.tracks.map((t) => t.artist)));
      const key = norm(artist) + '|' + norm(c.title.replace(/[\[(]?\s*(cd|disc|disk)\s*\d+\s*[\])]?/ig, ''));
      if (!albums.has(key)) albums.set(key, { key, title: c.title.replace(/\s*[\[(]\s*(cd|disc|disk)\s*\d+\s*[\])]\s*$/i, ''), artist, tracks: [] });
      albums.get(key).tracks.push(...c.tracks);
    }
    this.albums = [];
    this.albumById = new Map();
    for (const a of albums.values()) {
      a.tracks.sort((x, y) => (x.disc || 1) - (y.disc || 1) || (x.track ?? 999) - (y.track ?? 999) || naturalCompare(x.path, y.path));
      const t0 = a.tracks[0];
      const id = hash(a.key, 12);
      const discs = new Set(a.tracks.map((t) => t.disc || 1)).size;
      const album = {
        id,
        title: a.title,
        artist: a.artist,
        year: mostCommon(a.tracks.map((t) => t.year).filter(Boolean)) || null,
        genre: mostCommon(a.tracks.map((t) => t.genre).filter(Boolean)) || '',
        trackIds: a.tracks.map((t) => t.id),
        duration: a.tracks.reduce((s, t) => s + (t.duration || 0), 0),
        discs,
        dirs: [...new Set(a.tracks.map((t) => t.dir))],
        format: formatLabel(a.tracks),
        addedAt: Math.max(...a.tracks.map((t) => t.addedAt || 0)),
        offline: a.tracks.every((t) => t.offline),
        mbAlbumId: t0.mbAlbumId || '', mbReleaseGroupId: t0.mbReleaseGroupId || '',
        embedded: a.tracks.filter((t) => t.embeddedArt).sort((x, y) => (y.embeddedArt.w || 0) - (x.embeddedArt.w || 0))[0]?.id || null
      };
      for (const t of a.tracks) { t.albumId = id; t.albumTitle = album.title; t.albumArtistResolved = album.artist; }
      this.albums.push(album);
      this.albumById.set(id, album);
    }
  }

  // ---------------- playback: native files are served as-is, the rest converted to FLAC once
  async playablePath(t) {
    if (t.native) return { file: t.path, type: mimeFor(t.container) };
    const out = path.join(this.transcodeDir, `${t.id}-${t.mtime}.flac`);
    if (fs.existsSync(out)) { touch(out); return { file: out, type: 'audio/flac' }; }
    if (!this.jobs.has(out)) {
      const part = out + '.part';
      const args = ['-v', 'error', '-y', '-i', t.path, '-map', '0:a:0', '-vn', '-c:a', 'flac', '-compression_level', '0'];
      if (t.sampleRate > 192000) args.push('-ar', '96000');            // DSD and other very high rates
      if (/^dsd_/.test(t.codec)) args.push('-sample_fmt', 's32');
      else if ((t.bits || 16) > 16 && !/^(wma|mp|ac3|dts|opus|vorbis|aac)/.test(t.codec)) args.push('-sample_fmt', 's32');
      args.push('-f', 'flac', part);
      const job = run(FFMPEG, args, { timeout: 15 * 60 * 1000, maxBytes: 1 })
        .then(() => { fs.renameSync(part, out); this.trimCache(); return out; })
        .finally(() => this.jobs.delete(out));
      this.jobs.set(out, job);
    }
    await this.jobs.get(out);
    return { file: out, type: 'audio/flac' };
  }
  // keep converted files under ~3 GB, oldest first
  trimCache(limit = 3 * 1024 ** 3) {
    try {
      const files = fs.readdirSync(this.transcodeDir).filter((f) => f.endsWith('.flac'))
        .map((f) => { const p = path.join(this.transcodeDir, f); const s = fs.statSync(p); return { p, size: s.size, t: s.atimeMs || s.mtimeMs }; })
        .sort((a, b) => b.t - a.t);
      let total = 0;
      for (const f of files) { total += f.size; if (total > limit) fs.unlinkSync(f.p); }
    } catch {}
  }

  // ---------------- waveform for the scrubber (decoded at 1 kHz mono, so it's quick)
  async peaksFor(id, bins = 96) {
    if (this.peaks.has(id)) return this.peaks.get(id);
    const t = this.getTrack(id);
    if (!t) return null;
    const raw = await run(FFMPEG, ['-v', 'error', '-i', t.path, '-map', '0:a:0', '-ac', '1', '-ar', '1000', '-f', 's16le', '-'], { timeout: 60000, maxBytes: 64 * 1024 * 1024 });
    const n = Math.floor(raw.length / 2);
    if (!n) return null;
    const size = Math.max(1, Math.floor(n / bins));
    const out = [];
    for (let i = 0; i < bins; i++) {
      let s = 0, c = 0;
      for (let j = i * size; j < Math.min(n, (i + 1) * size); j++) { const v = raw.readInt16LE(j * 2) / 32768; s += v * v; c++; }
      out.push(Math.sqrt(s / Math.max(1, c)));
    }
    const max = Math.max(...out) || 1;
    const peaks = out.map((v) => +Math.max(0.08, v / max).toFixed(2));
    this.peaks.set(id, peaks);
    if (this.peaks.size > 400) this.peaks.delete(this.peaks.keys().next().value);
    return peaks;
  }

  // ---------------- what the renderer gets
  snapshot() {
    const tracks = [];
    for (const t of this.tracks.values()) tracks.push(lean(t));
    return {
      roots: this.roots,
      scanning: this.scanning,
      tracks,
      albums: this.albums.map(({ embedded, ...a }) => a)
    };
  }
}

function lean(t) {
  return {
    id: t.id, title: t.title, artist: t.artist, album: t.albumTitle || t.album || '', albumId: t.albumId || null, albumArtist: t.albumArtistResolved || t.albumArtist || t.artist,
    track: t.track, disc: t.disc, year: t.year, genre: t.genre, duration: t.duration,
    codec: t.codecLabel, lossless: t.lossless, sampleRate: t.sampleRate, bits: t.bits, bitrate: t.bitrate, channels: t.channels,
    native: t.native, path: t.path, addedAt: t.addedAt, offline: !!t.offline, loose: !!t.loose
  };
}

function formatLabel(tracks) {
  const t = tracks[0];
  const codec = mostCommon(tracks.map((x) => x.codecLabel));
  if (!t) return '';
  if (t.lossless) {
    const bits = mostCommon(tracks.map((x) => x.bits).filter(Boolean));
    const sr = mostCommon(tracks.map((x) => x.sampleRate).filter(Boolean));
    if (/^DSD/.test(codec)) return `DSD${sr ? Math.round(sr / 44100) : ''}`;
    return `${codec}${bits ? ` ${bits}-bit` : ''}${sr ? `/${+(sr / 1000).toFixed(1)} kHz` : ''}`;
  }
  // average bitrate, snapped to the familiar encoder settings (VBR files land in between)
  const avg = tracks.reduce((s, x) => s + (x.bitrate || 0), 0) / tracks.length / 1000;
  const std = [64, 96, 128, 160, 192, 224, 256, 320].find((v) => Math.abs(v - avg) / v < 0.12);
  const br = std || Math.round(avg);
  return `${codec}${br ? ` ${br} kbps` : ''}`;
}

function mimeFor(ext) {
  return { mp3: 'audio/mpeg', m4a: 'audio/mp4', m4b: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', wave: 'audio/wav', webm: 'audio/webm' }[ext] || 'application/octet-stream';
}
function mostCommon(arr) {
  const m = new Map();
  let best = null, n = 0;
  for (const v of arr) { const c = (m.get(v) || 0) + 1; m.set(v, c); if (c > n) { n = c; best = v; } }
  return best;
}
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
function naturalCompare(a, b) { return collator.compare(a, b); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function touch(p) { try { const now = new Date(); fs.utimesSync(p, now, now); } catch {} }

module.exports = { Library, probe, parseProbe, fromFilename, norm, hash, trackIdFor, AUDIO_EXT, IMAGE_EXT, mimeFor, naturalCompare };
