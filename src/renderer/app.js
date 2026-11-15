/* Main window. Owns playback; the mini player and tray send commands here. */
(() => {
  const api = window.api;
  const PRODUCT = api.product || { name: 'Zudio', skins: ['zune'], devices: true };
  const NAME = PRODUCT.name;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (sec) => {
    sec = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(sec / 60), s = sec % 60;
    return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  };
  const fmtLong = (sec) => {
    const m = Math.round((sec || 0) / 60);
    return m >= 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m} min`;
  };
  const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const shuffleArr = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const sortKey = (s) => String(s || '').replace(/^(the|a|an)\s+/i, '');
  const cmp = (a, b) => collator.compare(sortKey(a), sortKey(b));
  const normName = (s) => String(s || '').toLowerCase().trim();

  // ------------------------------------------------------------------ state
  let settings = {};
  let user = { recent: [], plays: {}, trackPlays: {}, playlists: [], session: null };
  const LIB = { tracks: new Map(), albums: new Map(), artists: new Map(), genres: new Map(), roots: [], scanning: null, artBusy: false, loaded: false };

  const audio = new Audio();
  audio.preload = 'auto';
  audio.crossOrigin = 'anonymous';   // lets Music mode read the audio for visualizers
  const P = {
    queue: [], index: -1, unshuffled: null,
    playing: false, shuffle: false, repeat: 'off',
    loadedId: null, pendingSeek: 0, resumeTime: 0, context: null
  };
  const cur = () => P.queue[P.index] || null;

  // ------------------------------------------------------------------ the library (from the main process)
  function setLibrary(snap) {
    LIB.tracks = new Map(snap.tracks.map((t) => [t.id, t]));
    LIB.albums = new Map(snap.albums.map((a) => [a.id, a]));
    LIB.roots = snap.roots || [];
    LIB.scanning = snap.scanning || null;
    LIB.artBusy = !!snap.artBusy;
    LIB.loaded = true;
    // artists: by album artist, plus albums they only appear on
    const artists = new Map();
    const artistOf = (name) => {
      const k = normName(name);
      if (!artists.has(k)) artists.set(k, { key: k, name, albums: [], appears: new Set(), tracks: 0 });
      return artists.get(k);
    };
    for (const a of LIB.albums.values()) if (!a.offline) artistOf(a.artist).albums.push(a);
    for (const t of LIB.tracks.values()) {
      if (t.offline) continue;
      const ar = artistOf(t.artist);
      ar.tracks++;
      if (t.albumId && normName(t.albumArtist) !== ar.key) ar.appears.add(t.albumId);
    }
    for (const ar of artists.values()) {
      ar.albums.sort((x, y) => (y.year || 0) - (x.year || 0));
      ar.appears = [...ar.appears].map((id) => LIB.albums.get(id)).filter(Boolean);
    }
    LIB.artists = artists;
    const genres = new Map();
    for (const a of LIB.albums.values()) {
      if (a.offline) continue;
      const g = a.genre || 'Unknown genre';
      if (!genres.has(g)) genres.set(g, []);
      genres.get(g).push(a);
    }
    LIB.genres = genres;
    // refresh art on tracks already queued
    for (const q of P.queue) { const a = LIB.albums.get(q.albumId); if (a) { q.art = a.art || null; q.artLarge = a.artLarge || null; } }
  }
  const albumsList = () => [...LIB.albums.values()].filter((a) => !a.offline);
  const albumTracks = (a) => a.trackIds.map((id) => LIB.tracks.get(id)).filter(Boolean);
  const artistByName = (name) => LIB.artists.get(normName(name)) || null;
  const artistArt = (ar) => (ar.albums.find((a) => a.art) || ar.appears.find((a) => a.art) || {}).art || null;

  // A library track, ready for the queue.
  function qTrack(t) {
    const a = t.albumId ? LIB.albums.get(t.albumId) : null;
    return {
      id: t.id, title: t.title, artist: t.artist, album: t.album || (a && a.title) || '', albumId: t.albumId || null, albumArtist: t.albumArtist || t.artist,
      year: t.year || (a && a.year) || null,
      art: (a && a.art) || t.art || null, artLarge: (a && a.artLarge) || t.artLarge || null, duration: t.duration || 0,
      codec: t.codec, lossless: t.lossless, bits: t.bits, sampleRate: t.sampleRate, bitrate: t.bitrate, path: t.path,
      stream: `media://track/${t.id}`
    };
  }
  const formatOf = (t) => {
    if (!t || !t.codec) return '';
    if (t.lossless) return `${t.codec}${t.bits ? ` ${t.bits}-bit` : ''}${t.sampleRate ? `/${+(t.sampleRate / 1000).toFixed(1)} kHz` : ''}`;
    return `${t.codec}${t.bitrate ? ` ${Math.round(t.bitrate / 1000)} kbps` : ''}`;
  };

  // ------------------------------------------------------------------ persistence (plays, playlists, queue)
  const saveUser = debounce(() => {
    const t = cur();
    user.session = P.queue.length ? {
      queue: P.queue.filter((q) => !q.radio).map((q) => ({ id: q.id, path: q.path, title: q.title, artist: q.artist, album: q.album, duration: q.duration })),
      index: P.index,
      time: t && P.loadedId === t.id ? audio.currentTime : P.resumeTime,
      shuffle: P.shuffle, repeat: P.repeat, context: P.context
    } : null;
    api.user.save(user);
  }, 800);
  const saveLib = saveUser;
  const saveVolume = debounce((v) => api.settings.set({ volume: v }), 500);

  function recordRecent(t) {
    if (!t || !t.albumId) return;
    user.recent = [t.albumId, ...user.recent.filter((r) => r !== t.albumId)].slice(0, 24);
    saveUser();
  }

  // ------------------------------------------------------------------ playback
  function setQueue(tracks, startIndex = 0, context = null) {
    P.queue = tracks.slice();
    P.unshuffled = null;
    P.context = context;
    P.index = Math.max(0, Math.min(startIndex, P.queue.length - 1));
    if (P.shuffle) applyShuffle();
    load(P.index, true);
    if (!$('#nowPlaying').hidden) renderNowPlaying();
  }

  function load(i, autoplay = true, startAt = 0) {
    const t = P.queue[i];
    if (!t) return;
    P.index = i;
    P.loadedId = t.id;
    t._counted = false;
    P.pendingSeek = startAt;
    P.resumeTime = 0;
    audio.src = t.stream;
    if (autoplay) audio.play().catch(() => {});
    onTrackChange();
    if (!t.radio) loadPeaks(t);
    watchRadio();
  }

  function play() {
    const t = cur();
    if (!t) { if (P.queue.length) load(0); return; }
    if (P.loadedId !== t.id) { load(P.index, true, P.resumeTime); return; }
    audio.play().catch(() => {});
  }
  const pause = () => audio.pause();
  const toggle = () => (audio.paused ? play() : pause());

  function next(auto = false) {
    if (!P.queue.length) return;
    if (auto && P.repeat === 'one') { audio.currentTime = 0; play(); return; }
    if (P.index < P.queue.length - 1) load(P.index + 1);
    else if (P.repeat === 'all') load(0);
    else if (auto) { pause(); audio.currentTime = 0; }
    else load(0, false);
  }
  function prev() {
    if (audio.currentTime > 3 || P.index <= 0) { audio.currentTime = 0; play(); return; }
    load(P.index - 1);
  }
  function seek(sec) {
    const t = cur();
    if (!t) return;
    if (P.loadedId !== t.id) { P.resumeTime = sec; play(); return; }
    audio.currentTime = Math.max(0, Math.min(sec, duration()));
    updateProgress();
  }
  const duration = () => (isFinite(audio.duration) && audio.duration) || (cur() && cur().duration) || 0;
  const position = () => { const t = cur(); return t && P.loadedId === t.id ? audio.currentTime : P.resumeTime; };

  function setVolume(v) {
    v = Math.max(0, Math.min(1, v));
    audio.volume = v;
    audio.muted = false;
    settings.volume = v;
    saveVolume(v);
    updateProgress();
    emitState();
  }
  function toggleMute() { audio.muted = !audio.muted; renderChrome(); emitState(); }

  function applyShuffle() {
    const c = cur();
    P.unshuffled = P.queue.slice();
    const rest = shuffleArr(P.queue.filter((t) => t !== c));
    P.queue = c ? [c, ...rest] : rest;
    P.index = c ? 0 : -1;
  }
  function toggleShuffle() {
    P.shuffle = !P.shuffle;
    if (P.queue.length) {
      if (P.shuffle) applyShuffle();
      else if (P.unshuffled) {
        const c = cur();
        const extra = P.queue.filter((t) => !P.unshuffled.includes(t));
        P.queue = [...P.unshuffled, ...extra];
        P.index = Math.max(0, P.queue.indexOf(c));
        P.unshuffled = null;
      }
    }
    renderChrome(); renderNowPlayingIfOpen(); emitState(); saveLib();
  }
  function cycleRepeat() {
    P.repeat = { off: 'all', all: 'one', one: 'off' }[P.repeat];
    renderChrome(); emitState(); saveLib();
  }

  function playNext(tracks) {
    tracks = tracks.filter((t) => t.stream);
    if (!tracks.length) return;
    if (!P.queue.length) return setQueue(tracks, 0);
    P.queue.splice(P.index + 1, 0, ...tracks.map((t) => ({ ...t })));
    toast(tracks.length > 1 ? `${plural(tracks.length, 'song')} will play next` : `“${tracks[0].title}” will play next`);
    renderNowPlayingIfOpen(); emitState(); saveLib();
  }
  function addToQueue(tracks) {
    tracks = tracks.filter((t) => t.stream);
    if (!tracks.length) return;
    if (!P.queue.length) return setQueue(tracks, 0);
    P.queue.push(...tracks.map((t) => ({ ...t })));
    toast(tracks.length > 1 ? `Added ${plural(tracks.length, 'song')} to your queue` : `Added “${tracks[0].title}” to your queue`);
    renderNowPlayingIfOpen(); emitState(); saveLib();
  }
  function removeFromQueue(i) {
    if (i === P.index) return;
    P.queue.splice(i, 1);
    if (i < P.index) P.index--;
    renderNowPlayingIfOpen(); emitState(); saveLib();
  }

  function playAlbum(a, startIndex = 0, shuffled = false) {
    const tracks = albumTracks(a).map(qTrack);
    if (!tracks.length) { toast('That album isn’t available right now'); return; }
    if (shuffled && !P.shuffle) P.shuffle = true;
    const idx = shuffled ? Math.floor(Math.random() * tracks.length) : Math.max(0, Math.min(startIndex, tracks.length - 1));
    setQueue(tracks, idx, { title: a.title, albumId: a.id });
  }
  function playTracks(list, idx = 0, context = null, shuffled = false) {
    const tracks = list.map((t) => (t.stream ? { ...t } : qTrack(t)));
    if (!tracks.length) return;
    if (shuffled && !P.shuffle) P.shuffle = true;
    setQueue(tracks, shuffled ? Math.floor(Math.random() * tracks.length) : idx, context);
  }
  function artistTracks(ar) {
    const ids = new Set();
    const out = [];
    for (const a of ar.albums) for (const t of albumTracks(a)) if (!ids.has(t.id)) { ids.add(t.id); out.push(t); }
    for (const a of ar.appears) for (const t of albumTracks(a)) if (normName(t.artist) === ar.key && !ids.has(t.id)) { ids.add(t.id); out.push(t); }
    return out;
  }
  // play an album or artist from a card / link
  function playItem(id, kind) {
    if (kind === 'artist') {
      const ar = artistByName(id);
      if (ar) playTracks(artistTracks(ar), 0, { title: ar.name, artist: ar.name });
      return;
    }
    if (kind === 'genre') {
      const list = LIB.genres.get(id) || [];
      playTracks(list.flatMap(albumTracks), 0, { title: id }, true);
      return;
    }
    const a = LIB.albums.get(id);
    if (a) playAlbum(a);
  }
  function queueItem(id, kind, mode) {
    const tracks = kind === 'artist' ? artistTracks(artistByName(id) || { albums: [], appears: [] }) : albumTracks(LIB.albums.get(id) || { trackIds: [] });
    const q = tracks.map(qTrack);
    mode === 'next' ? playNext(q) : addToQueue(q);
  }

  audio.addEventListener('error', () => {
    const t = cur();
    if (!t || !audio.src) return;
    // Last resort: if cross-origin access failed, play without visualizer data.
    if (audio.crossOrigin && !analyser && !t._noCors) {
      t._noCors = true;
      audio.crossOrigin = null;
      load(P.index, true, P.pendingSeek || P.resumeTime || 0);
      return;
    }
    toast(t.radio ? `“${t.title}” isn’t answering right now` : `Couldn’t play “${t.title}”. The file may have moved, or its drive is unplugged.`);
    setTimeout(() => next(true), 1500);
  });
  // converting an unusual format takes a moment the first time
  let waitTimer = null;
  audio.addEventListener('loadstart', () => {
    clearTimeout(waitTimer);
    const t = cur();
    if (t && LIB.tracks.get(t.id) && LIB.tracks.get(t.id).native === false) waitTimer = setTimeout(() => toast(`Preparing ${t.codec || 'this'} file for playback…`), 700);
  });
  audio.addEventListener('canplay', () => clearTimeout(waitTimer));
  audio.addEventListener('loadedmetadata', () => {
    if (P.pendingSeek) { audio.currentTime = P.pendingSeek; P.pendingSeek = 0; }
    updateProgress();
  });
  audio.addEventListener('play', () => { P.playing = true; document.documentElement.classList.add('is-playing'); renderChrome(); emitState(); });
  audio.addEventListener('pause', () => { P.playing = false; document.documentElement.classList.remove('is-playing'); renderChrome(); emitState(); saveLib(); });
  audio.addEventListener('ended', () => next(true));
  audio.addEventListener('timeupdate', () => {
    const t = cur();
    if (t && !t.radio && !t._counted && audio.currentTime > 30) { t._counted = true; countPlay(t); }
    updateProgress(); emitStateThrottled();
  });
  setInterval(() => { if (P.playing) saveLib(); }, 15000);

  function onTrackChange() {
    const t = cur();
    renderChrome();
    renderNowPlayingIfOpen();
    highlightRows();
    renderNav();
    emitState();
    saveLib();
    if (!t) return;
    recordRecent(t);
    tintFrom(t.art);
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title, artist: t.artist, album: t.album,
        artwork: [t.art && { src: t.art, sizes: '350x350', type: 'image/jpeg' }, t.artLarge && { src: t.artLarge, sizes: '700x700', type: 'image/jpeg' }].filter(Boolean)
      });
    }
  }
  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', play);
    ms.setActionHandler('pause', pause);
    ms.setActionHandler('previoustrack', prev);
    ms.setActionHandler('nexttrack', () => next());
    try { ms.setActionHandler('seekto', (d) => seek(d.seekTime)); } catch {}
  }

  // ------------------------------------------------------------------ state for the mini player
  function snapshot() {
    const t = cur();
    return {
      peaks: peaksFor(t),
      track: t ? { id: t.id, title: t.title, artist: t.artist, album: t.album, art: t.art, artLarge: t.artLarge, duration: duration(), albumId: t.albumId, format: formatOf(t), radio: !!t.radio, station: t.station || null, nowTitle: t.nowTitle || '' } : null,
      radioQueue: t && t.radio ? P.queue.filter((q) => q.radio).slice(0, 120).map((q) => q.station) : null,
      playing: P.playing,
      time: position(),
      duration: duration(),
      shuffle: P.shuffle,
      repeat: P.repeat,
      volume: audio.volume,
      muted: audio.muted,
      index: P.index,
      queueLength: P.queue.length,
      queueDuration: P.queue.reduce((a, q) => a + (q.duration || 0), 0),
      loved: t ? loved(t.id) : false,
      queue: P.queue.slice(Math.max(0, P.index - 50), P.index + 250).map((q, k) => ({ i: Math.max(0, P.index - 50) + k, title: q.title, artist: q.artist })),
      upNext: P.queue.slice(Math.max(0, P.index), P.index + 12).map((q, k) => ({
        i: Math.max(0, P.index) + k, title: q.title, artist: q.artist, duration: q.duration, art: q.art
      }))
    };
  }
  const emitState = () => api.player.sendState(snapshot());
  let lastEmit = 0;
  function emitStateThrottled() {
    const now = Date.now();
    if (now - lastEmit > 300) { lastEmit = now; emitState(); }
  }

  api.player.onCommand((cmd, arg) => {
    switch (cmd) {
      case 'toggle': toggle(); break;
      case 'play': play(); break;
      case 'pause': pause(); break;
      case 'next': next(); break;
      case 'prev': prev(); break;
      case 'seek': seek(+arg); break;
      case 'seekRatio': seek(+arg * duration()); break;
      case 'volume': setVolume(+arg); break;
      case 'mute': toggleMute(); break;
      case 'shuffle': toggleShuffle(); break;
      case 'repeat': cycleRepeat(); break;
      case 'playIndex': if (P.queue[arg]) load(+arg); break;
      case 'sync': emitState(); break;
      case 'stop': pause(); seek(0); break;
      case 'rew': seek(Math.max(0, position() - 10)); break;
      case 'ffwd': seek(Math.min(duration() - 1, position() + 10)); break;
      // the pocket player can drive the whole library
      case 'love': toggleLove(cur()); emitState(); break;
      case 'playAlbum': { const a = LIB.albums.get(arg.id); if (a) playAlbum(a, arg.index || 0, !!arg.shuffle); break; }
      case 'playTracks': { const list = (arg.ids || []).map((id) => LIB.tracks.get(id)).filter(Boolean); if (list.length) playTracks(list, Math.min(arg.index || 0, list.length - 1), { title: arg.title || 'Mini player' }, !!arg.shuffle); break; }
      case 'queueTracks': { const list = (arg.ids || []).map((id) => LIB.tracks.get(id)).filter(Boolean).map(qTrack); arg.next ? playNext(list) : addToQueue(list); break; }
      case 'removeQueue': removeFromQueue(+arg); break;
      case 'pin': { const a = LIB.albums.get(arg); if (a) togglePin(a); break; }
      case 'shuffleAll': playTracks([...LIB.tracks.values()].filter((x) => !x.offline), 0, { title: 'Everything' }, true); break;
      case 'musicmode': api.win.showMain(); openMusicMode(); break;
      case 'savequeue': {
        if (typeof arg === 'string' && arg) {
          const pl = { id: newId(), name: arg, tracks: P.queue.filter((q) => !q.radio).map(plEntry), created: Date.now() };
          user.playlists = [...(user.playlists || []), pl]; saveUser(); renderNav();
        } else newPlaylist(P.queue);
        break;
      }
      case 'vizStream': setVizStream(!!arg); break;
      // playlists, edited from the pocket player
      case 'playlistCreate': {
        const tr = (arg.ids || []).map((id) => LIB.tracks.get(id)).filter(Boolean);
        user.playlists = [...(user.playlists || []), { id: newId(), name: String(arg.name).slice(0, 60), tracks: tr.map(plEntry), created: Date.now() }];
        saveUser(); api.user.save(user); renderNav(); break;
      }
      case 'playlistRename': { const pl = getPlaylist(arg.id); if (pl && arg.name) { pl.name = String(arg.name).slice(0, 60); saveUser(); api.user.save(user); renderNav(); if (route().route === 'playlist') render(true); } break; }
      case 'playlistDelete': { user.playlists = (user.playlists || []).filter((p) => p.id !== arg); saveUser(); api.user.save(user); renderNav(); if (route().route === 'playlist' && route().params.id === arg) go('home'); break; }
      case 'playlistAdd': { const pl = getPlaylist(arg.id); if (pl) { pl.tracks.push(...(arg.ids || []).map((id) => LIB.tracks.get(id)).filter(Boolean).map(plEntry)); saveUser(); api.user.save(user); renderNav(); } break; }
      case 'playlistRemove': { const pl = getPlaylist(arg.id); if (pl) { pl.tracks.splice(+arg.index, 1); saveUser(); api.user.save(user); renderNav(); } break; }
      case 'playRadio': playRadio(arg.stations || [], arg.index || 0); break;
    }
  });

  // ------------------------------------------------------------------ album-art tint for the player bar
  const tintCache = new Map();
  function tintFrom(url) {
    if (!url) return setTint(null);
    if (tintCache.has(url)) return setTint(tintCache.get(url));
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 24;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, 24, 24);
        const d = ctx.getImageData(0, 0, 24, 24).data;
        let r = 0, g = 0, b = 0, w = 0;
        for (let i = 0; i < d.length; i += 4) {
          const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
          const weight = 1 + (mx - mn) / 40;             // favour colourful pixels
          r += d[i] * weight; g += d[i + 1] * weight; b += d[i + 2] * weight; w += weight;
        }
        const rgb = [r / w, g / w, b / w];
        tintCache.set(url, rgb);
        setTint(rgb);
      } catch { setTint(null); }
    };
    img.onerror = () => setTint(null);
    img.src = url;
  }
  function setTint(rgb) {
    const root = document.documentElement.style;
    if (!rgb) { root.removeProperty('--tint'); root.removeProperty('--tint-dark'); return; }
    const [h, s] = rgbToHsl(...rgb);
    const top = hslToRgb(h, Math.min(s, 0.55), 0.3);
    const bottom = hslToRgb(h, Math.min(s, 0.5), 0.12);
    root.setProperty('--tint', top.map(Math.round).join(' '));
    root.setProperty('--tint-dark', bottom.map(Math.round).join(' '));
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
  }
  function hslToRgb(h, s, l) {
    const f = (n) => { const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); };
    return [f(0), f(8), f(4)];
  }

  // ------------------------------------------------------------------ waveform scrubber
  const WAVE_BINS = 96;
  const peaksCache = new Map();
  function pseudoPeaks(seed) {
    let h = 2166136261;
    for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    const rnd = () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
    const out = [];
    let v = 0.55;
    for (let i = 0; i < WAVE_BINS; i++) {
      v = Math.max(0.22, Math.min(1, v + (rnd() - 0.5) * 0.45));
      out.push(+(v * (0.7 + rnd() * 0.3)).toFixed(2));
    }
    return out;
  }
  const peaksFor = (t) => (t ? peaksCache.get(t.id) || pseudoPeaks(t.id) : new Array(WAVE_BINS).fill(0.12));
  let waveJob = null;
  // Builds a real waveform from the stream in the background; the placeholder shows until it's ready.
  async function loadPeaks(t) {
    if (!t || api.mock || peaksCache.has(t.id) || waveJob === t.id) return;
    waveJob = t.id;
    try {
      const p = await api.lib.peaks(t.id);
      if (!p) return;
      peaksCache.set(t.id, p);
      if (peaksCache.size > 120) peaksCache.delete(peaksCache.keys().next().value);
      if (cur() && cur().id === t.id) { renderChrome(); renderNowPlayingIfOpen(); emitState(); }
    } catch { /* keep the placeholder */ }
    finally { if (waveJob === t.id) waveJob = null; }
  }
  function wavePath(peaks) {
    const step = 100 / peaks.length, w = step * 0.56;
    return peaks.map((p, i) => {
      const h = Math.max(0.8, p * 20);
      return `M${(i * step + (step - w) / 2).toFixed(2)} ${((20 - h) / 2).toFixed(2)}h${w.toFixed(2)}v${h.toFixed(2)}h-${w.toFixed(2)}z`;
    }).join('');
  }
  function wave(ratio, cls = '') {
    const d = wavePath(peaksFor(cur()));
    const pct = Math.max(0, Math.min(1, ratio)) * 100;
    return `<div class="slider wave ${cls}" data-slider="seek">
      <svg class="w-base" viewBox="0 0 100 20" preserveAspectRatio="none"><path d="${d}"/></svg>
      <svg class="w-played" viewBox="0 0 100 20" preserveAspectRatio="none" style="clip-path:inset(0 ${(100 - pct).toFixed(2)}% 0 0)"><path d="${d}"/></svg>
      <div class="knob" style="left:${pct.toFixed(2)}%"></div></div>`;
  }

  // ------------------------------------------------------------------ heavy rotation (play counts)
  function countPlay(t) {
    user.trackPlays = user.trackPlays || {};
    user.trackPlays[t.id] = (user.trackPlays[t.id] || 0) + 1;
    if (t.albumId) {
      const e = user.plays[t.albumId] || { count: 0 };
      e.count++;
      e.last = Date.now();
      user.plays[t.albumId] = e;
    }
    saveUser();
  }
  function heavyRotation() {
    const now = Date.now();
    return Object.entries(user.plays || {})
      .map(([id, e]) => ({ album: LIB.albums.get(id), count: e.count, score: e.count / (1 + (now - (e.last || now)) / (14 * 864e5)) }))
      .filter((x) => x.album && !x.album.offline)
      .sort((x, y) => y.score - x.score)
      .slice(0, 30);
  }
  function playStation() {
    const items = heavyRotation().slice(0, 12);
    if (!items.length) return toast('Play a few records first, then the station has something to work with');
    const tracks = shuffleArr(items.flatMap((i) => albumTracks(i.album)));
    setQueue(tracks.slice(0, 150).map(qTrack), 0, { title: 'Heavy Rotation station' });
  }

  // ------------------------------------------------------------------ the bottom player bar, per skin
  const skin = () => (PRODUCT.skins.includes(settings.skin) ? settings.skin : PRODUCT.skins[0]);
  function barHtml(t, playIc, vol, ratio, npOpen) {
    const s = skin();
    const albumLink = (txt) => (t ? `<a data-open="${esc(t.albumId || '')}" data-kind="album">${esc(txt)}</a>` : '');
    const artistLink = (txt) => (t ? `<a data-open="${esc(t.artist)}" data-kind="artist">${esc(txt)}</a>` : '');
    const widgetOn = settings.widget && settings.widget.open ? 'on' : '';
    if (s === 'zune') {
      const vol100 = Math.round(vol * 100);
      return `
        <div class="zb-left">
          <button class="z-ic ${widgetOn}" data-act="widget" title="Mini player">${icon('widget')}</button>
          <button class="z-ic ${npOpen ? 'on' : ''}" data-act="nowplaying" title="Now playing">${icon('disc')}</button>
          <button class="z-ic" data-route="playlists" title="Playlists">${icon('queue')}</button>
        </div>
        <div class="zb-mid">
          <div class="zb-art" data-act="nowplaying">${t && t.art ? `<img src="${esc(t.art)}" alt="">` : ''}</div>
          <div class="zb-info">
            <div class="zb-top"><span class="ell">${t ? albumLink(t.title) : ''}</span>${t ? `<button class="z-heart ${loved(t.id) ? 'on' : ''}" data-act="love" title="Love this song">${icon('heart')}</button>` : ''}</div>
            ${slider('seek', ratio)}
            <div class="zb-times"><span class="js-time">${fmt(position())}</span><span class="js-time-left">${t ? '-' + fmt(duration() - position()) : ''}</span></div>
          </div>
        </div>
        <div class="zb-right">
          <div class="znp-btns">
            <button class="z-ic ${P.repeat !== 'off' ? 'on' : ''}" data-act="repeat" title="Repeat">${repeatIcon()}</button>
            <button class="z-ic ${P.shuffle ? 'on' : ''}" data-act="shuffle" title="Shuffle">${icon('shuffle')}</button>
            <button class="z-circ" data-act="prev" title="Previous">${icon('prev')}</button>
            <button class="z-circ big" data-act="toggle" title="Play/Pause">${playIc}</button>
            <button class="z-circ" data-act="next" title="Next">${icon('next')}</button>
            <button class="z-ic on" data-act="musicmode" title="Visualizers (M)">${icon('nowPlaying')}</button>
          </div>
          <div class="z-vol" data-zvol title="Scroll to change the volume, click to mute">${audio.muted ? 'MUTED' : `VOLUME ${vol100}`}</div>
        </div>`;
    }
    if (s === 'wmp') {
      return `
        <div class="wb-seek">${slider('seek', ratio)}</div>
        <div class="wb-left">
          <div class="wb-art" data-act="nowplaying">${t && t.art ? `<img src="${esc(t.art)}" alt="">` : icon('disc')}</div>
          <div class="wb-meta">${t ? `<div class="wb-t ell">${albumLink(t.title)}</div><div class="wb-a ell">${artistLink(t.artist)}</div>` : '<div class="wb-t">Ready</div>'}
            <div class="wb-time"><span class="js-time">${fmt(position())}</span> / <span class="js-dur">${fmt(duration())}</span></div></div>
        </div>
        <div class="wb-center">
          <button class="wb-sm ${P.shuffle ? 'on' : ''}" data-act="shuffle" title="Shuffle">${icon('shuffle')}</button>
          <button class="wb-sm ${P.repeat !== 'off' ? 'on' : ''}" data-act="repeat" title="Repeat">${repeatIcon()}</button>
          <span class="wb-gap"></span>
          <button class="wb-btn" data-act="stop" title="Stop">${icon('stop')}</button>
          <button class="wb-btn" data-act="prev" title="Previous">${icon('prev')}</button>
          <button class="wb-orb" data-act="toggle" title="Play/Pause">${playIc}</button>
          <button class="wb-btn" data-act="next" title="Next">${icon('next')}</button>
          <span class="wb-gap"></span>
          <button class="wb-sm" data-act="mute" title="Mute">${icon(vol ? 'volume' : 'mute')}</button>
          <div class="wb-vol">${slider('volume', vol)}</div>
        </div>
        <div class="wb-right">
          <button class="wb-sm" data-act="musicmode" title="Visualizations (M)">${icon('nowPlaying')}</button>
          <button class="wb-sm ${widgetOn}" data-act="widget" title="Switch to mini player">${icon('widget')}</button>
          <button class="wb-sm ${npOpen ? 'on' : ''}" data-act="nowplaying" title="Now Playing">${icon('queue')}</button>
        </div>`;
    }
    return `
      <div class="pb-left">
        <button data-act="prev" title="Previous">${icon('prev')}</button>
        <button class="pb-play" data-act="toggle" title="Play/Pause">${playIc}</button>
        <button data-act="next" title="Next">${icon('next')}</button>
      </div>
      <div class="pb-center">
        <div class="pb-title ell">${t ? `${albumLink(t.title)} — ${artistLink(t.artist)}` : '&nbsp;'}</div>
        <div class="pb-row">
          <button class="${P.shuffle ? 'on' : ''}" data-act="shuffle" title="Shuffle">${icon('shuffle')}</button>
          <span class="js-time">${fmt(position())}</span>
          ${wave(ratio, 'bar-wave')}
          <span class="js-dur">${fmt(duration())}</span>
          <button class="${P.repeat !== 'off' ? 'on' : ''}" data-act="repeat" title="Repeat">${repeatIcon()}</button>
        </div>
      </div>
      <div class="pb-right">
        <div class="pb-vol"><button data-act="mute" title="Mute">${icon(vol ? 'volume' : 'mute')}</button>${slider('volume', vol)}</div>
        <button class="${widgetOn}" data-act="widget" title="Mini player">${icon('widget')}</button>
        <button class="${npOpen ? 'on' : ''}" data-act="nowplaying" title="Queue">${icon('queue')}</button>
        <div class="pb-thumb" data-act="nowplaying">${t && t.art ? `<img src="${esc(t.art)}" alt="">` : ''}</div>
      </div>`;
  }

  // ------------------------------------------------------------------ player chrome
  function slider(kind, ratio) {
    const p = `${(Math.max(0, Math.min(1, ratio)) * 100).toFixed(2)}%`;
    return `<div class="slider" data-slider="${kind}"><div class="rail"><div class="fill" style="width:${p}"></div></div><div class="knob" style="left:${p}"></div></div>`;
  }
  const repeatIcon = () => icon(P.repeat === 'one' ? 'repeatOne' : 'repeat');

  function renderChrome() {
    const t = cur();
    if (MM.open) renderMusicHud();
    const playIc = icon(P.playing ? 'pause' : 'play');
    const vol = audio.muted ? 0 : audio.volume;
    const ratio = duration() ? position() / duration() : 0;
    const npOpen = !$('#nowPlaying').hidden;
    // keep Now Playing's play/pause button in sync without redrawing it (so the record can slide in and out)
    for (const b of document.querySelectorAll('#nowPlaying [data-act="toggle"]')) b.innerHTML = playIc;

    // classic side player
    $('#sidePlayer').innerHTML = `
      <div class="sp-art" data-act="nowplaying" title="Now playing">
        ${t && t.art ? `<img src="${esc(t.artLarge || t.art)}" alt="">` : `<div class="sp-empty">${icon('disc')}</div>`}
      </div>
      <div class="sp-controls">
        <button class="sp-btn" data-act="prev" title="Previous">${icon('prev')}</button>
        <button class="sp-btn big" data-act="toggle" title="Play/Pause">${playIc}</button>
        <button class="sp-btn" data-act="next" title="Next">${icon('next')}</button>
        <button class="sp-btn sq ${npOpen ? 'on' : ''}" data-act="nowplaying" title="Queue">${icon('queue')}</button>
      </div>
      <div class="sp-meta">
        ${t ? `<div class="sp-title ell"><a data-open="${esc(t.albumId || '')}" data-kind="album">${esc(t.title)}</a></div>
               <div class="sp-sub ell"><a data-open="${esc(t.artist)}" data-kind="artist">${esc(t.artist)}</a></div>
               <div class="sp-sub ell"><a data-open="${esc(t.albumId || '')}" data-kind="album">${esc(t.album)}</a></div>`
            : `<div class="sp-title">Nothing playing</div><div class="sp-sub">Pick an album, or drop music on the window.</div>`}
      </div>
      <div class="sp-progress">${wave(ratio)}<span class="js-time-left">${fmt(t ? duration() - position() : 0)}</span></div>
      <div class="sp-foot">
        <button data-act="mute" title="Mute">${icon(vol ? 'volume' : 'mute')}</button>
        ${slider('volume', vol)}
        <button class="${P.shuffle ? 'on' : ''}" data-act="shuffle" title="Shuffle">${icon('shuffle')}</button>
        <button class="${P.repeat !== 'off' ? 'on' : ''}" data-act="repeat" title="Repeat">${repeatIcon()}</button>
      </div>`;

    // the bottom bar (its look depends on the skin)
    $('#playerBar').innerHTML = barHtml(t, playIc, vol, ratio, npOpen);
  }

  let dragging = null;
  function updateProgress() {
    const d = duration(), p = position();
    const ratio = d ? p / d : 0;
    for (const s of $$('[data-slider="seek"]')) if (s !== dragging) setSlider(s, ratio);
    const vol = audio.muted ? 0 : audio.volume;
    for (const s of $$('[data-slider="volume"]')) if (s !== dragging) setSlider(s, vol);
    for (const el of $$('.js-time')) el.textContent = fmt(p);
    for (const el of $$('.js-dur')) el.textContent = fmt(d);
    for (const el of $$('.js-time-left')) el.textContent = cur() ? '-' + fmt(d - p) : '0:00';
  }
  function setSlider(s, r) {
    const p = `${(Math.max(0, Math.min(1, r)) * 100).toFixed(2)}%`;
    if (s.classList.contains('wave')) {
      s.querySelector('.w-played').style.clipPath = `inset(0 ${(100 - parseFloat(p)).toFixed(2)}% 0 0)`;
      s.querySelector('.knob').style.left = p;
      return;
    }
    s.querySelector('.fill').style.width = p;
    s.querySelector('.knob').style.left = p;
  }
  document.addEventListener('pointerdown', (e) => {
    const s = e.target.closest('[data-slider]');
    if (!s || e.button !== 0) return;
    e.preventDefault();
    dragging = s;
    s.classList.add('drag');
    s.setPointerCapture(e.pointerId);
    const ratioAt = (ev) => { const r = s.getBoundingClientRect(); return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)); };
    const apply = (ev, commit) => {
      const r = ratioAt(ev);
      setSlider(s, r);
      if (s.dataset.slider === 'volume') setVolume(r);
      else if (commit) seek(r * duration());
    };
    apply(e, false);
    const move = (ev) => apply(ev, false);
    const up = (ev) => {
      apply(ev, true);
      s.classList.remove('drag');
      dragging = null;
      s.removeEventListener('pointermove', move);
      s.removeEventListener('pointerup', up);
    };
    s.addEventListener('pointermove', move);
    s.addEventListener('pointerup', up);
  });

  // ------------------------------------------------------------------ now playing overlay
  function openNowPlaying() { $('#nowPlaying').hidden = false; document.documentElement.classList.add('np-open'); renderNowPlaying(); renderChrome(); renderNav(); }
  function closeNowPlaying() {
    if ($('#nowPlaying').hidden) return;
    if (npFull) { npFull = false; $('#nowPlaying').classList.remove('np-full'); api.win.fullscreen(false); }
    $('#nowPlaying').hidden = true; document.documentElement.classList.remove('np-open'); renderChrome(); renderNav();
  }
  const toggleNowPlaying = () => ($('#nowPlaying').hidden ? openNowPlaying() : closeNowPlaying());
  function renderNowPlayingIfOpen() { if (!$('#nowPlaying').hidden) renderNowPlaying(); }
  // ------------------------------------------------------------------ full screen Now Playing
  let npFull = false;
  async function setNpFull(on) {
    npFull = on;
    if (on && $('#nowPlaying').hidden) openNowPlaying();
    $('#nowPlaying').classList.toggle('np-full', on);
    await api.win.fullscreen(on);
    renderNowPlayingIfOpen();
  }

  // ------------------------------------------------------------------ audio analysis (for visualizers)
  let actx = null, analyser = null, freqData = null, waveData = null, bassAvg = 0.2, lastBeat = 0;
  const feat = { bass: 0, mid: 0, treble: 0, level: 0 };
  function ensureAnalyser() {
    if (analyser || api.mock || !audio.crossOrigin) return analyser;
    try {
      actx = new AudioContext();
      const src = actx.createMediaElementSource(audio);
      analyser = actx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.78;
      src.connect(analyser);
      analyser.connect(actx.destination);
      freqData = new Uint8Array(analyser.frequencyBinCount);
      waveData = new Uint8Array(analyser.fftSize);
    } catch { analyser = null; }
    return analyser;
  }
  const fakeFreq = new Uint8Array(1024), fakeWave = new Uint8Array(2048);
  function readAudio(time) {
    let freq, wave;
    if (analyser && audio.crossOrigin) {
      if (actx.state === 'suspended') actx.resume();
      analyser.getByteFrequencyData(freqData);
      analyser.getByteTimeDomainData(waveData);
      freq = freqData; wave = waveData;
    }
    // No real audio data (paused, preview, or no cross-origin access): a gentle simulated signal.
    if (!freq || (P.playing && !freq.some((v) => v > 0))) {
      const k = P.playing ? 1 : 0.06, beat = Math.pow(Math.max(0, Math.sin(time * 3.6)), 8);
      for (let i = 0; i < 1024; i++) {
        const f = i / 1024;
        fakeFreq[i] = Math.max(0, Math.min(255, k * 255 * (0.9 - f * 1.4) * (0.55 + 0.25 * Math.sin(time * 2.1 + i * 0.07) + 0.2 * Math.sin(time * 5.3 + i * 0.013) + beat * (f < 0.03 ? 0.6 : 0))));
      }
      for (let i = 0; i < 2048; i++) fakeWave[i] = 128 + k * 60 * (Math.sin(i * 0.031 + time * 4) * 0.6 + Math.sin(i * 0.11 - time * 7) * 0.3 * (0.5 + beat));
      freq = fakeFreq; wave = fakeWave;
    }
    const avg = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += freq[i]; return s / (b - a) / 255; };
    let rms = 0;
    for (let i = 0; i < wave.length; i += 4) { const v = (wave[i] - 128) / 128; rms += v * v; }
    const raw = { bass: avg(1, 10), mid: avg(10, 90), treble: avg(90, 380), level: Math.sqrt(rms / (wave.length / 4)) };
    // Smooth everything (quick to rise, slow to fall) so calm music stays calm.
    for (const k of Object.keys(raw)) {
      const v = raw[k];
      feat[k] += (v - feat[k]) * (v > feat[k] ? 0.35 : 0.08);
    }
    const beat = raw.bass > bassAvg * 1.5 && raw.bass > 0.45 && time - lastBeat > 0.28;
    if (beat) lastBeat = time;
    bassAvg += (raw.bass - bassAvg) * 0.04;
    return { freq, wave, ...feat, beat, sampleRate: actx ? actx.sampleRate : 44100 };
  }

  // ------------------------------------------------------------------ internet radio
  const radioTrack = (st) => ({
    id: 'radio:' + st.id, title: st.name, artist: 'Internet radio', album: [st.country, (st.tags || [])[0]].filter(Boolean).join(' · '),
    art: st.favicon || null, artLarge: st.favicon || null, duration: 0, radio: true, station: st,
    stream: `media://radio/?u=${encodeURIComponent(st.url)}`
  });
  function playRadio(stations, index) {
    if (!stations.length) return;
    playTracks(stations.map(radioTrack), Math.max(0, Math.min(index, stations.length - 1)), { title: 'Radio' });
  }
  // what the station says it's playing (ICY metadata), checked every 20 seconds
  let radioPoll = null;
  async function pollRadio() {
    const t = cur();
    if (!t || !t.radio) return;
    const r = await api.radio.nowPlaying(t.station.url).catch(() => null);
    if (cur() !== t || !r) return;
    const np = (r.title || '').trim();
    if (np !== (t.nowTitle || '')) { t.nowTitle = np; t.artist = np || 'Internet radio'; renderChrome(); renderNowPlayingIfOpen(); emitState(); }
  }
  function watchRadio() {
    clearInterval(radioPoll);
    const t = cur();
    if (t && t.radio) { api.radio.clicked(t.station.id); pollRadio(); radioPoll = setInterval(pollRadio, 20000); }
  }

  // the pocket player's visualizer gets the same audio analysis, ~30 times a second
  let vizStreamTimer = null;
  function setVizStream(on) {
    clearInterval(vizStreamTimer);
    vizStreamTimer = null;
    if (!on) return;
    ensureAnalyser();
    vizStreamTimer = setInterval(() => {
      const a = readAudio(performance.now() / 1000);
      const wave = new Array(1024);
      for (let i = 0; i < 1024; i++) wave[i] = a.wave[i * 2] || 128;
      api.player.sendViz({ freq: Array.from(a.freq.subarray ? a.freq.subarray(0, 1024) : a.freq.slice(0, 1024)), wave, bass: a.bass, mid: a.mid, treble: a.treble, level: a.level, beat: a.beat, sampleRate: a.sampleRate, tint: musicMeta().tint, spectrumTheme: settings.spectrumTheme || 'rdio' });
    }, 33);
  }

  // ------------------------------------------------------------------ Music mode (full-screen visualizers)
  const MM = { open: false, viz: null, vizId: null, raf: 0, last: 0, idle: 0, art: null, artUrl: null };
  function vizList() { return window.Visualizers || []; }
  function musicMeta() {
    const t = cur();
    if (t && t.art !== MM.artUrl) {
      MM.artUrl = t.art;
      MM.art = null;
      if (t.art) { const im = new Image(); im.crossOrigin = 'anonymous'; im.src = t.artLarge || t.art; MM.art = im; }
    }
    const tint = getComputedStyle(document.documentElement).getPropertyValue('--tint').trim().split(/\s+/).map(Number);
    return {
      title: t ? t.title : '', artist: t ? t.artist : '', album: t ? t.album : '', art: MM.art,
      progress: duration() ? position() / duration() : 0, playing: P.playing, spectrumTheme: settings.spectrumTheme || 'rdio',
      tint: tint.length === 3 && tint.every((v) => !isNaN(v)) && document.documentElement.style.getPropertyValue('--tint') ? tint : null
    };
  }
  function setViz(id) {
    const list = vizList();
    const v = list.find((x) => x.id === id) || list[0];
    if (!v) return;
    if (MM.viz) { try { MM.viz.destroy(); } catch {} }
    // a fresh canvas each time: a canvas can't switch between 2D and WebGL
    const old = $('#mmCanvas');
    const c = document.createElement('canvas');
    c.id = 'mmCanvas';
    old.replaceWith(c);
    MM.viz = v.create(c);
    MM.vizId = v.id;
    $('#mmName').textContent = v.name;
    if (settings.visualizer !== v.id) api.settings.set({ visualizer: v.id }).then((s) => { settings = s; });
  }
  function cycleViz(dir) {
    const list = vizList();
    const i = list.findIndex((v) => v.id === MM.vizId);
    setViz(list[(i + dir + list.length) % list.length].id);
    wakeHud();
  }
  function renderVizList() {
    const el = $('#mmList');
    if (!el) return;
    const groups = {};
    for (const v of vizList()) (groups[v.group || 'More'] ||= []).push(v);
    const themes = window.SpectrumThemes || {};
    el.innerHTML = Object.entries(groups).map(([g, vs]) => `
      <div class="mm-group"><h6>${esc(g)}</h6>${vs.map((v) => `<button data-viz="${v.id}" class="${v.id === MM.vizId ? 'on' : ''}">${esc(v.name)}</button>`).join('')}</div>`).join('') +
      (MM.vizId === 'spectrum' ? `<div class="mm-group mm-themes"><h6>Spectrum colours</h6>${Object.entries(themes).map(([k, th]) => `
        <button data-spec="${k}" class="${(settings.spectrumTheme || 'rdio') === k ? 'on' : ''}"><i style="background:${th.rainbow ? 'linear-gradient(90deg,#f43f5e,#f59e0b,#22c55e,#3b82f6,#a855f7)' : `linear-gradient(180deg,${th.stops[0]},${th.stops[1]},${th.stops[2]})`}"></i>${esc(th.name)}</button>`).join('')}</div>` : '');
  }
  function toggleVizList(show) {
    const el = $('#mmList');
    if (!el) return;
    el.hidden = show === undefined ? !el.hidden : !show;
    if (!el.hidden) renderVizList();
  }
  function renderMusicHud() {
    const t = cur();
    $('#mmTrack').innerHTML = t ? `<div class="mm-t">${esc(t.title)}</div><div class="mm-a">${esc(t.artist)} — ${esc(t.album)}</div>` : '<div class="mm-t">Nothing playing</div>';
    $('#mmPlay').innerHTML = icon(P.playing ? 'pause' : 'play');
  }
  function wakeHud() {
    const el = $('#musicMode');
    el.classList.remove('idle');
    MM.idle = 0;
  }
  async function openMusicMode() {
    if (MM.open) return;
    MM.open = true;
    ensureAnalyser();
    const el = $('#musicMode');
    el.hidden = false;
    el.innerHTML = `
      <canvas id="mmCanvas"></canvas>
      <div class="mm-top"><div id="mmTrack" class="mm-track"></div>
        <div class="mm-tools">
          <button data-act="mmnp" title="Now Playing">${icon('disc')}<span>Now Playing</span></button>
          <button data-act="mmfull" title="Full screen (F)">${icon('expand')}<span>Full screen</span></button>
          <button data-act="mmclose" title="Exit (Esc)">${icon('close')}</button>
        </div></div>
      <div class="mm-bottom">
        <div class="mm-picker">
          <button data-act="mmprev" title="Previous visualizer (←)">${icon('back')}</button>
          <button class="mm-choose" data-act="mmlist" title="Choose a visualizer (V)"><span id="mmName"></span>${icon('chevDown')}</button>
          <button data-act="mmnext" title="Next visualizer (→)">${icon('forward')}</button>
        </div>
        <div class="mm-ctrls"><button data-act="prev">${icon('prev')}</button><button id="mmPlay" class="mm-play" data-act="toggle"></button><button data-act="next">${icon('next')}</button></div>
        <div class="mm-spacer"></div>
      </div>
      <div class="mm-list" id="mmList" hidden></div>`;
    setViz(settings.visualizer || 'spectrum');
    renderMusicHud();
    await api.win.fullscreen(true);
    MM.last = performance.now();
    const loop = (now) => {
      if (!MM.open) return;
      const dt = Math.min(0.1, (now - MM.last) / 1000);
      MM.last = now;
      MM.idle += dt;
      if (MM.idle > 3 && $('#mmList').hidden) $('#musicMode').classList.add('idle');
      try { MM.viz && MM.viz.frame(readAudio(now / 1000), musicMeta(), dt); } catch (e) { console.error(e); }
      MM.raf = requestAnimationFrame(loop);
    };
    MM.raf = requestAnimationFrame(loop);
  }
  async function closeMusicMode(keepFull) {
    if (!MM.open) return;
    MM.open = false;
    cancelAnimationFrame(MM.raf);
    if (MM.viz) { try { MM.viz.destroy(); } catch {} MM.viz = null; }
    const el = $('#musicMode');
    el.hidden = true;
    el.innerHTML = '';
    if (!keepFull) await api.win.fullscreen(false);
  }
  window.closeOverlays = () => { closeMusicMode(); if (npFull) setNpFull(false); };
  document.addEventListener('mousemove', (e) => {
    if (MM.open) wakeHud();
    // optional: tilt the record / CD / cassette as if viewing it from different angles
    if (!settings.npTilt) return;
    const stage = e.target.closest && e.target.closest('.np-stage.tilt');
    for (const st of $$('.np-stage.tilt')) {
      const sl = st.firstElementChild;
      if (!sl) continue;
      if (st !== stage) { sl.style.setProperty('--rx', '0deg'); sl.style.setProperty('--ry', '0deg'); continue; }
      const r = st.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      sl.style.setProperty('--ry', (x * 22).toFixed(2) + 'deg');
      sl.style.setProperty('--rx', (-y * 18).toFixed(2) + 'deg');
    }
  });
  document.addEventListener('mouseleave', () => { for (const sl of $$('.np-stage.tilt > *')) { sl.style.setProperty('--rx', '0deg'); sl.style.setProperty('--ry', '0deg'); } });

  // What slides out of the sleeve: a record, a CD or a cassette (Settings → Now Playing).
  let cassN = 0;
  // Shorten any SVG text marked data-fit="<width>" so it stays on its label (adds an ellipsis).
  function fitSvgText(root) {
    for (const tx of root.querySelectorAll('text[data-fit]')) {
      const max = +tx.dataset.fit;
      const full = tx.textContent;
      try {
        if (tx.getComputedTextLength() <= max) continue;
        let lo = 0, hi = full.length;
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2);
          tx.textContent = full.slice(0, mid).trimEnd() + '…';
          if (tx.getComputedTextLength() <= max) lo = mid; else hi = mid - 1;
        }
        tx.textContent = full.slice(0, lo).trimEnd() + '…';
        tx.insertAdjacentHTML('afterbegin', `<title>${esc(full)}</title>`);
      } catch {}
    }
  }
  // A cassette drawn after real ones: a smoky see-through shell with its fine grid texture and screws,
  // a ruled paper label with the side letter and a colour stripe, a dark window band with white hubs
  // (they spin while playing) and the brown tape showing in the clear centre window, and the head
  // area at the bottom with its holes and rollers. The tape packs grow and shrink with progress.
  function cassetteSvg(t, cls = '') {
    // A realistic compact cassette: smoky see-through shell, grey label with handwritten lines,
    // dark window with toothed hubs, tape packs that grow and shrink with the song's progress.
    const id = 'c' + (++cassN);
    const r = duration() ? position() / duration() : 0.3;
    const r0 = 9, rF = 27;
    const pack = (k) => Math.sqrt(r0 * r0 + k * (rF * rF - r0 * r0));
    const packL = pack(1 - r), packR = pack(r);
    const hub = (cx) => `
      <g class="reel" style="transform-origin:${cx}px 56px">
        <circle cx="${cx}" cy="56" r="7.6" fill="url(#${id}hub)"/>
        <circle cx="${cx}" cy="56" r="4.6" fill="#141517"/>
        ${[0, 60, 120, 180, 240, 300].map((a) => `<rect x="${cx - 0.9}" y="51.2" width="1.8" height="2.4" rx=".4" fill="#f2f1ec" transform="rotate(${a} ${cx} 56)"/>`).join('')}
        <circle cx="${cx}" cy="56" r="7.6" fill="none" stroke="rgba(0,0,0,.25)" stroke-width=".5"/>
      </g>`;
    const screw = (x, y) => `<circle cx="${x}" cy="${y}" r="2.5" fill="#2b2d31" stroke="#55585e" stroke-width=".5"/><path d="M${x - 1.5} ${y - 0.4} l3 0.8 M${x - 0.4} ${y + 1.5} l0.8 -3" stroke="#0d0e10" stroke-width=".6"/>`;
    const ring = (x) => `<circle cx="${x}" cy="111" r="7" fill="rgba(255,255,255,.07)" stroke="rgba(255,255,255,.18)" stroke-width=".8"/><circle cx="${x}" cy="111" r="4.2" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="1.4"/><circle cx="${x}" cy="111" r="1.8" fill="#0b0b0c"/>`;
    return `<svg class="cass-svg ${cls}" viewBox="0 0 200 127" aria-hidden="true">
      <defs>
        <pattern id="${id}grid" width="2.2" height="2.2" patternUnits="userSpaceOnUse"><rect width="2.2" height="2.2" fill="none"/><rect x=".25" y=".25" width="1.7" height="1.7" fill="none" stroke="rgba(255,255,255,.09)" stroke-width=".35"/></pattern>
        <linearGradient id="${id}shell" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgba(74,77,84,.86)"/><stop offset=".5" stop-color="rgba(44,46,51,.84)"/><stop offset="1" stop-color="rgba(30,31,35,.9)"/></linearGradient>
        <linearGradient id="${id}label" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e4e7e3"/><stop offset="1" stop-color="#cfd3ce"/></linearGradient>
        <radialGradient id="${id}tape" cx=".5" cy=".5" r=".5"><stop offset=".3" stop-color="#3a2a22"/><stop offset=".85" stop-color="#2a1d17"/><stop offset="1" stop-color="#4a372c"/></radialGradient>
        <radialGradient id="${id}hub" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="#e2e1dc"/><stop offset="1" stop-color="#b9b8b2"/></radialGradient>
        <linearGradient id="${id}gloss" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgba(255,255,255,.16)"/><stop offset=".3" stop-color="rgba(255,255,255,.03)"/><stop offset=".55" stop-color="rgba(255,255,255,0)"/><stop offset="1" stop-color="rgba(255,255,255,.05)"/></linearGradient>
        <clipPath id="${id}win"><rect x="40.5" y="45" width="119" height="22" rx="1.6"/></clipPath>
        <clipPath id="${id}body"><rect x="2" y="2" width="196" height="123" rx="6"/></clipPath>
      </defs>
      <g clip-path="url(#${id}body)">
        <!-- the tape packs, seen through the smoky shell -->
        <circle cx="70" cy="56" r="${packL.toFixed(1)}" fill="url(#${id}tape)"/>
        <circle cx="130" cy="56" r="${packR.toFixed(1)}" fill="url(#${id}tape)"/>
        <rect x="2" y="2" width="196" height="123" fill="url(#${id}shell)"/>
        <rect x="2" y="2" width="196" height="123" fill="url(#${id}grid)"/>
      </g>
      <rect x="2" y="2" width="196" height="123" rx="6" fill="none" stroke="#15161a" stroke-width="1.2"/>
      <rect x="3.2" y="3.2" width="193.6" height="120.6" rx="5" fill="none" stroke="rgba(255,255,255,.12)" stroke-width=".6"/>
      <!-- write-protect notches -->
      <rect x="22" y="2" width="14" height="5" rx="1" fill="rgba(0,0,0,.45)"/><rect x="164" y="2" width="14" height="5" rx="1" fill="rgba(0,0,0,.45)"/>
      <!-- label -->
      <rect x="13" y="11" width="174" height="73" rx="3" fill="url(#${id}label)"/>
      <rect x="18" y="14.5" width="164" height="27" rx="1.5" fill="#f7f7f3"/>
      <rect x="18" y="27.8" width="164" height=".45" fill="#b9c2c4"/><rect x="18" y="36.8" width="164" height=".45" fill="#b9c2c4"/>
      <text x="22" y="25.6" data-fit="156" font-family="'Segoe Print', 'Bradley Hand', 'Comic Sans MS', cursive" font-size="7.6" fill="#1e2b55">${esc(t.title || '')}</text>
      <text x="22" y="35" data-fit="156" font-family="'Segoe Print', 'Bradley Hand', 'Comic Sans MS', cursive" font-size="5.6" fill="#33406b">${esc([t.artist, t.album].filter(Boolean).join(' — '))}</text>
      <text x="19" y="63" font-family="Arial, Helvetica, sans-serif" font-size="11" font-weight="700" fill="#16171a">A</text>
      <rect x="13" y="72" width="174" height="10" fill="#1590d4"/>
      <text x="19" y="79.4" font-family="Arial, Helvetica, sans-serif" font-size="4.3" fill="rgba(255,255,255,.9)" letter-spacing=".3">TYPE I · NORMAL POSITION</text>
      <!-- window -->
      <rect x="40" y="44.5" width="120" height="23" rx="2" fill="#121315" stroke="#0c0d0f" stroke-width="1"/>
      <g clip-path="url(#${id}win)" opacity=".95">
        <circle cx="70" cy="56" r="${packL.toFixed(1)}" fill="url(#${id}tape)"/>
        <circle cx="130" cy="56" r="${packR.toFixed(1)}" fill="url(#${id}tape)"/>
        <rect x="40" y="44.5" width="120" height="23" fill="rgba(20,21,24,.35)"/>
      </g>
      <rect x="86" y="46" width="28" height="20" fill="rgba(255,255,255,.05)" stroke="rgba(255,255,255,.12)" stroke-width=".4"/>
      <path d="M86 56 H114" stroke="rgba(255,255,255,.35)" stroke-width=".35"/>
      ${[88, 92, 96, 100, 104, 108, 112].map((x, i) => `<path d="M${x} ${i % 3 === 0 ? 53.6 : 54.8} V${i % 3 === 0 ? 58.4 : 57.2}" stroke="rgba(255,255,255,.4)" stroke-width=".35"/>`).join('')}
      <circle cx="70" cy="56" r="9.6" fill="rgba(0,0,0,.35)"/><circle cx="130" cy="56" r="9.6" fill="rgba(0,0,0,.35)"/>
      ${hub(70)}${hub(130)}
      <!-- head opening, guide rings, screws -->
      <path d="M48 125 L55.5 98.5 H144.5 L152 125" fill="rgba(255,255,255,.05)" stroke="#121316" stroke-width="1"/>
      <path d="M49.6 124 L56.6 99.6 H143.4 L150.4 124" fill="none" stroke="rgba(255,255,255,.1)" stroke-width=".5"/>
      <circle cx="68" cy="116.5" r="3.3" fill="#0a0a0b" stroke="rgba(255,255,255,.18)" stroke-width=".5"/><circle cx="132" cy="116.5" r="3.3" fill="#0a0a0b" stroke="rgba(255,255,255,.18)" stroke-width=".5"/>
      <rect x="81" y="112.5" width="6.5" height="6.5" rx="1.2" fill="#0a0a0b" stroke="rgba(255,255,255,.18)" stroke-width=".5"/><rect x="112.5" y="112.5" width="6.5" height="6.5" rx="1.2" fill="#0a0a0b" stroke="rgba(255,255,255,.18)" stroke-width=".5"/>
      <rect x="93" y="118.5" width="14" height="5" rx="1" fill="#5a3f33" stroke="#2a1d17" stroke-width=".4"/>
      <circle cx="100" cy="104" r="1.9" fill="#0a0a0b"/>
      ${ring(20)}${ring(180)}
      ${screw(8.5, 8.5)}${screw(191.5, 8.5)}${screw(8.5, 118.5)}${screw(191.5, 118.5)}${screw(100, 91.5)}
      <rect x="2" y="2" width="196" height="123" rx="6" fill="url(#${id}gloss)" pointer-events="none"/>
    </svg>`;
  }
  // The cassette's case, seen from the front: clear plastic over a J-card with the album art.
  function cassetteCaseSvg(t) {
    const id = 'k' + (++cassN);
    const art = esc(t.artLarge || t.art || '');
    return `<svg class="case-svg" viewBox="0 0 128 200" aria-hidden="true">
      <defs>
        <clipPath id="${id}art"><rect x="7" y="11" width="114" height="114"/></clipPath>
        <linearGradient id="${id}glare" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgba(255,255,255,.26)"/><stop offset=".28" stop-color="rgba(255,255,255,.06)"/><stop offset=".29" stop-color="rgba(255,255,255,0)"/><stop offset=".8" stop-color="rgba(255,255,255,0)"/><stop offset="1" stop-color="rgba(255,255,255,.08)"/></linearGradient>
        <linearGradient id="${id}hinge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2c30"/><stop offset=".45" stop-color="#9ea2a8"/><stop offset=".6" stop-color="#3a3c41"/><stop offset="1" stop-color="#151619"/></linearGradient>
      </defs>
      <rect x="1" y="1" width="126" height="198" rx="3" fill="rgba(235,240,245,.10)" stroke="rgba(255,255,255,.45)" stroke-width="1"/>
      <!-- the J-card -->
      <rect x="7" y="11" width="114" height="178" fill="#f2efe8"/>
      ${art ? `<image href="${art}" x="7" y="11" width="114" height="114" clip-path="url(#${id}art)" preserveAspectRatio="xMidYMid slice"/>` : `<rect x="7" y="11" width="114" height="114" fill="#1590d4"/>`}
      <rect x="7" y="125" width="114" height="3" fill="#1590d4"/>
      <text x="12" y="142" data-fit="104" font-family="Poppins, 'Segoe UI', sans-serif" font-size="9" font-weight="700" fill="#1b1d21">${esc(t.album || t.title || '')}</text>
      <text x="12" y="153" data-fit="104" font-family="Poppins, 'Segoe UI', sans-serif" font-size="6.6" fill="#555b63">${esc([t.artist, t.year].filter(Boolean).join(' · '))}</text>
      ${[166, 172, 178].map((y, i) => `<rect x="12" y="${y}" width="${70 - i * 14}" height="1.6" rx=".8" fill="#d6d0c3"/>`).join('')}
      <text x="116" y="182" font-family="Arial, sans-serif" font-size="5" font-weight="700" fill="#9aa0a7" text-anchor="end" letter-spacing=".4">STEREO</text>
      <!-- clear plastic: hinges top and bottom, edge highlights, glare -->
      <rect x="1" y="1" width="126" height="8" rx="2" fill="url(#${id}hinge)"/>
      <rect x="1" y="191" width="126" height="8" rx="2" fill="url(#${id}hinge)"/>
      <rect x="2.5" y="9" width="2.5" height="182" fill="rgba(255,255,255,.18)"/>
      <rect x="123" y="9" width="2.5" height="182" fill="rgba(255,255,255,.1)"/>
      <rect x="1" y="1" width="126" height="198" rx="3" fill="url(#${id}glare)"/>
    </svg>`;
  }
  // What comes with the cover: a record, a CD (printed side or data side) or a cassette.
  function npMedia(t) {
    const art = esc(t.art || '');
    const kind = settings.nowPlayingMedia || 'vinyl';
    if (kind === 'cd') {
      const data = settings.cdFace === 'data';
      return `<div class="np-vinyl np-cd ${data ? 'data' : ''}"><div class="disc">${data ? '' : `<div class="cd-face" style="background-image:url('${art}')"></div>`}<div class="cd-shine"></div></div></div>`;
    }
    if (kind === 'cassette') return `<div class="np-tape">${cassetteSvg(t)}</div>`;
    return `<div class="np-vinyl"><div class="disc"><div class="label" style="background-image:url('${art}')"></div></div></div>`;
  }
  // The sleeve itself: album cover for vinyl/CD; for cassettes either the bare cassette or its case.
  function npSleeve(t) {
    const kind = settings.nowPlayingMedia || 'vinyl';
    if (kind === 'cassette' && (settings.cassetteMode || 'case') === 'solo') {
      return `<div class="np-sleeve np-sleeve-tape">${cassetteSvg(t, 'solo')}</div>`;
    }
    if (kind === 'cassette') {
      // playing: just the cassette; paused: just its case, with the album art
      return `<div class="np-sleeve np-sleeve-case"><div class="np-tape">${cassetteSvg(t)}</div><div class="np-case">${cassetteCaseSvg(t)}</div></div>`;
    }
    return `<div class="np-sleeve">${npMedia(t)}<div class="np-cover">${t.artLarge || t.art ? `<img src="${esc(t.artLarge || t.art)}" alt="">` : ''}</div></div>`;
  }

  function renderNowPlaying() {
    const t = cur();
    const el = $('#nowPlaying');
    el.classList.toggle('znp', zMosaicNP());
    if (zMosaicNP()) return renderZuneNowPlaying(t);
    if (!t) {
      el.innerHTML = `<div class="np-shade"></div><button class="np-close" data-act="nowplaying">${icon('close')}</button>
        <div class="np-empty"><div><h2 style="font-weight:300">Nothing in your queue yet</h2><p>Play something and it’ll show up here.</p></div></div>`;
      return;
    }
    const row = (q, i) => `
      <div class="np-row ${i < P.index ? 'past' : ''} ${i === P.index ? 'current' : ''}" data-qi="${i}">
        <span class="n">${i === P.index ? icon('speaker') : `<span class="num">${i + 1}</span><span class="hp">${icon('playCircle')}</span>`}</span>
        <span class="ell">${esc(q.title)}${q.artist !== t.artist || q.album !== t.album ? `<div class="s ell">${esc(q.artist)} — ${esc(q.album)}</div>` : ''}</span>
        <span class="d">${fmt(q.duration)}</span>
      </div>`;
    const ctx = P.context ? `Playing from ${esc(P.context.title)}` : 'Your queue';
    el.innerHTML = `
      <div class="np-bg" style="background-image:url('${esc(t.artLarge || t.art || '')}')"></div>
      <div class="np-shade"></div>
      <div class="np-tools">
        <button data-act="musicmode" title="Visualizers (M)">${icon('nowPlaying')}<span>Visualizer</span></button>
        <button data-act="npfull" title="Full screen (F)">${icon(npFull ? 'shrink' : 'expand')}<span>${npFull ? 'Exit full screen' : 'Full screen'}</span></button>
        <button class="np-x" data-act="nowplaying" title="Close">${icon('close')}</button>
      </div>
      <div class="np-inner">
        <div class="np-left">
          <div class="np-stage ${settings.npTilt ? 'tilt' : ''}">${npSleeve(t)}</div>
          <div class="np-cap">
            <div class="t ell"><a data-open="${esc(t.albumId || '')}" data-kind="album">${esc(t.album)}</a></div>
            <a class="a" data-open="${esc(t.artist)}" data-kind="artist">${esc(t.artist)}</a>${t.year ? `<span class="a np-year"> · ${t.year}</span>` : ''}
          </div>
          <div class="np-scrub"><span class="js-time">${fmt(position())}</span>${wave(duration() ? position() / duration() : 0, 'np-wave')}<span class="js-dur">${fmt(duration())}</span></div>
          <div class="np-modes">
            <button class="${P.shuffle ? 'on' : ''}" data-act="shuffle" title="Shuffle">${icon('shuffle')}</button>
            <button class="np-transport" data-act="prev" title="Previous">${icon('prev')}</button>
            <button class="np-transport np-play" data-act="toggle" title="Play/Pause">${icon(P.playing ? 'pause' : 'play')}</button>
            <button class="np-transport" data-act="next" title="Next">${icon('next')}</button>
            <button class="${P.repeat !== 'off' ? 'on' : ''}" data-act="repeat" title="Repeat">${repeatIcon()}</button>
          </div>
        </div>
        <div class="np-right">
          <div class="np-label">${ctx}</div>
          ${P.queue.map(row).join('')}
        </div>
      </div>`;
    // Centre the current song in the queue list only. (scrollIntoView would also scroll the
    // overlay itself, shifting everything up and leaving a bare strip at the bottom.)
    el.scrollTop = 0;
    fitSvgText(el);
    const curRow = $('.np-row.current', el), list = $('.np-right', el);
    if (curRow && list) list.scrollTop = curRow.offsetTop - list.clientHeight / 2 + curRow.offsetHeight / 2;
  }

  // ================================================================== Zudio (Zune skin) screens
  const isZune = () => skin() === 'zune';
  const zMosaicNP = () => isZune() && (settings.zuneNp || 'mosaic') === 'mosaic';
  const loved = (id) => !!(user.loved && user.loved[id]);
  function toggleLove(t) {
    if (!t) return;
    user.loved = user.loved || {};
    if (user.loved[t.id]) delete user.loved[t.id]; else user.loved[t.id] = Date.now();
    saveUser();
    renderChrome(); renderNowPlayingIfOpen(); emitState();
  }
  const pinned = (id) => (user.pins || []).includes(id);
  function togglePin(a) {
    user.pins = user.pins || [];
    user.pins = pinned(a.id) ? user.pins.filter((x) => x !== a.id) : [a.id, ...user.pins].slice(0, 12);
    saveUser();
    toast(pinned(a.id) ? `Pinned “${a.title}” to quickplay` : `Unpinned “${a.title}”`);
    if (route().route === 'home') render(true);
  }
  const zTile = (a, big) => `<div class="zq-tile ${big ? 'big' : ''}" data-open="${esc(a.id)}" data-kind="album" title="${esc(a.title)} — ${esc(a.artist)}">
      ${a.art ? `<img loading="lazy" src="${esc(big ? a.artLarge || a.art : a.art)}" alt="">` : `<div class="noart">${icon('disc')}</div>`}
      <button class="hover-play" data-play="${esc(a.id)}" data-kind="album" title="Play">${icon('play')}</button></div>`;

  // ---------------- quickplay: pins, new, history, then the artists you play most
  async function viewQuickplay(set) {
    let html = scanBanner();
    if (!LIB.roots.length && !LIB.tracks.size) { set(html + welcome()); return; }
    const pins = (user.pins || []).map((id) => LIB.albums.get(id)).filter((a) => a && !a.offline);
    const added = albumsList().sort((x, y) => (y.addedAt || 0) - (x.addedAt || 0)).slice(0, 9);
    const recent = user.recent.map((id) => LIB.albums.get(id)).filter((a) => a && !a.offline).slice(0, 9);
    const group = (label, list, empty) => `
      <div class="zq-group">
        <div class="zq-label">${label}</div>
        <div class="zq-tiles">${list.length ? list.map((a, i) => zTile(a, i === 0 && list.length > 2)).join('') : `<div class="zq-empty">${empty}</div>`}</div>
      </div>`;
    const artistPlays = new Map();
    for (const [id, e] of Object.entries(user.plays || {})) { const a = LIB.albums.get(id); if (a) artistPlays.set(a.artist, (artistPlays.get(a.artist) || 0) + e.count); }
    let top = [...artistPlays.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => artistByName(n)).filter(Boolean);
    if (top.length < 5) top = [...top, ...shuffleArr([...LIB.artists.values()].filter((a) => a.albums.length && !top.includes(a)))].slice(0, 6);
    html += `
      <div class="zq">
        <div class="zq-row">
          ${group('pins', pins, 'right-click any album and choose <b>pin to quickplay</b>')}
          ${group('new', added, 'new music shows up here')}
          ${group('history', recent, 'what you play shows up here')}
        </div>
        <div class="zq-artists">${top.slice(0, 6).map((ar) => { const art = artistArt(ar); return `
          <div class="zq-artist" data-play="${esc(ar.name)}" data-kind="artist" title="Play ${esc(ar.name)}">${art ? `<img src="${esc(art)}" alt="">` : ''}<span>${esc(ar.name.toLowerCase())}</span></div>`; }).join('')}</div>
      </div>`;
    set(html);
    const row = $('.zq-row');
    if (row) row.addEventListener('wheel', (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { row.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
  }

  // ---------------- collection: artists | albums | songs, side by side
  const coll = { artist: null, album: null, genre: null };
  async function viewCollection(set, params, mode) {
    const byGenre = mode === 'genres';
    const leftItems = byGenre
      ? [...LIB.genres.keys()].sort(cmp)
      : [...LIB.artists.values()].filter((a) => a.albums.length).sort((a, b) => cmp(a.name, b.name)).map((a) => a.name);
    const sel = byGenre ? coll.genre : coll.artist;
    let albums;
    if (byGenre) albums = sel ? LIB.genres.get(sel) || [] : albumsList();
    else albums = sel ? (artistByName(sel) ? [...artistByName(sel).albums, ...artistByName(sel).appears] : []) : albumsList();
    albums = sel ? sortedAlbums(albums, 'year') : sortedAlbums(albums, 'added');
    const album = coll.album && albums.find((a) => a.id === coll.album);
    let songs = album ? albumTracks(album) : sel ? albums.flatMap(albumTracks) : [...LIB.tracks.values()].filter((t) => !t.offline).sort((a, b) => cmp(a.title, b.title));
    if (!byGenre && sel && !album) songs = songs.filter((t) => normName(t.artist) === normName(sel) || normName(t.albumArtist) === normName(sel));
    rowLists.zsongs = { tracks: songs, context: album ? album.title : sel || 'All songs' };
    const what = byGenre ? 'genre' : 'artist';
    set(`
      <div class="zc">
        <div class="zc-col zc-left">
          <div class="zc-head">${plural(leftItems.length, what).toUpperCase()}</div>
          <div class="zc-list">
            <a class="zc-item ${!sel ? 'on' : ''}" data-coll="${what}" data-val="">ALL</a>
            ${leftItems.map((n) => `<a class="zc-item ell ${sel === n ? 'on' : ''}" data-coll="${what}" data-val="${esc(n)}">${esc(n)}</a>`).join('')}
          </div>
        </div>
        <div class="zc-col zc-mid">
          <div class="zc-head">${plural(albums.length, 'album').toUpperCase()} ${sel ? '' : '<span>BY DATE ADDED</span>'}</div>
          <div class="zc-albums" id="zcAlbums"></div>
        </div>
        <div class="zc-col zc-right">
          <div class="zc-head">${plural(songs.length, 'song').toUpperCase()} <span>${album ? esc(album.title).toUpperCase() : 'A–Z'}</span></div>
          <div class="zc-songs" data-list="zsongs" id="zcSongs"></div>
        </div>
      </div>`);
    // albums and songs fill in as you scroll
    const ag = $('#zcAlbums');
    const albumHtml = (a) => `<div class="zc-album ${coll.album === a.id ? 'on' : ''}" data-zalbum="${esc(a.id)}" title="Double-click to play">
        <div class="cover">${a.art ? `<img loading="lazy" src="${esc(a.art)}" alt="">` : `<div class="noart">${icon('disc')}</div>`}</div>
        <div class="card-title ell">${esc(a.title)}</div><div class="card-sub ell">${esc(a.artist)}</div></div>`;
    chunked(ag, albums, albumHtml, 120);
    const sg = $('#zcSongs');
    const c = cur();
    const songHtml = (t, i) => `<div class="trow zc-song ${c && c.id === t.id ? 'current' : ''}" data-ti="${i}" data-id="${esc(t.id)}">
        <span class="ell">${c && c.id === t.id ? icon('speaker') : ''}${esc(t.title)}</span><span class="dur">${loved(t.id) ? icon('heart') : ''}${fmt(t.duration)}</span></div>`;
    chunked(sg, songs, songHtml, 300);
  }
  function chunked(el, items, fn, size) {
    if (!el) return;
    let n = 0;
    const more = () => {
      el.insertAdjacentHTML('beforeend', items.slice(n, n + size).map((x, k) => fn(x, n + k)).join(''));
      n = Math.min(items.length, n + size);
      if (n < items.length) {
        const s = document.createElement('div'); s.className = 'grid-sentinel'; el.appendChild(s);
        const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) { io.disconnect(); s.remove(); more(); } }, { root: el, rootMargin: '600px' });
        io.observe(s);
      }
    };
    more();
  }

  // ---------------- Now Playing: a wall of your album art behind the song
  let zMosaicTimer = null;
  function zMosaicTiles() {
    const arts = shuffleArr(albumsList().map((a) => a.art).filter(Boolean));
    if (!arts.length) return '';
    const cols = 12, rows = 7;
    const used = Array.from({ length: rows }, () => new Array(cols).fill(false));
    let k = 0, html = '';
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (used[r][c]) continue;
      const roll = Math.random();
      let s = roll < 0.08 ? 3 : roll < 0.3 ? 2 : 1;
      while (s > 1 && (r + s > rows || c + s > cols || used.slice(r, r + s).some((row) => row.slice(c, c + s).some(Boolean)))) s--;
      for (let i = 0; i < s; i++) for (let j = 0; j < s; j++) used[r + i][c + j] = true;
      html += `<div class="zm-t" style="grid-area:${r + 1}/${c + 1}/span ${s}/span ${s}"><img src="${esc(arts[k++ % arts.length])}" alt=""></div>`;
    }
    return html;
  }
  function renderZuneNowPlaying(t) {
    const el = $('#nowPlaying');
    const showQ = !!settings.zuneQueue;
    const vol = Math.round((audio.muted ? 0 : audio.volume) * 100);
    const keepWall = $('.zm-wall', el);
    const row = (q, i) => `<div class="znp-q ${i === P.index ? 'current' : ''}" data-qi="${i}"><div class="ell">${i === P.index ? icon('nowPlaying') : ''}${esc(q.title)}</div><small class="ell">${esc(q.artist)}</small></div>`;
    el.innerHTML = `
      <div class="zm-wall">${keepWall ? keepWall.innerHTML : zMosaicTiles()}</div>
      <div class="zm-tint"></div>
      <div class="znp-drag"></div>
      <button class="z-back" data-act="nowplaying" title="Back">${icon('arrowLeft')}</button>
      ${t ? `
      <div class="znp-now">
        <div class="znp-art" data-open="${esc(t.albumId || '')}" data-kind="album">${t.artLarge || t.art ? `<img src="${esc(t.artLarge || t.art)}" alt="">` : icon('disc')}</div>
        <div class="znp-meta">
          <div class="znp-artist ell" data-open="${esc(t.artist)}" data-kind="artist">${esc(t.artist)}</div>
          <div class="znp-album ell" data-open="${esc(t.albumId || '')}" data-kind="album">${esc(t.album)}</div>
          <div class="znp-title ell">${esc(t.title)}</div>
          <button class="z-circ sm ${loved(t.id) ? 'on' : ''}" data-act="love" title="Love this song">${icon('heart')}</button>
        </div>
      </div>
      <div class="znp-seek"><div class="znp-st ell">${esc(t.title)}</div>${slider('seek', duration() ? position() / duration() : 0)}<div class="znp-times"><span class="js-time">${fmt(position())}</span><span class="js-time-left">-${fmt(duration() - position())}</span></div></div>`
      : `<div class="znp-now"><div class="znp-meta"><div class="znp-artist">NOTHING PLAYING</div><div class="znp-album">PICK SOMETHING IN YOUR COLLECTION</div></div></div>`}
      <div class="znp-ctrl">
        <div class="znp-btns">
          <button class="z-ic ${showQ ? 'on' : ''}" data-act="zqueue" title="Show the queue">${icon('queue')}</button>
          <button class="z-ic ${P.repeat !== 'off' ? 'on' : ''}" data-act="repeat" title="Repeat">${repeatIcon()}</button>
          <button class="z-ic ${P.shuffle ? 'on' : ''}" data-act="shuffle" title="Shuffle">${icon('shuffle')}</button>
          <button class="z-circ" data-act="prev" title="Previous">${icon('prev')}</button>
          <button class="z-circ big" data-act="toggle" title="Play/Pause">${icon(P.playing ? 'pause' : 'play')}</button>
          <button class="z-circ" data-act="next" title="Next">${icon('next')}</button>
          <button class="z-ic" data-act="npfull" title="Full screen (F)">${icon(npFull ? 'shrink' : 'expand')}</button>
          <button class="z-ic" data-act="musicmode" title="Visualizers (M)">${icon('nowPlaying')}</button>
        </div>
        <div class="z-vol" data-zvol title="Scroll to change the volume, click to mute">VOLUME ${vol}</div>
      </div>
      ${showQ ? `<div class="znp-queue"><div class="znp-qlist">${P.queue.map(row).join('')}</div><button class="z-pill" data-act="savequeue">SAVE AS PLAYLIST</button></div>` : ''}`;
    const curRow = $('.znp-q.current', el), list = $('.znp-qlist', el);
    if (curRow && list) list.scrollTop = curRow.offsetTop - list.clientHeight / 2;
    clearInterval(zMosaicTimer);
    // every few seconds a tile on the wall quietly changes
    zMosaicTimer = setInterval(() => {
      if ($('#nowPlaying').hidden || !$('.zm-wall')) return clearInterval(zMosaicTimer);
      const tiles = $$('.zm-t img');
      const arts = albumsList().map((a) => a.art).filter(Boolean);
      if (!tiles.length || !arts.length) return;
      const img = tiles[Math.floor(Math.random() * tiles.length)];
      img.style.opacity = 0;
      setTimeout(() => { img.src = arts[Math.floor(Math.random() * arts.length)]; img.style.opacity = ''; }, 700);
    }, 2600);
  }
  // scroll over the VOLUME readout to change it; click to mute
  document.addEventListener('wheel', (e) => {
    const v = e.target.closest('[data-zvol]');
    if (!v) return;
    e.preventDefault();
    setVolume(Math.max(0, Math.min(1, (audio.muted ? 0 : audio.volume) + (e.deltaY < 0 ? 0.02 : -0.02))));
    for (const el of $$('[data-zvol]')) el.textContent = `VOLUME ${Math.round(audio.volume * 100)}`;
  }, { passive: false });

  // ------------------------------------------------------------------ router
  const hist = { stack: [], pos: -1 };
  let renderToken = 0;
  function go(route, params = {}, push = true) {
    if (push) {
      hist.stack = hist.stack.slice(0, hist.pos + 1);
      hist.stack.push({ route, params });
      hist.pos = hist.stack.length - 1;
    }
    closeNowPlaying();
    render();
  }
  const route = () => hist.stack[hist.pos] || { route: 'home', params: {} };
  function back() { if (hist.pos > 0) { hist.pos--; go(null, null, false); } }
  function fwd() { if (hist.pos < hist.stack.length - 1) { hist.pos++; go(null, null, false); } }

  async function render(keepScroll) {
    const token = ++renderToken;
    const { route: r, params } = route();
    const view = $('#view');
    const top = view.scrollTop;
    if (!keepScroll) view.scrollTop = 0;
    $('#navBack').disabled = hist.pos <= 0;
    $('#navFwd').disabled = hist.pos >= hist.stack.length - 1;
    renderNav();
    const set = (html) => { if (token === renderToken) view.innerHTML = html; return token === renderToken; };
    const zv = (zfn, fn) => (...a) => (isZune() ? zfn(...a) : fn(...a));
    const views = { playlists: viewPlaylists, home: zv(viewQuickplay, viewHome), rotation: viewRotation, albums: viewAlbums, artists: zv((st, pa) => viewCollection(st, pa, 'artists'), viewArtists), songs: viewSongs, genres: zv((st, pa) => viewCollection(st, pa, 'genres'), viewGenres), genre: viewGenre, album: viewAlbum, artist: viewArtist, search: viewSearch, playlist: viewPlaylist, settings: viewSettings };
    try { await (views[r] || viewHome)(set, params || {}, r, token); }
    catch (e) { console.error(e); set(emptyState('disc', 'Something went wrong', esc(e.message), `<button class="pill" data-route="home">Go home</button>`)); }
    if (keepScroll) view.scrollTop = top;
  }
  const rerenderLibraryViews = debounce(() => {
    const r = route().route;
    if (['home', 'albums', 'artists', 'songs', 'genres', 'genre', 'album', 'artist', 'rotation', 'search'].includes(r) && !$('#view').contains(document.activeElement)) render(true);
    else if (r === 'settings') render(true);
  }, 400);
  const loading = () => `<div class="loading"><div class="spinner"></div></div>`;
  const emptyState = (ic, title, body, action = '') =>
    `<div class="empty">${icon(ic)}<h2>${title}</h2><p>${body}</p>${action}</div>`;

  // ------------------------------------------------------------------ building blocks
  function card(a, opts = {}) {
    const meta = opts.meta !== undefined ? opts.meta : opts.plays ? plural(opts.plays, 'play') : a.year || '';
    return `
      <div class="card" data-open="${esc(a.id)}" data-kind="album">
        <div class="cover">
          ${a.art ? `<img loading="lazy" decoding="async" src="${esc(a.art)}" alt="">` : `<div class="noart">${icon('disc')}</div>`}
          <button class="hover-play" data-play="${esc(a.id)}" data-kind="album" title="Play">${icon('play')}</button>
        </div>
        <div class="card-title ell">${esc(a.title)}</div>
        <div class="card-sub ell">${esc(a.artist)}</div>
        ${meta ? `<div class="card-meta ell">${esc(meta)}</div>` : ''}
      </div>`;
  }
  const grid = (items, opts) => `<div class="grid">${items.map((i) => card(i.album || i, i.album ? { ...opts, plays: i.count } : opts)).join('')}</div>`;
  // Big grids render in chunks as you scroll, so thousands of albums stay smooth.
  function progressiveGrid(sel, items, opts) {
    const el = $(sel);
    if (!el) return;
    let n = 0;
    const more = () => {
      const chunk = items.slice(n, n + 180);
      n += chunk.length;
      el.insertAdjacentHTML('beforeend', chunk.map((a) => card(a, opts)).join(''));
      if (n < items.length) observe();
    };
    const observe = () => {
      const s = document.createElement('div');
      s.className = 'grid-sentinel';
      el.appendChild(s);
      const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) { io.disconnect(); s.remove(); more(); } }, { root: $('#view'), rootMargin: '900px' });
      io.observe(s);
    };
    more();
  }
  function artistChip(ar) {
    const art = artistArt(ar);
    return `<div class="chip" data-open="${esc(ar.name)}" data-kind="artist"><div class="photo">${art ? `<img loading="lazy" src="${esc(art)}" alt="">` : icon('user')}</div><span class="ell">${esc(ar.name)}</span><small>${plural(ar.albums.length || ar.appears.length, 'album')}</small></div>`;
  }
  function viewHead(title, sub, right = '') {
    return `<div class="view-head"><h1>${esc(title)}</h1>${sub ? `<span class="sep"></span><span class="sub ell">${sub}</span>` : ''}<span class="grow"></span>${right}</div>`;
  }
  function scanBanner() {
    const s = LIB.scanning;
    if (!s) return '';
    const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
    return `<div class="scan-banner"><div class="spinner small"></div><span>${esc(s.phase)}${s.total ? ` · ${s.done.toLocaleString()} of ${s.total.toLocaleString()}` : '…'}</span><div class="scan-bar"><i style="width:${pct}%"></i></div></div>`;
  }
  function welcome() {
    return `
      <div class="hero welcome">
        <div class="badge">${icon('folder')}</div>
        <h2>Bring your music in.</h2>
        <p>Add the folders where your music lives: on this PC, an external drive or a network share. ${NAME} keeps watching them for new music.</p>
        <div class="hero-actions">
          <button class="pill" data-act="addfolder">${icon('plus')} Add a music folder</button>
          <button class="btn" data-act="openfiles">${icon('disc')} Open files</button>
        </div>
        <p class="drop-hint">Or drop music files and folders anywhere on this window.</p>
      </div>`;
  }

  // ------------------------------------------------------------------ views
  async function viewHome(set) {
    let html = scanBanner();
    if (!LIB.roots.length && !LIB.tracks.size) { set(html + welcome()); return; }
    const recent = user.recent.map((id) => LIB.albums.get(id)).filter((a) => a && !a.offline).slice(0, 9);
    if (recent.length) {
      const [first, ...rest] = recent;
      html += `<div class="divider-head">Keep listening</div>
        <div class="keep">
          <div class="k-first" data-open="${esc(first.id)}" data-kind="album" style="box-shadow:var(--cover-shadow)">${first.art ? `<img src="${esc(first.artLarge || first.art)}" alt="">` : `<div class="noart">${icon('disc')}</div>`}</div>
          <div class="k-rest">${rest.map((r) => `<div class="k-tile" data-open="${esc(r.id)}" data-kind="album" title="${esc(r.title)} — ${esc(r.artist)}">${r.art ? `<img src="${esc(r.art)}" alt="">` : ''}</div>`).join('')}</div>
        </div>
        <div class="keep-caption"><div class="card-title ell" style="max-width:230px">${esc(first.title)}</div><div class="card-sub ell" style="max-width:230px">${esc(first.artist)}</div></div>`;
    }
    const rot = heavyRotation();
    if (rot.length) html += `<div class="section"><div class="section-title"><h3>Heavy Rotation</h3><a data-route="rotation">See all</a><a data-act="station">${icon('station', 'inline')} Play station</a></div>${grid(rot.slice(0, 10), { meta: '' })}</div>`;
    const added = albumsList().sort((x, y) => (y.addedAt || 0) - (x.addedAt || 0)).slice(0, 12);
    if (added.length) html += `<div class="section"><div class="section-title"><h3>Recently added</h3><a data-route="albums" data-sort="added">See all</a></div>${grid(added)}</div>`;
    html += `<div class="section"><div class="section-title"><h3>Random picks</h3><a data-act="reshuffle">${icon('shuffle', 'inline')} Shuffle again</a></div><div id="randomPicks">${grid(shuffleArr(albumsList()).slice(0, 12))}</div></div>`;
    if (!added.length && !LIB.scanning) html += emptyState('folder', 'No music found yet', `${NAME} didn’t find any music in your folders. Add another folder in Settings.`, `<button class="pill" data-act="addfolder">${icon('plus')} Add a music folder</button>`);
    set(html);
  }

  async function viewRotation(set) {
    const items = heavyRotation();
    const head = viewHead('Heavy Rotation', 'On repeat lately', items.length ? `<button class="pill" data-act="station">${icon('station')} Play station</button>` : '');
    const rotation = items.length
      ? `<div class="grid rotation">${items.slice(0, 12).map((i) => card(i.album, { plays: i.count })).join('')}</div>`
      : `<p class="soft-note">Nothing in rotation yet. Records you keep coming back to will stack up here.</p>`;
    const top = Object.entries(user.trackPlays || {}).sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ t: LIB.tracks.get(id), n })).filter((x) => x.t && !x.t.offline).slice(0, 15);
    set(head + rotation + `
      <div class="section" style="margin-top:46px"><div class="section-title"><h3>Random picks</h3><a data-act="reshuffle">${icon('shuffle', 'inline')} Shuffle again</a></div><div id="randomPicks">${grid(shuffleArr(albumsList()).slice(0, 12))}</div></div>
      ${top.length ? `<div class="section"><div class="section-title"><h3>Most played songs</h3></div>${trackRows(top.map((x) => x.t), { meta: (t) => plural(user.trackPlays[t.id], 'play'), context: 'Most played' })}</div>` : ''}`);
    highlightRows();
  }

  // album / track rows, used on album, artist, playlist and rotation pages
  let rowLists = {};
  function trackRows(tracks, { album = false, meta, context = '', listId = 'l' + Math.random().toString(36).slice(2, 7) } = {}) {
    rowLists[listId] = { tracks, context };
    let disc = null;
    const multi = album && new Set(tracks.map((t) => t.disc || 1)).size > 1;
    return `<div class="tracks" data-list="${listId}">${tracks.map((t, i) => {
      let head = '';
      if (multi && (t.disc || 1) !== disc) { disc = t.disc || 1; head = `<div class="disc-head">${icon('disc')} Disc ${disc}</div>`; }
      return `${head}
        <div class="trow ${t.offline ? 'disabled' : ''}" data-ti="${i}" data-id="${esc(t.id)}">
          <span class="num"><span class="n">${album ? t.track || i + 1 : i + 1}</span><span class="pc" data-act="playrow">${icon('playCircle')}</span><span class="spk" hidden>${icon('speaker')}</span></span>
          <span class="ell"><div class="t-title ell">${esc(t.title)}</div>${!album || (t.artist && normName(t.artist) !== normName(t.albumArtist)) ? `<div class="t-sub ell">${esc(t.artist)}${album ? '' : ` — ${esc(t.album)}`}</div>` : ''}</span>
          <span class="dur">${meta ? esc(meta(t)) : fmt(t.duration)}</span>
          <span class="row-btns"><button class="more" data-act="rowqueue" title="Add to queue">${icon('plus')}</button><button class="more" data-act="rowmenu" title="More">${icon('more')}</button></span>
        </div>`;
    }).join('')}</div>`;
  }

  // ---------------- Albums
  const albumSort = { by: 'artist', filter: '' };
  function sortedAlbums(list, by) {
    const out = list.slice();
    if (by === 'title') out.sort((a, b) => cmp(a.title, b.title));
    else if (by === 'year') out.sort((a, b) => (b.year || 0) - (a.year || 0) || cmp(a.artist, b.artist));
    else if (by === 'added') out.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    else out.sort((a, b) => cmp(a.artist, b.artist) || (a.year || 0) - (b.year || 0) || cmp(a.title, b.title));
    return out;
  }
  async function viewAlbums(set, params) {
    if (params.sort) { albumSort.by = params.sort; delete params.sort; }
    const f = albumSort.filter.toLowerCase();
    let list = albumsList();
    if (f) list = list.filter((a) => (a.title + ' ' + a.artist + ' ' + (a.genre || '') + ' ' + (a.year || '')).toLowerCase().includes(f));
    list = sortedAlbums(list, albumSort.by);
    const right = `
      <label class="tb-search filter">${icon('search')}<input id="libFilter" data-filter="albums" placeholder="Filter albums" value="${esc(albumSort.filter)}"></label>
      <div class="seg" data-sortgroup="albums">${[['artist', 'Artist'], ['title', 'Title'], ['year', 'Year'], ['added', 'Recently added']].map(([k, l]) => `<button data-sort="${k}" class="${albumSort.by === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    if (!set(scanBanner() + viewHead('Albums', plural(list.length, 'album'), right) + (list.length ? '<div class="grid" id="albumGrid"></div>' : emptyState('disc', f ? 'No matches' : 'No albums yet', f ? 'Try a different filter.' : 'Add a music folder in Settings.')))) return;
    progressiveGrid('#albumGrid', list, { meta: albumSort.by === 'year' ? undefined : undefined });
    keepFilterFocus();
  }
  function keepFilterFocus() {
    const input = $('#libFilter');
    if (input && input.value && input.dataset.focus !== '0') { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  }

  // ---------------- Artists
  const artistSort = { filter: '' };
  async function viewArtists(set) {
    const f = artistSort.filter.toLowerCase();
    let list = [...LIB.artists.values()].filter((a) => a.albums.length);
    if (f) list = list.filter((a) => a.name.toLowerCase().includes(f));
    list.sort((a, b) => cmp(a.name, b.name));
    const right = `<label class="tb-search filter">${icon('search')}<input id="libFilter" data-filter="artists" placeholder="Filter artists" value="${esc(artistSort.filter)}"></label>`;
    // letter dividers, like a record store bin
    let html = '', letter = null, n = 0;
    for (const ar of list.slice(0, 1500)) {
      const L = (sortKey(ar.name)[0] || '#').toUpperCase().replace(/[^A-Z]/, '#');
      if (L !== letter) { if (letter !== null) html += '</div>'; letter = L; html += `<div class="letter">${L}</div><div class="artist-chips">`; }
      html += artistChip(ar); n++;
    }
    if (n) html += '</div>';
    set(scanBanner() + viewHead('Artists', plural(list.length, 'artist'), right) + (html || emptyState('user', f ? 'No matches' : 'No artists yet', f ? 'Try a different filter.' : 'Add a music folder in Settings.')));
    keepFilterFocus();
  }

  // ---------------- Songs (a long, sortable list that only draws the rows on screen)
  const songState = { by: 'artist', dir: 1, filter: '' };
  let songList = [];
  const SONG_COLS = [['title', 'Title'], ['artist', 'Artist'], ['album', 'Album'], ['year', 'Year'], ['genre', 'Genre'], ['format', 'Format'], ['duration', 'Time']];
  function sortSongs(list) {
    const { by, dir } = songState;
    const key = {
      title: (t) => t.title, artist: (t) => t.artist, album: (t) => t.album, genre: (t) => t.genre || '', format: (t) => t.codec || '',
      year: (t) => t.year || 0, duration: (t) => t.duration || 0
    }[by];
    return list.sort((a, b) => {
      let r;
      if (by === 'year' || by === 'duration') r = key(a) - key(b);
      else r = cmp(key(a), key(b));
      if (!r && by === 'artist') r = cmp(a.album, b.album) || (a.disc || 1) - (b.disc || 1) || (a.track || 0) - (b.track || 0);
      if (!r && by === 'album') r = (a.disc || 1) - (b.disc || 1) || (a.track || 0) - (b.track || 0);
      return r * dir;
    });
  }
  async function viewSongs(set) {
    const f = songState.filter.toLowerCase();
    let list = [...LIB.tracks.values()].filter((t) => !t.offline);
    if (f) list = list.filter((t) => (t.title + ' ' + t.artist + ' ' + t.album + ' ' + (t.genre || '')).toLowerCase().includes(f));
    songList = sortSongs(list);
    const right = `<label class="tb-search filter">${icon('search')}<input id="libFilter" data-filter="songs" placeholder="Filter songs" value="${esc(songState.filter)}"></label>
      <button class="btn" data-act="songsplay" ${songList.length ? '' : 'disabled'}>${icon('play')} Play</button>
      <button class="btn" data-act="songsshuffle" ${songList.length ? '' : 'disabled'}>${icon('shuffle')} Shuffle all</button>`;
    const head = `<div class="song-head">${SONG_COLS.map(([k, l]) => `<button data-songsort="${k}" class="${songState.by === k ? 'on' : ''}">${l}${songState.by === k ? `<i>${songState.dir > 0 ? '▲' : '▼'}</i>` : ''}</button>`).join('')}</div>`;
    if (!set(scanBanner() + viewHead('Songs', plural(songList.length, 'song'), right) + (songList.length ? head + `<div class="song-list" id="songList" style="height:${songList.length * SONG_ROW}px"></div>` : emptyState('disc', f ? 'No matches' : 'No songs yet', f ? 'Try a different filter.' : 'Add a music folder in Settings.')))) return;
    drawSongs();
    keepFilterFocus();
  }
  const SONG_ROW = 40;
  function drawSongs() {
    const el = $('#songList');
    if (!el) return;
    const view = $('#view');
    const top = Math.max(0, view.scrollTop - el.offsetTop);
    const first = Math.max(0, Math.floor(top / SONG_ROW) - 10);
    const last = Math.min(songList.length, first + Math.ceil(view.clientHeight / SONG_ROW) + 25);
    if (el.dataset.range === `${first}-${last}`) return;
    el.dataset.range = `${first}-${last}`;
    const c = cur();
    let html = '';
    for (let i = first; i < last; i++) {
      const t = songList[i];
      html += `<div class="srow ${c && c.id === t.id ? 'current' : ''}" data-si="${i}" data-id="${esc(t.id)}" style="top:${i * SONG_ROW}px">
        <span class="ell st">${c && c.id === t.id ? icon('speaker') : ''}${esc(t.title)}</span><span class="ell"><a data-open="${esc(t.artist)}" data-kind="artist">${esc(t.artist)}</a></span><span class="ell"><a data-open="${esc(t.albumId || '')}" data-kind="album">${esc(t.album)}</a></span>
        <span>${t.year || ''}</span><span class="ell">${esc(t.genre || '')}</span><span class="ell fmt">${esc(t.codec || '')}${t.lossless && t.bits > 16 ? ' hi-res' : ''}</span><span class="tm">${fmt(t.duration)}</span>
        <button class="more" data-act="songmenu" title="More">${icon('more')}</button></div>`;
    }
    el.innerHTML = html;
  }

  // ---------------- Genres
  async function viewGenres(set) {
    const list = [...LIB.genres.entries()].sort((a, b) => b[1].length - a[1].length || cmp(a[0], b[0]));
    const tile = ([g, albums]) => {
      const arts = albums.map((a) => a.art).filter(Boolean).slice(0, 4);
      return `<div class="card genre-card" data-route="genre" data-genre="${esc(g)}">
        <div class="cover mosaic-cover">${arts.length >= 4 ? `<div class="mosaic">${arts.map((a) => `<img loading="lazy" src="${esc(a)}" alt="">`).join('')}</div>` : arts.length ? `<img loading="lazy" src="${esc(arts[0])}" alt="">` : `<div class="noart">${icon('disc')}</div>`}
          <button class="hover-play" data-play="${esc(g)}" data-kind="genre" title="Shuffle this genre">${icon('shuffle')}</button></div>
        <div class="card-title ell">${esc(g)}</div><div class="card-sub">${plural(albums.length, 'album')}</div></div>`;
    };
    set(scanBanner() + viewHead('Genres', plural(list.length, 'genre')) + (list.length ? `<div class="grid">${list.map(tile).join('')}</div>` : emptyState('disc', 'No genres yet', 'Genres come from your files’ tags.')));
  }
  async function viewGenre(set, { genre }) {
    const list = sortedAlbums(LIB.genres.get(genre) || [], 'artist');
    if (!set(viewHead(genre, plural(list.length, 'album'), `<button class="pill" data-play="${esc(genre)}" data-kind="genre">${icon('shuffle')} Shuffle ${esc(genre)}</button>`) + '<div class="grid" id="genreGrid"></div>')) return;
    progressiveGrid('#genreGrid', list);
  }

  // ---------------- Album
  async function viewAlbum(set, { id }) {
    const a = LIB.albums.get(id);
    if (!a) { set(emptyState('disc', 'Album not found', 'It may have been moved or removed from your library.')); return; }
    const tracks = albumTracks(a);
    const artInfo = a.art ? `${a.artW}×${a.artH} ${{ embedded: 'from the files', folder: 'from the folder', online: 'HD from online', manual: 'chosen by you' }[a.artSource] || ''}` : 'No art yet';
    const facts = [a.year, plural(tracks.length, 'song'), a.duration && fmtLong(a.duration), a.format, a.genre && `<a data-route="genre" data-genre="${esc(a.genre)}">${esc(a.genre)}</a>`].filter(Boolean).join(' · ');
    set(`
      <div class="album-head">
        <div class="cover big-cover" data-act="artmenu" title="Album art: ${esc(artInfo)}">${a.artLarge ? `<img src="${esc(a.artLarge)}" alt="">` : `<div class="noart">${icon('disc')}</div>`}<span class="art-badge">${esc(artInfo)}</span></div>
        <div class="meta">
          <div class="kicker">Album</div>
          <h1>${esc(a.title)}</h1>
          <h2>by <a data-open="${esc(a.artist)}" data-kind="artist">${esc(a.artist)}</a></h2>
          <div class="facts">${facts}</div>
          <div class="actions">
            <button class="btn primary" data-act="playalbum">${icon('play')} Play</button>
            <button class="btn" data-act="shufflealbum">${icon('shuffle')} Shuffle</button>
            <button class="btn" data-act="queuealbum">${icon('plus')} Add to Queue</button>
            <button class="btn" data-act="playlistalbum">${icon('queue')} Add to Playlist</button>
            <button class="btn" data-act="artmenu">${icon('image')} Album art</button>
            <button class="btn" data-act="showfolder">${icon('folder')} Show in folder</button>
          </div>
        </div>
      </div>
      ${trackRows(tracks, { album: true, context: a.title, listId: 'album' })}
      <div class="about soft-note">${esc(a.dirs.join('\n'))}</div>`);
    highlightRows();
  }

  function highlightRows() {
    const t = cur();
    for (const row of $$('.trow')) {
      const on = !!t && row.dataset.id === t.id;
      row.classList.toggle('current', on);
      const spk = $('.spk', row);
      if (spk) spk.hidden = !on;
    }
    if ($('#songList')) { $('#songList').dataset.range = ''; drawSongs(); }
  }

  // ---------------- Artist
  async function viewArtist(set, { name }) {
    const ar = artistByName(name);
    if (!ar) { set(emptyState('user', 'Artist not found', 'They may have been removed from your library.')); return; }
    const art = artistArt(ar);
    const all = artistTracks(ar);
    const top = all.filter((t) => (user.trackPlays || {})[t.id]).sort((x, y) => user.trackPlays[y.id] - user.trackPlays[x.id]).slice(0, 8);
    set(`
      <div class="artist-head">
        <div class="photo">${art ? `<img src="${esc(art)}" alt="">` : icon('user')}</div>
        <div style="min-width:0">
          <h1 class="ell">${esc(ar.name)}</h1>
          <p>${[plural(ar.albums.length, 'album'), plural(all.length, 'song'), fmtLong(all.reduce((s, t) => s + (t.duration || 0), 0))].join(' · ')}</p>
          <div class="actions">
            <button class="btn primary" data-play="${esc(ar.name)}" data-kind="artist">${icon('play')} Play all</button>
            <button class="btn" data-act="shuffleartist">${icon('shuffle')} Shuffle</button>
            <button class="btn" data-act="queueartist">${icon('plus')} Add to Queue</button>
          </div>
        </div>
      </div>
      ${top.length ? `<div class="section"><div class="section-title"><h3>Most played</h3></div>${trackRows(top, { meta: (t) => plural(user.trackPlays[t.id], 'play'), context: ar.name })}</div>` : ''}
      ${ar.albums.length ? `<div class="section"><div class="section-title"><h3>Albums</h3></div>${grid(ar.albums)}</div>` : ''}
      ${ar.appears.length ? `<div class="section"><div class="section-title"><h3>Appears on</h3></div>${grid(ar.appears)}</div>` : ''}`);
    $('#view').dataset.artist = ar.name;
    highlightRows();
  }

  // ---------------- Search (your library)
  async function viewSearch(set, { q }) {
    const s = String(q || '').toLowerCase().trim();
    const artists = [...LIB.artists.values()].filter((a) => a.name.toLowerCase().includes(s)).sort((a, b) => (a.name.toLowerCase().startsWith(s) ? -1 : 1) - (b.name.toLowerCase().startsWith(s) ? -1 : 1)).slice(0, 12);
    const albums = albumsList().filter((a) => (a.title + ' ' + a.artist).toLowerCase().includes(s)).slice(0, 36);
    const songs = [...LIB.tracks.values()].filter((t) => !t.offline && (t.title + ' ' + t.artist).toLowerCase().includes(s)).slice(0, 50);
    let html = viewHead('Search', `“${esc(q)}”`);
    if (!artists.length && !albums.length && !songs.length) html += emptyState('search', 'No results', `Nothing in your library matched “${esc(q)}”.`);
    if (artists.length) html += `<div class="result-group"><div class="section-title"><h3>Artists</h3></div><div class="artist-chips">${artists.map(artistChip).join('')}</div></div>`;
    if (albums.length) html += `<div class="result-group"><div class="section-title"><h3>Albums</h3></div>${grid(albums)}</div>`;
    if (songs.length) html += `<div class="result-group"><div class="section-title"><h3>Songs</h3></div>${trackRows(songs, { context: `Search: ${q}` })}</div>`;
    set(html);
    highlightRows();
  }

  // ---------------- Playlist
  function plResolve(pl) {
    return pl.tracks.map((e) => { const t = LIB.tracks.get(e.id); return t ? { ...t } : { ...e, offline: !e.path, missing: true }; });
  }
  async function viewPlaylist(set, { id }) {
    const pl = getPlaylist(id);
    if (!pl) { set(emptyState('queue', 'Playlist not found', 'It may have been deleted.')); return; }
    const tracks = plResolve(pl);
    const arts = [...new Set(tracks.map((t) => (LIB.albums.get(t.albumId) || {}).art).filter(Boolean))].slice(0, 4);
    const total = tracks.reduce((a, t) => a + (t.duration || 0), 0);
    const mosaic = arts.length >= 4 ? `<div class="mosaic">${arts.map((a) => `<img src="${esc(a)}" alt="">`).join('')}</div>`
      : arts.length ? `<img src="${esc(arts[0])}" alt="">` : `<div class="noart">${icon('queue')}</div>`;
    set(`
      <div class="album-head">
        <div class="cover">${mosaic}</div>
        <div class="meta">
          <div class="kicker">Playlist</div>
          <h1>${esc(pl.name)}</h1>
          <div class="facts">${plural(tracks.length, 'song')}${total ? ' · ' + fmtLong(total) : ''}</div>
          <div class="actions">
            <button class="btn primary" data-act="plplay" ${tracks.length ? '' : 'disabled'}>${icon('play')} Play</button>
            <button class="btn" data-act="plshuffle" ${tracks.length ? '' : 'disabled'}>${icon('shuffle')} Shuffle</button>
            <button class="btn" data-act="plqueue" ${tracks.length ? '' : 'disabled'}>${icon('plus')} Add to Queue</button>
            ${pl.id === LIKED ? '' : `<button class="btn" data-act="plrename">${icon('sliders')} Rename</button>
            <button class="btn" data-act="pldelete">${icon('trash')} Delete</button>`}
          </div>
        </div>
      </div>
      ${tracks.length ? `<div class="tracks">${tracks.map((t, i) => `
        <div class="trow pltrow ${t.missing ? 'disabled' : ''}" data-pli="${i}" data-id="${esc(t.id)}">
          <span class="num"><span class="n">${i + 1}</span><span class="pc" data-act="plplaytrack">${icon('playCircle')}</span><span class="spk" hidden>${icon('speaker')}</span></span>
          <span class="ell"><div class="t-title ell">${esc(t.title)}</div><div class="t-sub ell">${esc(t.artist)} — ${esc(t.album)}${t.missing ? ' · not in your library right now' : ''}</div></span>
          <span class="dur">${fmt(t.duration)}</span>
          <span class="row-btns"><button class="more" data-act="plup" title="Move up">${icon('chevUp')}</button><button class="more" data-act="plremove" title="Remove from playlist">${icon('close')}</button></span>
        </div>`).join('')}</div>`
      : emptyState('queue', 'This playlist is empty', 'Use the + next to any song, or “Add to playlist” on an album.')}`);
    highlightRows();
  }
  async function playPlaylist(pl, idx = 0, shuffled = false) {
    let tracks = plResolve(pl).filter((t) => !t.missing);
    // songs that were opened from outside the library: open them again by path
    const loose = pl.tracks.filter((e) => !LIB.tracks.get(e.id) && e.path);
    if (loose.length) { const opened = await api.lib.openPaths(loose.map((e) => e.path), false); tracks = pl.tracks.map((e) => LIB.tracks.get(e.id) || opened.find((o) => o.id === e.id)).filter(Boolean); }
    if (!tracks.length) return toast('None of these songs are available right now');
    playTracks(tracks, Math.min(idx, tracks.length - 1), { title: pl.name, playlist: pl.id }, shuffled);
  }

  // ---------------- Settings
  const ZUNE_COLORS = { pink: ['#ec008c', '#f7941d'], magenta: ['#d1007f', '#ff5aa5'], orange: ['#f26522', '#ffb347'], red: ['#d71920', '#ff6a3d'], green: ['#6bbd45', '#c8e64a'], blue: ['#1ba1e2', '#7fd3ff'], brown: ['#6b4a33', '#b8865a'], black: ['#3a3a3a', '#8a8a8a'], white: ['#c9c9c9', '#ffffff'] };
  const ALL_SKINS = [
    ['rdio', 'Rdio', 'The Bndcmp look: Light, Evening, Midnight', [['light', 'Light'], ['evening', 'Evening'], ['midnight', 'Midnight']]],
    ['zune', 'Zune', 'Big lowercase type, pivots and a pink glow', [['dark', 'Dark'], ['light', 'Light']]],
    ['wmp', 'Media Player', 'Glossy 2000s chrome, tabs and a big round play button', [['onyx', 'Onyx (11–12)'], ['azure', 'Azure (9–10)']]]
  ];
  const SKINS = ALL_SKINS.filter((x) => PRODUCT.skins.includes(x[0]));
  async function viewSettings(set) {
    const w = settings.widget;
    const sw = (key, on) => `<button class="switch ${on ? 'on' : ''}" data-setting="${key}"></button>`;
    const seg = (key, val, opts) => `<div class="seg">${opts.map(([v, l]) => `<button data-setting="${key}" data-value="${v}" class="${String(val) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const sk = skin();
    const curSkin = SKINS.find((x) => x[0] === sk);
    const devices = { touch: 'Touch', pad: 'Pad', wheel: 'Wheel' };
    const isDevice = !!devices[w.mode];
    set(`
      <div class="view-head"><h1>Settings</h1></div>
      <div class="settings">
        <div class="set-group">
          <h3>${SKINS.length > 1 ? 'Skin' : 'Look'}</h3><p class="hint">${SKINS.length > 1 ? 'Each skin changes the whole app, its mini players included.' : sk === 'rdio' ? 'Rdio blue stays the accent in every theme.' : 'Pick a canvas and an accent colour.'}</p>
          ${SKINS.length > 1 ? `<div class="skin-cards">
            ${SKINS.map(([k, l, d]) => `
              <button class="skin-card ${sk === k ? 'on' : ''}" data-setting="skin" data-value="${k}">
                <div class="skin-pv skin-pv-${k}"><i class="t"></i><i class="s"></i><i class="m"></i><i class="b"></i></div>
                <span>${l}</span><small>${d}</small>
              </button>`).join('')}
          </div>` : ''}
          <div class="set-row"><label>Theme</label>${seg('theme', settings.themes[sk], curSkin[3])}</div>
          ${sk === 'rdio' && settings.themes.rdio === 'evening' ? `<div class="set-row"><label>Evening tone</label>${seg('eveningTone', settings.eveningTone || 'both', [['purple', 'Purple'], ['amber', 'Amber'], ['both', 'Both']])}</div>` : ''}
          ${sk === 'rdio' && settings.themes.rdio === 'light' ? `<div class="set-row"><label>Rdio-blue line under the title bar</label>${sw('lightLine', !!settings.lightLine)}</div>` : ''}
          ${sk === 'zune' ? `<div class="set-row"><label>Accent colour</label><div class="swatches">${Object.entries(ZUNE_COLORS).map(([k, [a, b]]) => `<button class="swatch ${settings.zuneColor === k ? 'on' : ''}" data-setting="zuneColor" data-value="${k}" title="${k}" style="background:linear-gradient(135deg,${a},${b})"></button>`).join('')}</div></div>` : ''}
          ${sk === 'rdio' ? `<div class="set-row"><label>Player</label>${seg('playerLayout', settings.playerLayout, [['sidebar', 'Sidebar'], ['bar', 'Bottom bar'], ['both', 'Both']])}</div>` : ''}
        </div>
        <div class="set-group">
          <h3>Music folders</h3><p class="hint">Folders on this PC, external drives and network shares. If a drive is unplugged, its music waits until it’s back.</p>
          <div class="folders">${LIB.roots.length ? LIB.roots.map((r) => `
            <div class="folder-row ${r.online ? '' : 'off'}">${icon('folder')}<span class="ell">${esc(r.path)}</span>${r.online ? '' : '<em>Not connected</em>'}<button class="more" data-act="removefolder" data-path="${esc(r.path)}" title="Remove from library">${icon('close')}</button></div>`).join('')
            : '<p class="soft-note" style="margin:0 0 10px">No folders yet.</p>'}</div>
          <div class="actions" style="margin-top:12px">
            <button class="btn primary" data-act="addfolder">${icon('plus')} Add folder</button>
            <button class="btn" data-act="rescan">${icon('repeat')} Rescan</button>
            <button class="btn" data-act="openfiles">${icon('disc')} Open files</button>
          </div>
          <p class="hint" style="margin-top:12px">${plural(LIB.tracks.size, 'song')} · ${plural(albumsList().length, 'album')}${LIB.scanning ? ` · ${esc(LIB.scanning.phase.toLowerCase())}…` : ''}</p>
        </div>
        <div class="set-group">
          <h3>Album art</h3><p class="hint">${NAME} uses art from your files and folders first. When it’s missing or smaller than you’d like, it looks for an HD scan online.</p>
          <div class="set-row"><label>Find HD art online</label>${sw('onlineArt', settings.onlineArt)}</div>
          <div class="set-row"><label>Upgrade art smaller than</label>${seg('minArtSize', settings.minArtSize, [[600, '600 px'], [1000, '1000 px'], [1500, '1500 px'], [3000, 'Always']])}</div>
          <div class="set-row"><label>MusicBrainz Cover Art Archive <small>free, open</small></label>${sw('artCAA', settings.artCAA)}</div>
          <div class="set-row"><label>Apple Music catalogue <small>up to 3000 px</small></label>${sw('artITunes', settings.artITunes)}</div>
          <div class="set-row"><label>Discogs personal token <small>optional; free from your Discogs account → Settings → Developers</small></label>
            <input class="text-in" id="discogsToken" type="password" spellcheck="false" placeholder="Paste token" value="${esc(settings.discogsToken || '')}">
            <button class="btn" data-act="discogshelp">${icon('external')} Get one</button></div>
          ${LIB.artBusy ? `<p class="hint"><span class="spinner small inline"></span> Finding album art…</p>` : ''}
        </div>
        <div class="set-group">
          <h3>Now Playing</h3><p class="hint">${isZune() ? 'A wall of your album art behind the song, or the record on its own.' : 'What comes with the cover on the Now Playing screen.'}</p>
          ${isZune() ? `<div class="set-row"><label>Style</label>${seg('zuneNp', settings.zuneNp || 'mosaic', [['mosaic', 'Album wall'], ['record', 'Record']])}</div>` : ''}
          ${!zMosaicNP() ? `<div class="set-row"><label>Format</label>${seg('nowPlayingMedia', settings.nowPlayingMedia || 'vinyl', [['vinyl', 'Vinyl'], ['cd', 'CD'], ['cassette', 'Cassette']])}</div>
          ${(settings.nowPlayingMedia || 'vinyl') === 'cd' ? `<div class="set-row"><label>CD shows</label>${seg('cdFace', settings.cdFace || 'art', [['art', 'Printed cover'], ['data', 'Shiny underside']])}</div>` : ''}
          ${(settings.nowPlayingMedia || 'vinyl') === 'cassette' ? `<div class="set-row"><label>Cassette</label>${seg('cassetteMode', settings.cassetteMode || 'case', [['case', 'Out of its case'], ['solo', 'Cassette only']])}</div>` : ''}
          <div class="set-row"><label>Tilt the record when I move my mouse over it</label>${sw('npTilt', !!settings.npTilt)}</div>
          <p class="hint" style="margin-top:8px">Tip: right-click the record, CD or cassette on Now Playing to switch.</p>` : ''}
        </div>
        <div class="set-group">
          <h3>Visualizers</h3><p class="hint">The Earth visualizer can play your own video instead of the built-in globe. It plays muted and loops, pauses with the music, and pulses a little on the beat.</p>
          <div class="set-row"><label>Earth video</label><span class="set-file ell">${settings.earthVideo ? esc(settings.earthVideo.split(/[\\/]/).pop()) : 'Built-in globe'}</span>
            <button class="btn" data-act="pickEarth">${settings.earthVideo ? 'Change…' : 'Use my video…'}</button>${settings.earthVideo ? `<button class="btn" data-act="clearEarth">Use built-in</button>` : ''}</div>
        </div>
        <div class="set-group">
          <h3>Mini player</h3><p class="hint">A separate little player for your desktop. Right-click it for the same options. Bar, Classic and Square match the app’s look.</p>
          <div class="set-row"><label>Show mini player</label>${sw('widget.open', w.open)}</div>
          <div class="set-row"><label>Style</label>${seg('widget.mode', w.mode, [['bar', 'Bar'], ['card', 'Classic'], ['square', 'Square'], ['cdplayer', 'CD Player'], ['vinyl', 'Vinyl'], ['cassette', 'Cassette']])}</div>
          ${PRODUCT.devices ? `<div class="set-row"><label>Pocket player</label>${seg('widget.mode', w.mode, Object.entries(devices))}</div>` : ''}
          ${isDevice ? `<div class="set-row"><label>${devices[w.mode]} colour</label><div class="swatches">${['black', 'brown', 'white', 'pink', 'red', 'green', 'blue', 'platinum', 'magenta', 'orange'].map((c) => `<button class="swatch dev-${c} ${(w.deviceColors || {})[w.mode] === c ? 'on' : ''}" data-setting="widget.deviceColor" data-value="${c}" title="${c}"></button>`).join('')}</div></div>
            <div class="set-row"><label>Size</label>${seg('widget.deviceScale', w.deviceScale || 1, [[0.85, 'Small'], [1, 'Normal'], [1.2, 'Large']])}</div>` : ''}
          <div class="set-row"><label>Behaviour</label>${seg('widget.onTop', w.onTop ? 'top' : 'desk', [['top', 'Always on top'], ['desk', 'Desktop widget']])}</div>
          ${w.mode === 'bar' || w.mode === 'card' ? `<div class="set-row"><label>Show queue</label>${sw('widget.showQueue', w.showQueue)}</div>` : ''}
          ${w.mode === 'square' ? `<div class="set-row"><label>Square size</label>${seg('widget.squareSize', String(w.squareSize), [['140', 'S'], ['220', 'M'], ['300', 'L'], ['400', 'XL']])}</div>` : ''}
          <div class="set-row"><label>Lock position</label>${sw('widget.locked', w.locked)}</div>
        </div>
        <div class="set-group">
          <h3>Window</h3>
          <div class="set-row"><label>Keep playing in the tray when I close the window</label>${sw('closeToTray', settings.closeToTray)}</div>
        </div>
      </div>`);
  }

  // ------------------------------------------------------------------ playlists index (used by the Zune and Media Player tabs)
  async function viewPlaylists(set) {
    const lists = user.playlists || [];
    const tile = (pl) => {
      const arts = [...new Set(plResolve(pl).map((t) => (LIB.albums.get(t.albumId) || {}).art).filter(Boolean))].slice(0, 4);
      return `<div class="card" data-route="playlist" data-pl="${esc(pl.id)}"><div class="cover mosaic-cover">${arts.length >= 4 ? `<div class="mosaic">${arts.map((a) => `<img src="${esc(a)}" alt="">`).join('')}</div>` : arts.length ? `<img src="${esc(arts[0])}" alt="">` : `<div class="noart">${icon('queue')}</div>`}</div>
        <div class="card-title ell">${esc(pl.name)}<button class="pl-star ${pl.fav ? 'on' : ''}" data-act="plfav" data-id="${esc(pl.id)}" title="${pl.fav ? 'Remove from the sidebar' : 'Show in the sidebar'}">${icon(pl.fav ? 'starOn' : 'starOff')}</button></div><div class="card-sub">${plural(pl.tracks.length, 'song')}</div></div>`;
    };
    set(viewHead('Playlists', `${plural(lists.length, 'playlist')} · star one to keep it in the sidebar`, `<button class="pill" data-act="newplaylist">${icon('plus')} New playlist</button>`) +
      (lists.length ? `<div class="grid">${lists.map(tile).join('')}</div>` : emptyState('queue', 'No playlists yet', 'Make one with New playlist, or “Add to playlist” on any album or song.')));
  }

  // ------------------------------------------------------------------ nav, tabs + titlebar
  const COLLECTION = ['albums', 'artists', 'songs', 'genres', 'genre', 'album', 'artist'];
  function renderNav() {
    const r = route().route;
    const params = route().params || {};
    const np = !$('#nowPlaying').hidden;
    const s = skin();
    const item = (key, label, extra = '', ic = '') =>
      `<a class="nav-item ${!np && r === key ? 'active' : ''}" data-route="${key}">${ic ? icon(ic) : ''}${label}${extra}</a>`;
    const lists = (user.playlists || []).filter((pl) => pl.fav).map((pl) => `
      <a class="nav-lib ${!np && r === 'playlist' && params.id === pl.id ? 'active' : ''}" data-route="playlist" data-pl="${esc(pl.id)}">
        ${icon('queue')}<span class="ell" style="min-width:0">${esc(pl.name)}<small>${plural(pl.tracks.length, 'song')}</small></span>
      </a>`).join('');
    const counts = (n) => (n ? `<span class="count">${n.toLocaleString()}</span>` : '');
    const status = LIB.scanning ? `<div class="nav-status"><span class="spinner small inline"></span>${esc(LIB.scanning.phase)}${LIB.scanning.total ? ` ${Math.round((LIB.scanning.done / LIB.scanning.total) * 100)}%` : '…'}</div>`
      : LIB.artBusy ? `<div class="nav-status"><span class="spinner small inline"></span>Finding album art…</div>` : '';
    const wmpIc = s === 'wmp';
    $('#nav').innerHTML = `
      ${item('home', s === 'wmp' ? 'Recently Added' : 'Home', '', wmpIc ? 'home' : '')}
      ${item('rotation', 'Heavy Rotation', '', wmpIc ? 'station' : '')}
      <a class="nav-item ${np ? 'active' : ''} ${P.playing ? 'playing' : ''}" data-act="nowplaying">${wmpIc ? icon('disc') : ''}Now Playing ${icon('nowPlaying', 'eq')}</a>
      <div class="nav-head">${s === 'wmp' ? 'Library' : 'Your music'}</div>
      ${item('artists', 'Artists', counts([...LIB.artists.values()].filter((a) => a.albums.length).length), wmpIc ? 'user' : '')}
      ${item('albums', 'Albums', counts(albumsList().length), wmpIc ? 'disc' : '')}
      ${item('songs', 'Songs', counts(LIB.tracks.size), wmpIc ? 'note' : '')}
      ${item('genres', 'Genres', counts(LIB.genres.size), wmpIc ? 'collection' : '')}
      <a class="nav-item ${!np && r === 'playlist' && params.id === LIKED ? 'active' : ''}" data-route="playlist" data-pl="${LIKED}">Liked${counts(Object.keys(user.loved || {}).length)}</a>
      ${item('playlists', 'Playlists', counts((user.playlists || []).length))}
      ${lists ? `<div class="nav-head">Favourite playlists</div>${lists}` : ''}
      <div class="nav-head">&nbsp;</div>
      ${item('settings', 'Settings', '', wmpIc ? 'sliders' : '')}
      ${status}`;
    renderTabs(r, np);
  }
  function renderTabs(r, np) {
    const s = skin();
    const tabs = $('#tabs');
    if (s === 'zune') {
      const inColl = (COLLECTION.includes(r) || r === 'playlists' || r === 'playlist') && !np;
      const qp = !np && (r === 'home' || r === 'rotation' || r === 'search');
      const sub = [['artists', 'ARTISTS'], ['genres', 'GENRES'], ['albums', 'ALBUMS'], ['songs', 'SONGS'], ['playlists', 'PLAYLISTS']];
      const subOn = (k) => r === k || (k === 'albums' && r === 'album') || (k === 'artists' && r === 'artist') || (k === 'genres' && r === 'genre') || (k === 'playlists' && r === 'playlist');
      tabs.innerHTML = `
        <div class="zt-bar">
          <div class="zt-main"><a data-route="home" class="${qp ? 'on' : ''}">quickplay</a><a data-route="artists" class="${inColl ? 'on' : ''}">collection</a></div>
          <div class="zt-sub">${inColl ? sub.map(([k, l]) => `<a data-route="${k}" class="${subOn(k) ? 'on' : ''}">${l}</a>`).join('') : ''}</div>
        </div>`;
    } else if (s === 'wmp') {
      const libOn = !np && r !== 'settings' && r !== 'playlists' && r !== 'playlist';
      tabs.innerHTML = `<div class="wt">
        <a data-act="nowplaying" class="${np ? 'on' : ''}">Now Playing</a>
        <a data-route="albums" class="${libOn ? 'on' : ''}">Library</a>
        <a data-route="playlists" class="${!np && (r === 'playlists' || r === 'playlist') ? 'on' : ''}">Playlists</a>
        <a data-act="musicmode">Visualizations</a>
        <a data-act="widget">Mini Player</a>
        <a data-route="settings" class="${!np && r === 'settings' ? 'on' : ''}">Options</a></div>`;
    } else tabs.innerHTML = '';
  }

  function applySettings() {
    const html = document.documentElement;
    const s = skin();
    const th = (settings.themes || {})[s];
    html.dataset.skin = s;
    $('#navBack').innerHTML = icon(s === 'zune' ? 'arrowLeft' : 'back');
    html.dataset.theme = s === 'rdio' ? th || 'midnight' : `${s}-${th}`;
    html.dataset.layout = s === 'rdio' ? settings.playerLayout : 'bar';
    html.dataset.tone = settings.eveningTone || 'both';
    html.dataset.topline = settings.lightLine ? 'on' : 'off';
    const zc = ZUNE_COLORS[settings.zuneColor] || ZUNE_COLORS.pink;
    html.style.setProperty('--zune-a', zc[0]);
    html.style.setProperty('--zune-b', zc[1]);
    const dark = !/light|azure/.test(html.dataset.theme);
    $('#themeBtn').innerHTML = icon(s === 'rdio' ? (th === 'light' ? 'sun' : th === 'evening' ? 'sunset' : 'moon') : dark ? 'moon' : 'sun');
    $('#themeBtn').title = SKINS.length > 1 ? 'Theme (click to switch, right-click for skins)' : 'Switch theme';
    $('#widgetBtn').classList.toggle('on', !!settings.widget.open);
    $('#searchInput').placeholder = s === 'wmp' ? 'Search library' : s === 'zune' ? 'search your collection' : 'Search your music';
    if (!audio.muted) audio.volume = settings.volume ?? 0.8;
  }
  function cycleTheme() {
    const s = skin();
    const opts = SKINS.find((x) => x[0] === s)[3].map((o) => o[0]);
    const curT = settings.themes[s];
    changeSetting('theme', opts[(opts.indexOf(curT) + 1) % opts.length]);
  }

  // ------------------------------------------------------------------ small dialog
  function ask({ title, text = '', placeholder = '', value = '', ok = 'Add' }) {
    return new Promise((resolve) => {
      const m = document.createElement('div');
      m.className = 'modal';
      m.innerHTML = `<form class="modal-box"><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}
        <input spellcheck="false" placeholder="${esc(placeholder)}" value="${esc(value)}">
        <div class="modal-actions"><button type="button" class="btn" data-x>Cancel</button><button type="submit" class="btn primary">${esc(ok)}</button></div></form>`;
      document.body.appendChild(m);
      const input = $('input', m);
      input.focus(); input.select();
      const done = (v) => { m.remove(); resolve(v); };
      $('form', m).onsubmit = (e) => { e.preventDefault(); done(input.value.trim() || null); };
      $('[data-x]', m).onclick = () => done(null);
      m.addEventListener('mousedown', (e) => { if (e.target === m) done(null); });
      m.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } });
    });
  }

  // ------------------------------------------------------------------ playlists
  const newId = () => Math.random().toString(36).slice(2, 10);
  const plEntry = (t) => ({ id: t.id, path: t.path, title: t.title, artist: t.artist, album: t.album, albumId: t.albumId, duration: t.duration });
  async function newPlaylist(tracks = []) {
    const name = await ask({ title: 'New playlist', placeholder: 'Playlist name', value: 'My playlist', ok: 'Create' });
    if (!name) return null;
    const pl = { id: newId(), name, tracks: tracks.map(plEntry), created: Date.now() };
    user.playlists = [...(user.playlists || []), pl];
    saveUser(); renderNav();
    toast(tracks.length ? `Created “${name}” with ${plural(pl.tracks.length, 'song')}` : `Created “${name}”`);
    return pl;
  }
  function addToPlaylist(pl, tracks) {
    if (!tracks.length) return;
    pl.tracks.push(...tracks.map(plEntry));
    saveUser(); renderNav();
    toast(tracks.length > 1 ? `Added ${plural(tracks.length, 'song')} to “${pl.name}”` : `Added “${tracks[0].title}” to “${pl.name}”`);
    if (route().route === 'playlist' && route().params.id === pl.id) render(true);
  }
  function playlistMenu(x, y, tracks) {
    showMenu(x, y, [
      ...(user.playlists || []).map((pl) => ({ label: pl.name, icon: 'queue', fn: () => addToPlaylist(pl, tracks) })),
      ...((user.playlists || []).length ? ['-'] : []),
      { label: 'New playlist…', icon: 'plus', fn: () => newPlaylist(tracks) }
    ]);
  }
  const LIKED = 'liked';
  const likedList = () => ({ id: LIKED, name: 'Liked', tracks: Object.entries(user.loved || {}).sort((a, b) => b[1] - a[1]).map(([id]) => ({ id })) });
  const getPlaylist = (id) => (id === LIKED ? likedList() : (user.playlists || []).find((p) => p.id === id));

  // ------------------------------------------------------------------ menus + toast
  function showMenu(x, y, items) {
    const m = $('#menu');
    m.innerHTML = items.map((it, i) => (it === '-' ? '<hr>' : `<button data-mi="${i}">${it.icon ? icon(it.icon) : ''}${esc(it.label)}</button>`)).join('');
    m.hidden = false;
    const r = m.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
    m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
    m.onclick = (e) => {
      const b = e.target.closest('[data-mi]');
      if (!b) return;
      hideMenu();
      items[+b.dataset.mi].fn();
    };
  }
  const hideMenu = () => { $('#menu').hidden = true; };
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3400);
  }

  function albumMenu(x, y, a) {
    const tracks = () => albumTracks(a).map(qTrack);
    showMenu(x, y, [
      { label: 'Play', icon: 'play', fn: () => playAlbum(a) },
      { label: 'Shuffle', icon: 'shuffle', fn: () => playAlbum(a, 0, true) },
      { label: 'Play next', icon: 'queue', fn: () => playNext(tracks()) },
      { label: 'Add to queue', icon: 'plus', fn: () => addToQueue(tracks()) },
      { label: 'Add to playlist…', icon: 'queue', fn: () => playlistMenu(x, y, tracks()) },
      '-',
      { label: `Go to ${a.artist}`, icon: 'user', fn: () => go('artist', { name: a.artist }) },
      ...(isZune() ? [{ label: pinned(a.id) ? 'Unpin from quickplay' : 'Pin to quickplay', icon: 'plus', fn: () => togglePin(a) }] : []),
      { label: 'Look up HD art online', icon: 'image', fn: () => lookUpArt(a) },
      { label: 'Choose art from a file…', icon: 'image', fn: () => api.art.choose(a.id) },
      { label: 'Show in folder', icon: 'folder', fn: () => api.lib.showItem(a.trackIds[0]) }
    ]);
  }
  function lookUpArt(a) {
    api.art.lookup(a.id);
    toast(`Looking for HD art for “${a.title}”…`);
  }
  function artistMenu(x, y, ar) {
    showMenu(x, y, [
      { label: 'Play all', icon: 'play', fn: () => playItem(ar.name, 'artist') },
      { label: 'Shuffle', icon: 'shuffle', fn: () => playTracks(artistTracks(ar), 0, { title: ar.name }, true) },
      { label: 'Add to queue', icon: 'plus', fn: () => queueItem(ar.name, 'artist', 'end') },
      { label: 'Open', icon: 'user', fn: () => go('artist', { name: ar.name }) }
    ]);
  }
  function trackMenu(x, y, t, playFn) {
    const q = qTrack(t);
    showMenu(x, y, [
      { label: 'Play', icon: 'play', fn: playFn || (() => playTracks([t])) },
      { label: 'Play next', icon: 'queue', fn: () => playNext([q]) },
      { label: 'Add to queue', icon: 'plus', fn: () => addToQueue([q]) },
      { label: 'Add to playlist…', icon: 'queue', fn: () => playlistMenu(x, y, [q]) },
      { label: loved(t.id) ? 'Unlike' : 'Like', icon: 'heart', fn: () => { toggleLove(t); renderNav(); if (route().route === 'playlist' && route().params.id === LIKED) render(true); } },
      '-',
      ...(t.albumId ? [{ label: 'Go to album', icon: 'disc', fn: () => go('album', { id: t.albumId }) }] : []),
      { label: `Go to ${t.artist}`, icon: 'user', fn: () => go('artist', { name: t.artist }) },
      { label: 'Show in folder', icon: 'folder', fn: () => api.lib.showItem(t.id) },
      { label: formatOf(t) || 'Unknown format', icon: 'disc', fn: () => {} }
    ]);
  }
  const rowTrack = (row) => {
    const list = rowLists[row.closest('[data-list]').dataset.list];
    return { list, i: +row.dataset.ti, t: list.tracks[+row.dataset.ti] };
  };
  const playRow = (row) => { const { list, i } = rowTrack(row); playTracks(list.tracks.filter((x) => !x.offline), list.tracks.filter((x) => !x.offline).indexOf(list.tracks[i]), { title: list.context }); };

  // ------------------------------------------------------------------ events
  function openInput(text) {
    text = text.trim();
    if (text) go('search', { q: text });
  }

  document.addEventListener('click', async (e) => {
    if (!e.target.closest('#menu')) hideMenu();
    const vz = e.target.closest('[data-viz]');
    if (vz) { setViz(vz.dataset.viz); renderVizList(); wakeHud(); return; }
    const sp = e.target.closest('[data-spec]');
    if (sp) { settings = await api.settings.set({ spectrumTheme: sp.dataset.spec }); renderVizList(); wakeHud(); return; }
    if (MM.open && !e.target.closest('#mmList,[data-act="mmlist"]')) toggleVizList(false);
    const el = e.target.closest('[data-act],[data-play],[data-open],[data-route],[data-setting],[data-sort],[data-songsort],[data-qi],[data-coll],[data-zalbum],[data-zvol]');
    if (!el) return;

    if (el.matches('[data-play]')) { e.stopPropagation(); playItem(el.dataset.play, el.dataset.kind); return; }
    if (el.dataset.coll) { coll[el.dataset.coll] = el.dataset.val || null; coll.album = null; const sc = $('.zc-left .zc-list'); const top = sc ? sc.scrollTop : 0; await render(true); if ($('.zc-left .zc-list')) $('.zc-left .zc-list').scrollTop = top; return; }
    if (el.dataset.zalbum) { coll.album = coll.album === el.dataset.zalbum ? null : el.dataset.zalbum; const l = $('.zc-left .zc-list'), m = $('#zcAlbums'); const t1 = l ? l.scrollTop : 0, t2 = m ? m.scrollTop : 0; await render(true); if ($('.zc-left .zc-list')) $('.zc-left .zc-list').scrollTop = t1; if ($('#zcAlbums')) $('#zcAlbums').scrollTop = t2; return; }
    if (el.matches('[data-zvol]')) { toggleMute(); for (const v of $$('[data-zvol]')) v.textContent = audio.muted ? 'MUTED' : `VOLUME ${Math.round(audio.volume * 100)}`; return; }
    if (el.dataset.setting) return changeSetting(el.dataset.setting, el.dataset.value);
    if (el.dataset.qi !== undefined) { load(+el.dataset.qi); return; }
    if (el.dataset.route) {
      const p = {};
      if (el.dataset.pl) p.id = el.dataset.pl;
      if (el.dataset.genre) p.genre = el.dataset.genre;
      if (el.dataset.sort) p.sort = el.dataset.sort;
      return go(el.dataset.route, p);
    }
    if (el.dataset.sort) { albumSort.by = el.dataset.sort; return render(); }
    if (el.dataset.songsort) {
      const k = el.dataset.songsort;
      songState.dir = songState.by === k ? -songState.dir : 1;
      songState.by = k;
      return render(true);
    }
    if (el.dataset.open !== undefined && !el.dataset.act) {
      if (!el.dataset.open) return;
      return el.dataset.kind === 'artist' ? go('artist', { name: el.dataset.open }) : go('album', { id: el.dataset.open });
    }

    const act = el.dataset.act;
    const r = route();
    const album = () => LIB.albums.get(r.params.id);
    switch (act) {
      case 'toggle': toggle(); break;
      case 'love': toggleLove(cur()); break;
      case 'zqueue': changeSetting('zuneQueue', !settings.zuneQueue); break;
      case 'savequeue': { const pl = await newPlaylist(P.queue); if (pl) toast(`Saved the queue as “${pl.name}”`); break; }
      case 'next': next(); break;
      case 'prev': prev(); break;
      case 'stop': pause(); seek(0); break;
      case 'shuffle': toggleShuffle(); break;
      case 'repeat': cycleRepeat(); break;
      case 'mute': toggleMute(); break;
      case 'nowplaying': toggleNowPlaying(); break;
      case 'widget': changeSetting('widget.open'); break;
      case 'station': playStation(); break;
      case 'reshuffle': { const el2 = $('#randomPicks'); if (el2) el2.innerHTML = grid(shuffleArr(albumsList()).slice(0, 12)); break; }
      case 'newplaylist': { const pl = await newPlaylist(); if (pl) go('playlist', { id: pl.id }); break; }
      case 'addfolder': if (await api.lib.addFolder()) toast('Adding your music. New albums show up as they’re found.'); break;
      case 'removefolder': {
        const yes = await ask({ title: `Remove this folder from ${NAME}?`, text: `${el.dataset.path}\n\nYour files stay where they are; ${NAME} just stops showing them.`, value: '', placeholder: 'Type REMOVE to confirm', ok: 'Remove' });
        if (yes && yes.toUpperCase() === 'REMOVE') await api.lib.removeFolder(el.dataset.path);
        break;
      }
      case 'rescan': api.lib.rescan(); toast('Rescanning your folders…'); break;
      case 'openfiles': { const tr = await api.lib.pickFiles(); if (tr && tr.length) playTracks(tr, 0, { title: 'Opened files' }); break; }
      case 'discogshelp': api.win.openExternal('https://www.discogs.com/settings/developers'); break;
      case 'playrow': playRow(el.closest('.trow')); break;
      case 'rowqueue': { const { t } = rowTrack(el.closest('.trow')); addToQueue([qTrack(t)]); break; }
      case 'rowmenu': { e.stopPropagation(); const row = el.closest('.trow'); const { t } = rowTrack(row); const b = el.getBoundingClientRect(); trackMenu(b.left - 170, b.bottom + 4, t, () => playRow(row)); break; }
      case 'songmenu': { e.stopPropagation(); const i = +el.closest('.srow').dataset.si; const b = el.getBoundingClientRect(); trackMenu(b.left - 170, b.bottom + 4, songList[i], () => playTracks(songList, i, { title: 'Songs' })); break; }
      case 'songsplay': playTracks(songList, 0, { title: 'Songs' }); break;
      case 'songsshuffle': playTracks(songList, 0, { title: 'All songs' }, true); break;
      case 'playalbum': playAlbum(album()); break;
      case 'shufflealbum': playAlbum(album(), 0, true); break;
      case 'queuealbum': addToQueue(albumTracks(album()).map(qTrack)); break;
      case 'playlistalbum': { const b = el.getBoundingClientRect(); playlistMenu(b.left, b.bottom + 4, albumTracks(album()).map(qTrack)); break; }
      case 'artmenu': {
        const a = album(); const b = el.getBoundingClientRect();
        showMenu(b.left, b.bottom + 4, [
          { label: 'Look up HD art online', icon: 'image', fn: () => lookUpArt(a) },
          { label: 'Choose art from a file…', icon: 'image', fn: () => api.art.choose(a.id) },
          ...(a.artLarge ? [{ label: `Current: ${a.artW}×${a.artH}`, icon: 'check', fn: () => {} }] : [])
        ]);
        break;
      }
      case 'showfolder': api.lib.showItem(album().trackIds[0]); break;
      case 'shuffleartist': { const ar = artistByName(r.params.name); playTracks(artistTracks(ar), 0, { title: ar.name }, true); break; }
      case 'queueartist': queueItem(r.params.name, 'artist', 'end'); break;
      case 'plplay': case 'plshuffle': playPlaylist(getPlaylist(r.params.id), 0, act === 'plshuffle'); break;
      case 'plplaytrack': playPlaylist(getPlaylist(r.params.id), +el.closest('.trow').dataset.pli); break;
      case 'plqueue': addToQueue(plResolve(getPlaylist(r.params.id)).filter((t) => !t.missing).map(qTrack)); break;
      case 'plfav': { e.stopPropagation(); const pl = getPlaylist(el.dataset.id); if (pl) { pl.fav = !pl.fav; saveUser(); renderNav(); render(true); } break; }
      case 'plremove': { if (r.params.id === LIKED) { const id = el.closest('.trow').dataset.id; delete user.loved[id]; saveUser(); renderNav(); render(true); break; }
        const pl = getPlaylist(r.params.id); pl.tracks.splice(+el.closest('.trow').dataset.pli, 1); saveUser(); renderNav(); render(true); break; }
      case 'plup': {
        const pl = getPlaylist(r.params.id), i = +el.closest('.trow').dataset.pli;
        if (i > 0) { [pl.tracks[i - 1], pl.tracks[i]] = [pl.tracks[i], pl.tracks[i - 1]]; saveUser(); render(true); }
        break;
      }
      case 'plrename': {
        const pl = getPlaylist(r.params.id);
        const name = await ask({ title: 'Rename playlist', value: pl.name, ok: 'Rename' });
        if (name) { pl.name = name; saveUser(); renderNav(); render(true); }
        break;
      }
      case 'pldelete': {
        const pl = getPlaylist(r.params.id);
        const yes = await ask({ title: `Delete “${pl.name}”?`, text: 'Type DELETE to confirm. This can’t be undone.', placeholder: 'DELETE', ok: 'Delete' });
        if (yes && yes.toUpperCase() === 'DELETE') { user.playlists = user.playlists.filter((p) => p.id !== pl.id); saveUser(); renderNav(); go('home'); }
        break;
      }
      case 'musicmode': if (npFull) { npFull = false; $('#nowPlaying').classList.remove('np-full'); } closeNowPlaying(); openMusicMode(); break;
      case 'npfull': setNpFull(!npFull); break;
      case 'pickEarth': { const f = await api.win.pickVideo(); if (f) { settings = await api.settings.get(); applyEarthVideo(); render(); } break; }
      case 'clearEarth': settings = await api.settings.set({ earthVideo: '' }); applyEarthVideo(); render(); break;
      case 'mmclose': closeMusicMode(); break;
      case 'mmlist': toggleVizList(); break;
      case 'mmprev': cycleViz(-1); break;
      case 'mmnext': cycleViz(1); break;
      case 'mmfull': api.win.fullscreen(); break;
      case 'mmnp': await closeMusicMode(true); setNpFull(true); break;
      case 'external': api.win.openExternal(el.dataset.url); break;
    }
  });

  document.addEventListener('dblclick', (e) => {
    const za = e.target.closest('[data-zalbum]');
    if (za) { const a = LIB.albums.get(za.dataset.zalbum); if (a) playAlbum(a); return; }
    const srow = e.target.closest('.srow');
    if (srow && !e.target.closest('a,button')) { playTracks(songList, +srow.dataset.si, { title: 'Songs' }); return; }
    const row = e.target.closest('.trow');
    if (!row || row.classList.contains('disabled')) return;
    if (row.dataset.pli !== undefined) { playPlaylist(getPlaylist(route().params.id), +row.dataset.pli); return; }
    if (row.closest('[data-list]')) playRow(row);
  });

  // Scrollbars stay hidden until something scrolls, then fade out again shortly after.
  document.addEventListener('scroll', (e) => {
    const el = e.target === document ? document.documentElement : e.target;
    if (!el.classList) return;
    el.classList.add('is-scrolling');
    clearTimeout(el._scrollTimer);
    el._scrollTimer = setTimeout(() => el.classList.remove('is-scrolling'), 900);
  }, true);

  // Double-click (or double-tap) an empty part of Now Playing to go in or out of full screen.
  document.addEventListener('dblclick', (e) => {
    const np = $('#nowPlaying');
    if (np.hidden || !np.contains(e.target)) return;
    if (e.target.closest('button, a, input, .np-row, .slider, .np-stage, .np-cap, .np-label, .znp-row, [data-act], [data-open]')) return;
    getSelection().removeAllRanges();
    setNpFull(!npFull);
  });


  // Right-click the record / CD / cassette on Now Playing to switch what comes with the cover.
  function mediaMenu(x, y) {
    const kind = settings.nowPlayingMedia || 'vinyl';
    const on = (k, extra) => kind === k && (!extra || extra());
    const pick = async (patch) => { settings = await api.settings.set(patch); renderNowPlayingIfOpen(); };
    showMenu(x, y, [
      { label: 'Vinyl', icon: on('vinyl') ? 'check' : 'disc', fn: () => pick({ nowPlayingMedia: 'vinyl' }) },
      { label: 'CD: printed cover', icon: on('cd', () => settings.cdFace !== 'data') ? 'check' : 'disc', fn: () => pick({ nowPlayingMedia: 'cd', cdFace: 'art' }) },
      { label: 'CD: shiny underside', icon: on('cd', () => settings.cdFace === 'data') ? 'check' : 'disc', fn: () => pick({ nowPlayingMedia: 'cd', cdFace: 'data' }) },
      { label: 'Cassette, with its case', icon: on('cassette', () => (settings.cassetteMode || 'case') === 'case') ? 'check' : 'disc', fn: () => pick({ nowPlayingMedia: 'cassette', cassetteMode: 'case' }) },
      { label: 'Cassette only', icon: on('cassette', () => settings.cassetteMode === 'solo') ? 'check' : 'disc', fn: () => pick({ nowPlayingMedia: 'cassette', cassetteMode: 'solo' }) },
      '-',
      { label: settings.npTilt ? 'Stop tilting' : 'Tilt with the mouse', icon: 'shuffle', fn: () => pick({ npTilt: !settings.npTilt }) }
    ]);
  }

  document.addEventListener('contextmenu', (e) => {
    if (e.target.closest && e.target.closest('#nowPlaying .np-stage')) { e.preventDefault(); mediaMenu(e.clientX, e.clientY); return; }
    // Right-click anywhere in a full-screen view backs out of full screen.
    if (MM.open) { e.preventDefault(); api.win.fullscreen(false); return; }
    if (npFull) { e.preventDefault(); setNpFull(false); return; }
    const c = e.target.closest('.card[data-kind="album"],.k-tile,.k-first,.zq-tile,[data-zalbum]');
    if (c) { e.preventDefault(); const a = LIB.albums.get(c.dataset.open || c.dataset.zalbum); if (a) albumMenu(e.clientX, e.clientY, a); return; }
    const ch = e.target.closest('.chip[data-kind="artist"]');
    if (ch) { e.preventDefault(); const ar = artistByName(ch.dataset.open); if (ar) artistMenu(e.clientX, e.clientY, ar); return; }
    const row = e.target.closest('.trow[data-ti]');
    if (row && row.closest('[data-list]')) { e.preventDefault(); trackMenu(e.clientX, e.clientY, rowTrack(row).t, () => playRow(row)); return; }
    const srow = e.target.closest('.srow');
    if (srow) { e.preventDefault(); const i = +srow.dataset.si; trackMenu(e.clientX, e.clientY, songList[i], () => playTracks(songList, i, { title: 'Songs' })); return; }
    const q = e.target.closest('.np-row');
    if (q) {
      e.preventDefault();
      const i = +q.dataset.qi;
      showMenu(e.clientX, e.clientY, [
        { label: 'Play', icon: 'play', fn: () => load(i) },
        { label: 'Remove from queue', icon: 'trash', fn: () => removeFromQueue(i) },
        ...(P.queue[i].albumId ? [{ label: 'Go to album', icon: 'disc', fn: () => go('album', { id: P.queue[i].albumId }) }] : [])
      ]);
    }
  });

  document.addEventListener('input', debounce((e) => {
    const f = e.target.dataset && e.target.dataset.filter;
    if (!f) return;
    if (f === 'albums') albumSort.filter = e.target.value;
    if (f === 'artists') artistSort.filter = e.target.value;
    if (f === 'songs') songState.filter = e.target.value;
    render();
  }, 220));
  document.addEventListener('change', (e) => {
    if (e.target.id === 'discogsToken') { changeSetting('discogsToken', e.target.value.trim()); toast(e.target.value.trim() ? 'Discogs connected for album art' : 'Discogs token removed'); }
  });
  $('#view').addEventListener('scroll', () => { if ($('#songList')) requestAnimationFrame(drawSongs); }, { passive: true });

  // drop music files or folders anywhere to play them
  document.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); document.documentElement.classList.add('dropping'); } });
  document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.documentElement.classList.remove('dropping'); });
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    document.documentElement.classList.remove('dropping');
    const paths = [...(e.dataTransfer.files || [])].map((f) => api.lib.pathForFile(f)).filter(Boolean);
    if (!paths.length) return;
    toast('Opening…');
    const tracks = await api.lib.openPaths(paths, false);
    if (!tracks.length) return toast('No music found in what you dropped');
    playTracks(tracks, 0, { title: tracks.length === 1 ? tracks[0].title : 'Dropped files' });
  });

  // keep broken artwork from showing the broken-image glyph
  document.addEventListener('error', (e) => { if (e.target.tagName === 'IMG') e.target.style.visibility = 'hidden'; }, true);

  $('#searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { openInput(e.target.value); e.target.blur(); }
    if (e.key === 'Escape') e.target.blur();
  });
  $('#navBack').innerHTML = icon('back');
  $('#navFwd').innerHTML = icon('forward');
  $('.tb-search-ic').outerHTML = icon('search');
  $('#brandHome').addEventListener('click', (e) => {
    e.stopPropagation();
    hideMenu();
    if (window.closeOverlays) window.closeOverlays();
    go('home');
    $('#view').scrollTop = 0;
  });
  $('#navBack').onclick = back;
  $('#navFwd').onclick = fwd;
  $('#themeBtn').onclick = cycleTheme;
  $('#themeBtn').oncontextmenu = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (SKINS.length < 2) return;
    const b = $('#themeBtn').getBoundingClientRect();
    showMenu(b.left - 120, b.bottom + 6, SKINS.map(([k, l]) => ({ label: `${l}${skin() === k ? '  ✓' : ''}`, icon: 'sliders', fn: () => changeSetting('skin', k) })));
  };
  $('#widgetBtn').innerHTML = icon('widget');
  $('#settingsBtn').innerHTML = icon('cog');
  $('#settingsBtn').onclick = () => go('settings');
  $('#widgetBtn').onclick = () => changeSetting('widget.open');
  $('#openBtn').innerHTML = icon('folder');
  $('#openBtn').onclick = async () => { const tr = await api.lib.pickFiles(); if (tr && tr.length) playTracks(tr, 0, { title: 'Opened files' }); };

  document.addEventListener('keydown', (e) => {
    const typing = /input|textarea/i.test(document.activeElement.tagName);
    if (MM.open) {
      if (e.key === 'Escape') { if ($('#mmList') && !$('#mmList').hidden) toggleVizList(false); else closeMusicMode(); }
      else if (e.key === 'ArrowRight') cycleViz(1);
      else if (e.key === 'ArrowLeft') cycleViz(-1);
      else if (e.key === ' ') { e.preventDefault(); toggle(); }
      else if (e.key.toLowerCase() === 'f') api.win.fullscreen();
      else if (e.key.toLowerCase() === 'v') toggleVizList();
      wakeHud();
      return;
    }
    if (e.key === 'Escape' && npFull) { setNpFull(false); return; }
    if (!typing && e.key.toLowerCase() === 'm' && !e.ctrlKey) { openMusicMode(); return; }
    if (!typing && e.key.toLowerCase() === 'f' && !e.ctrlKey && !$('#nowPlaying').hidden) { setNpFull(!npFull); return; }
    if (e.key === 'Escape') { hideMenu(); closeNowPlaying(); }
    if ((e.ctrlKey && (e.key === 'f' || e.key === 'k')) || (e.key === '/' && !typing)) { e.preventDefault(); $('#searchInput').focus(); $('#searchInput').select(); }
    if (e.ctrlKey && e.key.toLowerCase() === 'o') { e.preventDefault(); $('#openBtn').click(); }
    if (typing) return;
    if (e.key === ' ') { e.preventDefault(); toggle(); }
    if (e.ctrlKey && e.key === 'ArrowRight') next();
    if (e.ctrlKey && e.key === 'ArrowLeft') prev();
    if (e.altKey && e.key === 'ArrowLeft') back();
    if (e.altKey && e.key === 'ArrowRight') fwd();
  });

  async function changeSetting(key, value) {
    let patch;
    const w = settings.widget;
    if (key === 'widget.open') patch = { widget: { open: !w.open } };
    else if (key === 'widget.onTop') patch = { widget: { onTop: value === 'top' } };
    else if (key === 'widget.squareSize') patch = { widget: { squareSize: +value } };
    else if (key === 'widget.deviceScale') patch = { widget: { deviceScale: +value } };
    else if (key === 'widget.deviceColor') patch = { widget: { deviceColors: { [w.mode]: value } } };
    else if (key === 'widget.mode') patch = { widget: { mode: value, open: true } };
    else if (key.startsWith('widget.')) { const k = key.slice(7); patch = { widget: { [k]: value !== undefined ? value : !w[k] } }; }
    else if (key === 'theme') patch = { themes: { [skin()]: value } };
    else if (key === 'minArtSize') patch = { minArtSize: +value };
    else patch = { [key]: value !== undefined ? value : !settings[key] };
    settings = await api.settings.set(patch);
    applySettings();
    renderChrome();
    renderNav();
    if (route().route === 'settings') render(true);
  }

  // the Earth visualizer reads this: your own video (served by media://video), or nothing for the built-in globe
  function applyEarthVideo() {
    window.EarthVideo = settings.earthVideo ? `media://video/v?f=${encodeURIComponent(settings.earthVideo)}` : null;
  }
  api.settings.onChange((s) => {
    settings = s;
    applySettings();
    applyEarthVideo();
    renderNowPlayingIfOpen();
    renderChrome();
    renderNav();
    if (route().route === 'settings') render(true);
  });
  api.win.onNavigate((r) => {
    if (r === 'search') { $('#searchInput').focus(); return; }
    if (r === 'nowplaying') { openNowPlaying(); return; }
    go(r);
  });
  api.lib.onChange((snap) => {
    const before = LIB.tracks.size;
    setLibrary(snap);
    renderNav();
    if (LIB.tracks.size !== before || route().route !== 'album') rerenderLibraryViews();
  });
  api.lib.onProgress((p) => {
    LIB.scanning = p;
    renderNav();
    const b = $('.scan-banner');
    if (b && p) b.outerHTML = scanBanner();
    else if (!b && p && route().route === 'home') render(true);
  });
  api.art.onBusy((b) => { LIB.artBusy = b; renderNav(); });
  // a cover arrived or got upgraded: swap it in wherever it's showing
  api.art.onUpdate((albumId, u) => {
    const a = LIB.albums.get(albumId);
    if (!a || !u) return;
    const old = a.art;
    Object.assign(a, { art: u.art, artLarge: u.artLarge, artW: u.w, artH: u.h, artSource: u.source });
    for (const img of $$(`[data-open="${CSS.escape(albumId)}"] img`)) img.src = img.closest('.k-first') ? u.artLarge : u.art;
    for (const card of $$(`.card[data-open="${CSS.escape(albumId)}"] .noart`)) card.outerHTML = `<img src="${esc(u.art)}" alt="">`;
    let touched = false;
    for (const q of P.queue) if (q.albumId === albumId) { q.art = u.art; q.artLarge = u.artLarge; touched = true; }
    if (touched) { const t = cur(); if (t && t.albumId === albumId) { tintFrom(t.art); renderChrome(); renderNowPlayingIfOpen(); emitState(); } }
    if (route().route === 'album' && route().params.id === albumId) render(true);
    else if (!old && route().route === 'artists') rerenderLibraryViews();
  });
  api.lib.onOpenFiles((tracks, play) => {
    if (play || !P.queue.length) playTracks(tracks, 0, { title: tracks.length === 1 ? tracks[0].title : 'Opened files' });
    else addToQueue(tracks.map((t) => qTrack(t)));
  });

  // ------------------------------------------------------------------ boot
  async function boot() {
    settings = await api.settings.get();
    applyEarthVideo();
    user = { recent: [], plays: {}, trackPlays: {}, playlists: [], session: null, ...(await api.user.get()) };
    applySettings();
    audio.volume = settings.volume ?? 0.8;
    setLibrary(await api.lib.get());

    const s = user.session;
    if (s && Array.isArray(s.queue) && s.queue.length) {
      const missing = s.queue.filter((e) => !LIB.tracks.get(e.id) && e.path);
      const opened = missing.length ? await api.lib.openPaths(missing.map((e) => e.path), false).catch(() => []) : [];
      const resolve = (e) => { const t = LIB.tracks.get(e.id) || opened.find((o) => o.id === e.id); return t ? qTrack(t) : null; };
      P.queue = s.queue.map(resolve).filter(Boolean);
      if (P.queue.length) {
        P.index = Math.min(Math.max(0, s.index || 0), P.queue.length - 1);
        P.resumeTime = s.time || 0;
        P.shuffle = !!s.shuffle;
        P.repeat = s.repeat || 'off';
        P.context = s.context || null;
        const t = cur();
        if (t) tintFrom(t.art);
      }
    }
    renderChrome();
    go('home');
    emitState();
    updateProgress();
    const pending = await api.lib.ready();
    if (pending && pending.length) playTracks(pending, 0, { title: pending.length === 1 ? pending[0].title : 'Opened files' });
  }

  if (api.mock) window.__zudio = { setNpFull, openMusicMode, P, setQueue, renderChrome, openNowPlaying, go, updateProgress, setTint, tintFrom, user: () => user, LIB, playAlbum, changeSetting, setViz: (id) => setViz(id) };
  boot();
})();