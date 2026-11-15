// Album art: the best local image (embedded in the files or sitting in the folder), upgraded to an
// HD scan from MusicBrainz's Cover Art Archive, Discogs (with your token) or Apple's catalogue
// when the local one is missing or small. Everything is cached on disk with a 600px thumbnail.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { EventEmitter } = require('events');
const { FFMPEG, run } = require('./tools');
const { IMAGE_EXT, norm } = require('./library');

const UA = 'Zudio/0.1 ( local music player )';
const FOLDER_NAMES = /^(cover|folder|front|album ?art(_\{.*\}_large)?|albumart|album|art|artwork|scan)([ ._-]?(front|large|hd|\d+))?$/i;
const THUMB = 600;

// ------------------------------------------------------------------ image size from the header bytes
function imageSize(b) {
  if (!b || b.length < 24) return null;
  if (b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), type: 'png' };
  if (b[0] === 0x47 && b[1] === 0x49) return { w: b.readUInt16LE(6), h: b.readUInt16LE(8), type: 'gif' };
  if (b[0] === 0x42 && b[1] === 0x4d) return { w: b.readInt32LE(18), h: Math.abs(b.readInt32LE(22)), type: 'bmp' };
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const f = b.toString('ascii', 12, 16);
    if (f === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3), type: 'webp' };
    if (f === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff, type: 'webp' };
    if (f === 'VP8L') { const n = b.readUInt32LE(21); return { w: 1 + (n & 0x3fff), h: 1 + ((n >> 14) & 0x3fff), type: 'webp' }; }
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length - 9) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5), type: 'jpg' };
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}
async function fileSize(p) {
  try {
    const fh = await fsp.open(p, 'r');
    const buf = Buffer.alloc(256 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    await fh.close();
    return imageSize(buf.subarray(0, bytesRead));
  } catch { return null; }
}

// ------------------------------------------------------------------ name matching for online results
function cleanTitle(s) {
  return norm(String(s || '')
    .replace(/[\[(][^\])]*(deluxe|remaster|edition|expanded|anniversary|bonus|version|explicit|disc|cd \d|mono|stereo)[^\])]*[\])]/ig, '')
    .replace(/\s*-\s*(single|ep)$/i, ''));
}
function titleMatch(a, b) {
  const x = cleanTitle(a), y = cleanTitle(b);
  if (!x || !y) return false;
  return x === y || (Math.min(x.length, y.length) > 4 && (x.startsWith(y) || y.startsWith(x)));
}
function artistMatch(a, b) {
  const x = norm(a).replace(/^the /, ''), y = norm(b).replace(/^the /, '');
  if (!x || !y) return false;
  if (/^various/.test(x) && /^various/.test(y)) return true;
  return x === y || x.includes(y) || y.includes(x);
}
const luceneSafe = (s) => String(s).replace(/[+\-&|!(){}\[\]^"~*?:\\\/]/g, ' ').replace(/\s+/g, ' ').trim();

// ------------------------------------------------------------------ the art manager
class ArtManager extends EventEmitter {
  constructor(dataDir, library, getSettings) {
    super();
    this.lib = library;
    this.dir = path.join(dataDir, 'cache', 'art');
    this.file = path.join(dataDir, 'art-index.json');
    this.settings = getSettings;
    this.index = {};
    this.running = false;
    this.queue = [];
    this.lastMB = 0;
    fs.mkdirSync(this.dir, { recursive: true });
    try { this.index = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch {}
  }
  save() { clearTimeout(this.t); this.t = setTimeout(() => this.flush(), 1000); }
  flush() { try { fs.writeFileSync(this.file, JSON.stringify(this.index)); } catch {} }

  info(albumId) { return this.index[albumId] || null; }
  // url the renderer uses; v changes whenever the image does
  urls(albumId) {
    const e = this.index[albumId];
    if (!e || !e.file) return null;
    return { art: `media://art/${albumId}/thumb?v=${e.v}`, artLarge: `media://art/${albumId}/full?v=${e.v}`, w: e.w, h: e.h, source: e.source };
  }
  pathFor(albumId, kind) {
    const e = this.index[albumId];
    if (!e || !e.file) return null;
    return kind === 'thumb' && e.thumb ? path.join(this.dir, e.thumb) : path.join(this.dir, e.file);
  }

  // Look at every album: local art first (quick), then online for those still missing or small.
  refreshAll() {
    for (const a of this.lib.albums) {
      const e = this.index[a.id];
      const sig = a.trackIds.length + ':' + a.dirs.join('|');
      if (!e || (e.sig !== sig && e.source !== 'manual')) this.enqueue(a.id, false);
      else if (this.wantsOnline(e)) this.enqueue(a.id, false);
    }
    this.pump();
  }
  wantsOnline(e) {
    const s = this.settings();
    if (!s.onlineArt || e.source === 'manual' || e.source === 'online') return false;
    if (e.onlineTried && Date.now() - e.onlineTried < 30 * 864e5) return false;   // retry misses after a month
    return !e.file || Math.min(e.w || 0, e.h || 0) < (s.minArtSize || 1000);
  }
  enqueue(id, force) {
    if (!this.queue.some((q) => q.id === id)) this.queue.push({ id, force });
    else if (force) this.queue.find((q) => q.id === id).force = true;
  }
  async pump() {
    if (this.running) return;
    this.running = true;
    this.emit('busy', true);
    // local passes for everything first, so covers show up fast
    try {
      while (this.queue.length) {
        this.queue.sort((a, b) => (b.force ? 1 : 0) - (a.force ? 1 : 0));
        const { id, force } = this.queue.shift();
        const a = this.lib.albumById.get(id);
        if (!a) continue;
        try { await this.process(a, force); } catch (err) { console.error('art', a.title, err.message); }
      }
    } finally {
      this.running = false;
      this.emit('busy', false);
    }
  }

  async process(a, force) {
    const sig = a.trackIds.length + ':' + a.dirs.join('|');
    let e = this.index[a.id];
    if (!e || (e.sig !== sig && e.source !== 'manual') || force) {
      if (!e || e.sig !== sig) {
        const local = await this.bestLocal(a);
        if (local) await this.store(a.id, local.buf, local.source, sig);
        else this.index[a.id] = { ...(this.index[a.id] || {}), sig, v: (e && e.v) || 0 };
        e = this.index[a.id];
        this.save();
      }
    }
    if (force || this.wantsOnline(e)) {
      e.onlineTried = Date.now();
      const found = await this.online(a).catch(() => null);
      const have = Math.min(e.w || 0, e.h || 0);
      if (found) {
        const size = imageSize(found.buf);
        if (size && Math.min(size.w, size.h) > have) await this.store(a.id, found.buf, 'online', sig, found.from);
      }
      this.save();
    }
  }

  async store(albumId, buf, source, sig, from) {
    const size = imageSize(buf);
    if (!size) return false;
    const prev = this.index[albumId] || {};
    const v = (prev.v || 0) + 1;
    for (const f of [prev.file, prev.thumb]) if (f) fsp.unlink(path.join(this.dir, f)).catch(() => {});
    const file = `${albumId}-${v}.${size.type === 'jpg' ? 'jpg' : size.type}`;
    await fsp.writeFile(path.join(this.dir, file), buf);
    let thumb = null;
    if (Math.max(size.w, size.h) > THUMB + 50 || size.type !== 'jpg') {
      thumb = `${albumId}-${v}_t.jpg`;
      try {
        await run(FFMPEG, ['-v', 'error', '-y', '-i', path.join(this.dir, file), '-vf', `scale=${THUMB}:${THUMB}:force_original_aspect_ratio=decrease:flags=lanczos`, '-q:v', '3', '-frames:v', '1', path.join(this.dir, thumb)], { timeout: 30000, maxBytes: 1 });
      } catch { thumb = null; }
    }
    this.index[albumId] = { file, thumb, w: size.w, h: size.h, source, from: from || source, sig: sig || prev.sig, v, onlineTried: prev.onlineTried };
    this.save();
    this.emit('updated', albumId);
    return true;
  }

  // ---------------- local: the folder image or embedded picture with the most pixels
  async bestLocal(a) {
    const cands = [];
    for (const dir of new Set([...a.dirs, ...a.dirs.map((d) => path.dirname(d))])) {
      const isParent = !a.dirs.includes(dir);
      let names;
      try { names = await fsp.readdir(dir); } catch { continue; }
      const imgs = names.filter((n) => IMAGE_EXT.has(path.extname(n).slice(1).toLowerCase()));
      for (const n of imgs) {
        const base = path.basename(n, path.extname(n));
        const named = FOLDER_NAMES.test(base);
        // a parent folder only counts for multi-disc albums, and only for clearly named covers
        if (isParent && (!named || a.dirs.length < 2)) continue;
        if (!named && (/back|inlay|tray|cd|disc|booklet|inside|spine|matrix/i.test(base) || imgs.length > 3)) continue;
        const p = path.join(dir, n);
        const size = await fileSize(p);
        if (size && size.w >= 100) cands.push({ p, size, score: size.w * size.h * (named ? 1.15 : 1), source: 'folder' });
      }
    }
    // embedded art: the album's biggest
    const tracks = a.trackIds.map((id) => this.lib.getTrack(id)).filter((t) => t && t.embeddedArt);
    tracks.sort((x, y) => (y.embeddedArt.w || 0) - (x.embeddedArt.w || 0));
    const t = tracks[0];
    if (t) cands.push({ track: t, size: { w: t.embeddedArt.w, h: t.embeddedArt.h }, score: (t.embeddedArt.w || 300) * (t.embeddedArt.h || 300), source: 'embedded' });
    cands.sort((x, y) => y.score - x.score);
    for (const c of cands) {
      try {
        const buf = c.p ? await fsp.readFile(c.p) : await run(FFMPEG, ['-v', 'error', '-i', c.track.path, '-map', `0:${c.track.embeddedArt.index}`, '-c', 'copy', '-frames:v', '1', '-f', 'image2pipe', '-'], { timeout: 20000, maxBytes: 40 * 1024 * 1024 });
        if (imageSize(buf)) return { buf, source: c.source };
      } catch { /* try the next one */ }
    }
    return null;
  }

  // ---------------- online sources, in order
  async online(a) {
    const s = this.settings();
    const artist = a.artist, title = a.title;
    if (!title || /^unknown/i.test(artist) && /^unknown/i.test(title)) return null;
    const order = [];
    if (s.artCAA !== false) order.push(['Cover Art Archive', () => this.fromCAA(a)]);
    if (s.discogsToken) order.push(['Discogs', () => this.fromDiscogs(artist, title, s.discogsToken)]);
    if (s.artITunes !== false) order.push(['Apple Music', () => this.fromITunes(artist, title)]);
    for (const [from, fn] of order) {
      try {
        const url = await fn();
        if (!url) continue;
        const buf = await this.download(url);
        if (buf && imageSize(buf)) return { buf, from };
      } catch { /* next source */ }
    }
    return null;
  }

  async getJson(url, headers = {}) {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  }
  async download(url) {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(60000) });
    if (!r.ok || !/^image\//.test(r.headers.get('content-type') || 'image/')) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length > 1000 && buf.length < 60 * 1024 * 1024 ? buf : null;
  }
  async mbWait() {
    const wait = this.lastMB + 1100 - Date.now();      // MusicBrainz asks for one request a second
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastMB = Date.now();
  }

  async fromCAA(a) {
    if (a.mbReleaseGroupId) return `https://coverartarchive.org/release-group/${a.mbReleaseGroupId}/front`;
    if (a.mbAlbumId) return `https://coverartarchive.org/release/${a.mbAlbumId}/front`;
    await this.mbWait();
    const various = /^various/i.test(a.artist);
    const q = `releasegroup:"${luceneSafe(a.title)}"` + (various ? ' AND artistname:"Various Artists"' : ` AND artist:"${luceneSafe(a.artist)}"`);
    const j = await this.getJson(`https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(q)}&fmt=json&limit=8`);
    const groups = (j['release-groups'] || []).filter((g) => (g.score ?? 100) >= 80 && titleMatch(g.title, a.title) &&
      (various || (g['artist-credit'] || []).some((c) => artistMatch(c.name || (c.artist && c.artist.name), a.artist))));
    // prefer albums over singles/compilations with the same name
    // exact title matches first ("Night Bus" over "Night Bus Live"), then albums over singles
    const exact = (g) => cleanTitle(g.title) === cleanTitle(a.title);
    groups.sort((x, y) => (exact(y) - exact(x)) || ((y['primary-type'] === 'Album') - (x['primary-type'] === 'Album')) || (y.score - x.score));
    for (const g of groups.slice(0, 3)) {
      const url = `https://coverartarchive.org/release-group/${g.id}/front`;
      const head = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(20000) }).catch(() => null);
      if (head && head.ok) return url;
    }
    return null;
  }

  async fromDiscogs(artist, title, token) {
    const auth = { Authorization: `Discogs token=${token}` };
    for (const type of ['master', 'release']) {
      const params = new URLSearchParams({ type, release_title: title, per_page: '8' });
      if (!/^various/i.test(artist)) params.set('artist', artist);
      const j = await this.getJson(`https://api.discogs.com/database/search?${params}`, auth);
      for (const r of j.results || []) {
        const [ra, ...rt] = String(r.title || '').split(' - ');
        if (r.cover_image && !/spacer\.gif/.test(r.cover_image) && titleMatch(rt.join(' - '), title) && (artistMatch(ra.replace(/\s*\(\d+\)$/, ''), artist) || /^various/i.test(artist))) return r.cover_image;
      }
    }
    return null;
  }

  async fromITunes(artist, title) {
    const term = /^various/i.test(artist) ? title : `${artist} ${title}`;
    const j = await this.getJson(`https://itunes.apple.com/search?${new URLSearchParams({ term, entity: 'album', limit: '15', media: 'music' })}`);
    const hit = (j.results || []).find((r) => titleMatch(r.collectionName, title) && (/^various/i.test(artist) || artistMatch(r.artistName, artist)));
    return hit && hit.artworkUrl100 ? hit.artworkUrl100.replace(/\/\d+x\d+(bb|-\d+)?\.(jpg|png)$/i, '/3000x3000bb.jpg') : null;
  }

  // ---------------- manual choices
  async useFile(albumId, file) {
    const buf = await fsp.readFile(file);
    if (!imageSize(buf)) throw new Error('That file isn’t an image I can read');
    const a = this.lib.albumById.get(albumId);
    return this.store(albumId, buf, 'manual', a ? a.trackIds.length + ':' + a.dirs.join('|') : undefined);
  }
  lookUpAgain(albumId) {
    const e = this.index[albumId];
    if (e && e.source === 'manual') e.source = 'folder';
    if (e) e.onlineTried = 0;
    this.enqueue(albumId, true);
    this.pump();
  }
}

module.exports = { ArtManager, imageSize, titleMatch, artistMatch, cleanTitle };
