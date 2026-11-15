// Internet radio through the open Radio Browser directory (radio-browser.info): no account or key.
// Also reads "now playing" titles from streams that send ICY metadata.
const UA = 'Zudio/0.1 ( local music player )';
const SERVERS = ['https://de1.api.radio-browser.info', 'https://nl1.api.radio-browser.info', 'https://at1.api.radio-browser.info', 'https://fi1.api.radio-browser.info'];
let server = null;

async function api(pathAndQuery) {
  const order = server ? [server, ...SERVERS.filter((s) => s !== server)] : SERVERS;
  let last;
  for (const s of order) {
    try {
      const r = await fetch(s + pathAndQuery, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
      if (!r.ok) throw new Error(String(r.status));
      server = s;
      return await r.json();
    } catch (e) { last = e; }
  }
  throw last || new Error('Radio directory unreachable');
}

// Streams Chromium can play directly: plain MP3 / AAC / Ogg, not HLS playlists.
const PLAYABLE = /^(mp3|aac|aac\+|ogg|opus|flac)$/i;
function clean(list) {
  const seen = new Set();
  return (list || [])
    .filter((s) => s.url_resolved && !s.hls && (!s.codec || PLAYABLE.test(s.codec)) && s.lastcheckok !== 0)
    .filter((s) => { const k = s.name.trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .map((s) => ({
      id: s.stationuuid, name: s.name.trim(), url: s.url_resolved, favicon: s.favicon || '', homepage: s.homepage || '',
      tags: String(s.tags || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 4), country: s.countrycode || s.country || '',
      codec: s.codec || '', bitrate: s.bitrate || 0, votes: s.votes || 0
    }));
}

async function search({ q = '', tag = '', order = 'clickcount', limit = 60, country = '' } = {}) {
  const p = new URLSearchParams({ hidebroken: 'true', order, reverse: 'true', limit: String(limit) });
  if (q) p.set('name', q);
  if (tag) { p.set('tag', tag); p.set('tagExact', 'false'); }
  if (country) p.set('countrycode', country);
  return clean(await api(`/json/stations/search?${p}`));
}
async function genres() {
  const list = await api('/json/tags?order=stationcount&reverse=true&limit=40&hidebroken=true');
  return list.map((t) => ({ name: t.name, count: t.stationcount })).filter((t) => t.name.length < 20);
}
// Radio Browser asks apps to report plays; it keeps the popular list honest.
function clicked(id) { api(`/json/url/${encodeURIComponent(id)}`).catch(() => {}); }

// Read one ICY metadata block ("StreamTitle='Artist - Song';") from a stream, then hang up.
async function nowPlaying(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(url, { headers: { 'Icy-MetaData': '1', 'User-Agent': UA }, signal: ctrl.signal });
    const metaint = +r.headers.get('icy-metaint');
    const station = r.headers.get('icy-name') || '';
    if (!metaint || !r.body) { ctrl.abort(); return { title: '', station }; }
    const reader = r.body.getReader();
    let buf = Buffer.alloc(0);
    while (buf.length < metaint + 1 + 255 * 16) {
      const { value, done } = await reader.read();
      if (done) break;
      buf = Buffer.concat([buf, Buffer.from(value)]);
      if (buf.length > metaint) {
        const len = buf[metaint] * 16;
        if (buf.length >= metaint + 1 + len) {
          const meta = buf.subarray(metaint + 1, metaint + 1 + len).toString('utf8');
          const m = /StreamTitle='([^']*)'/.exec(meta);
          ctrl.abort();
          return { title: m ? m[1].trim() : '', station };
        }
      }
    }
    ctrl.abort();
    return { title: '', station };
  } catch {
    return { title: '', station: '' };
  } finally { clearTimeout(timer); }
}

module.exports = { search, genres, clicked, nowPlaying, clean };
