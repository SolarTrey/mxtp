// The media:// protocol. media://track/<id> streams a song (with seeking), converting it to FLAC first
// if Chromium can't decode it; media://art/<albumId>/<thumb|full> serves cached album art.
const fs = require('fs');
const fsp = fs.promises;
const { Readable } = require('stream');
const path = require('path');

const IMG_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' };

async function serveFile(file, type, request) {
  const st = await fsp.stat(file);
  const size = st.size;
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' };
  const range = request.headers.get('range');
  let start = 0, end = size - 1, status = 200;
  const m = range && /bytes=(\d*)-(\d*)/.exec(range);
  if (m && (m[1] || m[2])) {
    if (m[1]) { start = +m[1]; end = m[2] ? Math.min(+m[2], size - 1) : size - 1; }
    else { start = Math.max(0, size - +m[2]); }
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = String(end - start + 1);
  if (request.method === 'HEAD') return new Response(null, { status, headers });
  const body = Readable.toWeb(fs.createReadStream(file, { start, end }));
  return new Response(body, { status, headers });
}

function makeHandler(library, art, dataDir) {
  return async (request) => {
    try {
      const u = new URL(request.url);
      const parts = u.pathname.split('/').filter(Boolean);
      if (u.hostname === 'track') {
        const t = library.getTrack(parts[0]);
        if (!t) return new Response('Not found', { status: 404 });
        const { file, type } = await library.playablePath(t);
        return await serveFile(file, type, request);
      }
      if (u.hostname === 'art') {
        const file = art.pathFor(parts[0], parts[1] || 'full');
        if (!file) return new Response('Not found', { status: 404 });
        const ext = file.split('.').pop().toLowerCase();
        return await serveFile(file, IMG_TYPES[ext] || 'image/jpeg', request);
      }
      if (u.hostname === 'radio') {
        const target = u.searchParams.get('u') || '';
        if (!/^https?:\/\//i.test(target)) return new Response('Bad station', { status: 400 });
        const r = await fetch(target, { headers: { 'User-Agent': 'Zudio/0.1', 'Icy-MetaData': '0' }, redirect: 'follow' });
        if (!r.ok || !r.body) return new Response('Station unavailable', { status: 502 });
        const type = (r.headers.get('content-type') || 'audio/mpeg').split(';')[0];
        return new Response(r.body, { status: 200, headers: { 'Content-Type': /audio|ogg|aac|mpeg/.test(type) ? type : 'audio/mpeg', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } });
      }
      if (u.hostname === 'video') {
        // your Earth visualizer video, wherever it lives (Settings → Visualizers)
        const file = require('./store').settings().earthVideo;
        if (!file || !fs.existsSync(file)) return new Response('Not found', { status: 404 });
        const ext = path.extname(file).slice(1).toLowerCase();
        const type = { webm: 'video/webm', mkv: 'video/x-matroska', ogv: 'video/ogg' }[ext] || 'video/mp4';
        return await serveFile(file, type, request);
      }
      if (u.hostname === 'wall' && dataDir) {
        const name = path.basename(decodeURIComponent(parts[0] || ''));
        const file = path.join(dataDir, 'wallpapers', name);
        if (!name || !fs.existsSync(file)) return new Response('Not found', { status: 404 });
        return await serveFile(file, IMG_TYPES[name.split('.').pop().toLowerCase()] || 'image/jpeg', request);
      }
      return new Response('Not found', { status: 404 });
    } catch (e) {
      return new Response(String(e.message || e), { status: 500 });
    }
  };
}

module.exports = { makeHandler, serveFile };
