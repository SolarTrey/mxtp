/* Mini player. Displays state from the main window and sends commands back. */
(() => {
  const api = window.api;
  const NAME = (api.product && api.product.name) || 'Zudio';
  const SKINS = (api.product && api.product.skins) || ['zune'];
  const POCKET = !!(api.product && api.product.pocketOnly);
  const root = document.getElementById('w');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (sec) => { sec = Math.max(0, Math.floor(sec || 0)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };

  let settings = null;
  let state = null;
  let stateAt = 0;
  let structureKey = '';
  let seeking = false;

  function wavePath(peaks) {
    const step = 100 / peaks.length, wd = step * 0.56;
    return peaks.map((p, i) => {
      const h = Math.max(0.8, p * 20);
      return `M${(i * step + (step - wd) / 2).toFixed(2)} ${((20 - h) / 2).toFixed(2)}h${wd.toFixed(2)}v${h.toFixed(2)}h-${wd.toFixed(2)}z`;
    }).join('');
  }
  function setPos(sl, r) {
    const p = Math.max(0, Math.min(1, r)) * 100;
    const played = sl.querySelector('.w-played');
    if (played) played.style.clipPath = `inset(0 ${(100 - p).toFixed(2)}% 0 0)`;
    const fill = sl.querySelector('.fill');
    if (fill) fill.style.width = p.toFixed(2) + '%';
    sl.querySelector('.knob').style.left = p.toFixed(2) + '%';
  }

  const send = (cmd, arg) => api.player.command(cmd, arg);
  const now = () => {
    if (!state) return 0;
    const t = state.playing ? state.time + (performance.now() - stateAt) / 1000 : state.time;
    return Math.min(t, state.duration || t);
  };

  function waveSvgs() {
    const d = wavePath((state && state.peaks) || new Array(96).fill(0.12));
    return `<svg class="w-base" viewBox="0 0 100 20" preserveAspectRatio="none"><path d="${d}"/></svg><svg class="w-played" viewBox="0 0 100 20" preserveAspectRatio="none"><path d="${d}"/></svg>`;
  }
  function queueHtml(narrow) {
    const up = (state && state.upNext) || [];
    if (!up.length) return '<div class="queue"><div class="qempty">Your queue is empty</div></div>';
    return `<div class="queue ${narrow ? 'narrow' : ''}">${up.map((q) => `
      <div class="qrow" data-i="${q.i}">
        <span class="n">${q.i === state.index ? icon('speaker') : String(q.i + 1).padStart(2, '0')}</span>
        <span class="t ell">${esc(q.title)}</span>
        ${narrow ? '' : `<span class="a ell">${esc(q.artist)}</span>`}
        <span class="d">${fmt(q.duration)}</span>
      </div>`).join('')}</div>`;
  }


  // Touch shells, after the Zune HD's colour line-up
  const SHELLS = { black: 'black', platinum: 'platinum', blue: 'blue', red: 'red', lilac: 'lilac', purple: 'purple', lime: 'lime', slate: 'slate', rose: 'red pattern', white: 'white' };
  const ZUNE_COLORS = { pink: ['#ec008c', '#f7941d'], magenta: ['#d1007f', '#ff5aa5'], orange: ['#f26522', '#ffb347'], red: ['#d71920', '#ff6a3d'], green: ['#6bbd45', '#c8e64a'], blue: ['#1ba1e2', '#7fd3ff'], brown: ['#6b4a33', '#b8865a'], black: ['#3a3a3a', '#8a8a8a'], white: ['#c9c9c9', '#ffffff'] };
  const artOf = (t, big) => (t ? (big ? t.artLarge || t.art : t.art || t.artLarge) : null);
  const playing = () => !!(state && state.playing);
  // ---------------- pocket players (original designs in the spirit of mid-2000s players)
  const DEVICES = {
    // a glass slab with a whole pocket app on its screen (see renderTouch)
    touch(t, color) {
      return `
        <div class="dev touch shell-${SHELLS[color] ? color : 'black'} ${TS().glare ? 'glare-on' : ''}">
          <div class="glass">
            <div class="screen"><div class="tapp"></div><div class="tlock" hidden></div></div>
            <div class="glare"></div>
          </div>
          <div class="notch"><button class="hw" data-act="thome" title="Home · hold to lock"></button></div>
          <div class="band-art"></div>
        </div>`;
    },
    // a chunky player with a soft square pad: press the edges to skip and change volume
    pad(t, color) {
      const art = artOf(t);
      return `
        <div class="dev pad dev-${color}">
          <div class="screen">
            <div class="ph"><span>now playing</span><span>${state ? Math.round((state.muted ? 0 : state.volume) * 100) : 80}%</span></div>
            <div class="prow">
              <div class="part" data-act="nowplaying">${art ? `<img src="${esc(art)}" alt="">` : `<div class="blank">${icon('disc')}</div>`}</div>
              <div class="pmeta">${t ? `<div class="pa ell">${esc(t.artist)}</div><div class="pal ell">${esc(t.album || '')}</div><div class="pt ell">${esc(t.title)}</div>` : '<div class="pa">nothing playing</div>'}</div>
            </div>
            <div class="pprog"><span class="time"></span><div class="line"><i></i></div><span class="tleft"></span></div>
            <div class="pstate">${icon(playing() ? 'play' : 'pause')}${state && state.shuffle ? icon('shuffle') : ''}${state && state.repeat !== 'off' ? icon('repeat') : ''}</div>
          </div>
          <div class="controls">
            <button class="side-b" data-act="main" title="Back to ${NAME}">${icon('back')}</button>
            <div class="squircle">
              <button class="z up" data-cmd="volup" title="Volume up"></button>
              <button class="z down" data-cmd="voldown" title="Volume down"></button>
              <button class="z left" data-cmd="prev" title="Previous"></button>
              <button class="z right" data-cmd="next" title="Next"></button>
              <button class="z mid" data-cmd="toggle" title="Play/Pause"></button>
            </div>
            <button class="side-b" data-cmd="toggle" title="Play/Pause">${icon(playing() ? 'pause' : 'play')}</button>
          </div>
        </div>`;
    },
    // a click wheel: drag around it for volume, press its edges to skip
    wheel(t, color) {
      const art = artOf(t);
      return `
        <div class="dev wheel dev-${color}">
          <div class="screen">
            <div class="wh"><span>${playing() ? '▶' : '❚❚'}</span><span>Now Playing</span><span class="batt"><i></i></span></div>
            <div class="wrow">
              <div class="wart" data-act="nowplaying">${art ? `<img src="${esc(art)}" alt="">` : `<div class="blank">${icon('disc')}</div>`}</div>
              <div class="wmeta">${t ? `<div class="wt ell">${esc(t.title)}</div><div class="wa ell">${esc(t.artist)}</div><div class="wal ell">${esc(t.album || '')}</div>` : '<div class="wt">Nothing playing</div>'}</div>
            </div>
            <div class="wprog"><div class="line"><i></i></div><div class="times"><span class="time"></span><span class="tleft"></span></div></div>
            <div class="wvol" hidden><span>${icon('volume')}</span><div class="line"><i style="width:${state ? (state.muted ? 0 : state.volume) * 100 : 80}%"></i></div></div>
          </div>
          <div class="wheel-ring" data-wheel>
            <span class="lab top" data-act="main" title="Open ${NAME}">${icon('home')}</span>
            <button class="lab left" data-cmd="prev">${icon('prev')}</button>
            <button class="lab right" data-cmd="next">${icon('next')}</button>
            <button class="lab bottom" data-cmd="toggle">${icon('play')}${icon('pause')}</button>
            <button class="hub" data-cmd="toggle" title="Play/Pause"></button>
          </div>
        </div>`;
    }
  };
  function clock() { const d = new Date(); return `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`; }

  // ================================================================== Touch: a whole pocket Zudio
  // Its own little app: home menu, music (artists / albums / songs / genres), playlists, quickplay,
  // now playing, the queue and settings. Everything plays through the main window.
  const T = { stack: [{ s: 'home' }], lib: null, user: null, libAt: 0, overlay: false, npKey: '', homePanel: 'menu', locked: false, lastActive: Date.now(), booted: false };
  const tcur = () => T.stack[T.stack.length - 1];
  const tgo = (scr) => { T.stack.push(scr); T.overlay = false; renderTouch(true); };
  const tback = () => { if (T.stack.length > 1) T.stack.pop(); T.overlay = false; renderTouch(true); };
  const thome = () => { T.stack = [{ s: 'home' }]; T.overlay = false; renderTouch(true); };
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const tcmp = (a, b) => collator.compare(String(a || '').replace(/^(the|a|an)\s+/i, ''), String(b || '').replace(/^(the|a|an)\s+/i, ''));
  const nrm = (s) => String(s || '').toLowerCase().trim();

  async function loadLib(force) {
    if (!force && T.lib && Date.now() - T.libAt < 20000) return;
    const [snap, user] = await Promise.all([api.lib.get(), api.user.get()]);
    const tracks = new Map(snap.tracks.filter((t) => !t.offline).map((t) => [t.id, t]));
    const albums = new Map(snap.albums.filter((a) => !a.offline).map((a) => [a.id, a]));
    const artists = new Map();
    for (const a of albums.values()) {
      const k = nrm(a.artist);
      if (!artists.has(k)) artists.set(k, { name: a.artist, albums: [] });
      artists.get(k).albums.push(a);
    }
    const genres = new Map();
    for (const a of albums.values()) { const g = a.genre || 'Unknown genre'; if (!genres.has(g)) genres.set(g, []); genres.get(g).push(a); }
    T.lib = { tracks, albums, artists, genres };
    T.roots = snap.roots || [];
    T.libCounts = { songs: tracks.size, albums: albums.size };
    T.user = user || {};
    T.libAt = Date.now();
  }
  const aTracks = (a) => a.trackIds.map((id) => T.lib.tracks.get(id)).filter(Boolean);
  const albumArt = (a) => (a && a.art) || '';
  const thumb = (src, cls = 'tt-th') => `<div class="${cls}">${src ? `<img src="${esc(src)}" alt="">` : ''}</div>`;
  const backBtn = () => `<button class="tb-back" data-t="back" title="Back">${icon('arrowLeft')}</button>`;
  const status = () => `<div class="ts-status"><span>${state && state.playing ? '▶' : ''}</span><span class="clock">${clock()}</span><span class="batt"><i></i></span></div>`;
  const listRow = (attrs, title, sub, art) => `<div class="tl-row" ${attrs}>${art !== undefined ? thumb(art) : ''}<div class="tl-tx"><div class="tl-t ell">${esc(title)}</div>${sub ? `<div class="tl-s ell">${esc(sub)}</div>` : ''}</div></div>`;

  const PIVOTS = ['artists', 'albums', 'songs', 'genres'];
  // the jump list: each letter heads its section; tap one to see every letter and jump
  const LETTERS = '#abcdefghijklmnopqrstuvwxyz'.split('');
  const letterOf = (name) => { const c = String(name || '').replace(/^(the|a|an)\s+/i, '').trim().charAt(0).toLowerCase(); return /[a-z]/.test(c) ? c : '#'; };
  function grouped(list, nameOf, rowFn, wrap) {
    let html = '', cur = null, buf = [];
    const flush = () => { if (cur !== null) html += `<div class="tj-h" data-t="jumpgrid" id="tj-${cur === '#' ? 'num' : cur}">${cur}</div>` + (wrap ? wrap(buf.join('')) : buf.join('')); buf = []; };
    list.forEach((x, k) => { const L = letterOf(nameOf(x)); if (L !== cur) { flush(); cur = L; } buf.push(rowFn(x, k)); });
    flush();
    return html;
  }
  function screenMusic(sc) {
    const pv = sc.pivot || 'artists';
    const i = PIVOTS.indexOf(pv);
    const L = T.lib;
    let body = '';
    T.jumpHave = new Set();
    if (pv === 'artists') {
      const list = [...L.artists.values()].sort((a, b) => tcmp(a.name, b.name));
      list.forEach((a) => T.jumpHave.add(letterOf(a.name)));
      body = grouped(list, (a) => a.name, (a) => `<div class="tl-big" data-t="artist" data-v="${esc(a.name)}">${esc(a.name.toLowerCase())}</div>`);
    } else if (pv === 'albums') {
      const list = [...L.albums.values()].sort((a, b) => tcmp(a.title, b.title));
      list.forEach((a) => T.jumpHave.add(letterOf(a.title)));
      body = grouped(list, (a) => a.title, (a) => `<div class="tg-it" data-t="album" data-v="${esc(a.id)}">${thumb(albumArt(a), 'tg-th')}<div class="tl-t ell">${esc(a.title)}</div><div class="tl-s ell">${esc(a.artist)}</div></div>`, (x) => `<div class="tg">${x}</div>`);
    } else if (pv === 'songs') {
      const list = [...L.tracks.values()].sort((a, b) => tcmp(a.title, b.title));
      T.songs = list;
      list.forEach((t) => T.jumpHave.add(letterOf(t.title)));
      body = grouped(list, (t) => t.title, (t, k) => listRow(`data-t="song" data-v="${k}"`, t.title, t.artist.toUpperCase()));
    } else {
      const list = [...L.genres.entries()].sort((a, b) => tcmp(a[0], b[0]));
      body = list.map(([g, al]) => `<div class="tl-big" data-t="genre" data-v="${esc(g)}">${esc(g.toLowerCase())}<small>${al.length}</small></div>`).join('');
    }
    return `${backBtn()}${status()}
      <div class="tp-head"><span class="tp-cur" data-t="pivot" data-v="${PIVOTS[(i + 1) % 4]}">${pv}</span><span class="tp-next" data-t="pivot" data-v="${PIVOTS[(i + 1) % 4]}">${PIVOTS[(i + 1) % 4]}</span></div>
      <div class="tp-tabs">${PIVOTS.map((p) => `<a data-t="pivot" data-v="${p}" class="${p === pv ? 'on' : ''}">${p.toUpperCase()}</a>`).join('')}</div>
      <div class="tscroll tlist tmusic">${body || '<div class="tl-empty">nothing here yet</div>'}</div>
      ${sc.jump ? `<div class="tj-grid" data-t="jumpclose">${LETTERS.map((l) => `<button class="${T.jumpHave.has(l) ? '' : 'off'}" data-t="${T.jumpHave.has(l) ? 'jumpto' : 'jumpclose'}" data-v="${l}">${l}</button>`).join('')}</div>` : ''}`;
  }

  function screenArtist(sc) {
    const ar = T.lib.artists.get(nrm(sc.v));
    if (!ar) return screenMissing();
    const albums = ar.albums.slice().sort((a, b) => (b.year || 0) - (a.year || 0));
    return `${backBtn()}${status()}
      <div class="tx-head ell">${esc(ar.name.toUpperCase())}</div>
      <div class="tx-acts"><button class="tcirc" data-t="playartist" title="Play all">${icon('play')}</button><button class="tcirc" data-t="shuffleartist" title="Shuffle">${icon('shuffle')}</button><span>${albums.length} ALBUMS</span></div>
      <div class="tscroll tlist">${albums.map((a) => listRow(`data-t="album" data-v="${esc(a.id)}"`, a.title, String(a.year || '').toUpperCase(), albumArt(a))).join('')}</div>`;
  }

  function screenAlbum(sc) {
    const a = T.lib.albums.get(sc.v);
    if (!a) return screenMissing();
    const tr = aTracks(a);
    const pinnedNow = ((T.user && T.user.pins) || []).includes(a.id);
    return `${backBtn()}${status()}
      <div class="ta-top">${thumb(a.artLarge || a.art, 'ta-art')}<div class="ta-tx"><div class="ta-t">${esc(a.title)}</div><div class="ta-a">${esc(a.artist.toUpperCase())}</div><div class="ta-y">${esc([a.year, `${tr.length} songs`].filter(Boolean).join(' · '))}</div></div></div>
      <div class="tx-acts">
        <button class="tcirc" data-t="playalbum" title="Play">${icon('play')}</button>
        <button class="tcirc" data-t="shufflealbum" title="Shuffle">${icon('shuffle')}</button>
        <button class="tcirc" data-t="queuealbum" title="Add to queue">${icon('plus')}</button>
        <button class="tcirc" data-t="albumtopl" title="Add to a playlist">${icon('queue')}</button>
        <button class="tcirc ${pinnedNow ? 'on' : ''}" data-t="pin" title="${pinnedNow ? 'Unpin from quickplay' : 'Pin to quickplay'}">${icon('station')}</button>
      </div>
      <div class="tscroll tlist">${tr.map((t, k) => `<div class="tl-row tr" data-t="albumsong" data-v="${k}"><span class="tn">${t.track || k + 1}</span><div class="tl-tx"><div class="tl-t ell">${esc(t.title)}</div></div><button class="tq" data-t="queuesong" data-v="${k}" title="Add to queue">${icon('plus')}</button></div>`).join('')}</div>`;
  }

  function screenGenre(sc) {
    const list = (T.lib.genres.get(sc.v) || []).slice().sort((a, b) => tcmp(a.artist, b.artist));
    return `${backBtn()}${status()}
      <div class="tx-head ell">${esc(sc.v.toUpperCase())}</div>
      <div class="tx-acts"><button class="tcirc" data-t="shufflegenre" title="Shuffle">${icon('shuffle')}</button><span>${list.length} ALBUMS</span></div>
      <div class="tscroll tlist">${list.map((a) => listRow(`data-t="album" data-v="${esc(a.id)}"`, a.title, a.artist.toUpperCase(), albumArt(a))).join('')}</div>`;
  }

  function screenPlaylists() {
    const lists = (T.user && T.user.playlists) || [];
    const lovedN = Object.keys((T.user && T.user.loved) || {}).length;
    return `${backBtn()}${status()}
      <div class="tp-head"><span class="tp-cur">playlists</span></div>
      <div class="tscroll tlist">
        <div class="tl-big tl-new" data-t="plnew"><span class="tl-plus">${icon('plus')}</span>new playlist</div>
        <div class="tl-big" data-t="loved">loved songs<small>${lovedN}</small></div>
        ${lists.map((p) => `<div class="tl-big" data-t="playlist" data-v="${esc(p.id)}">${esc(p.name.toLowerCase())}<small>${p.tracks.length}</small></div>`).join('')}
      </div>`;
  }
  function screenPlaylist(sc) {
    const loved = sc.loved;
    const pl = loved ? null : ((T.user && T.user.playlists) || []).find((p) => p.id === sc.v);
    const entries = loved ? Object.entries((T.user && T.user.loved) || {}).sort((a, b) => b[1] - a[1]).map(([id]) => T.lib.tracks.get(id)).filter(Boolean)
      : pl ? pl.tracks.map((e) => T.lib.tracks.get(e.id) || e) : [];
    T.plTracks = entries;
    return `${backBtn()}${status()}
      <div class="tx-head ell">${esc((loved ? 'loved songs' : pl ? pl.name : 'playlist').toUpperCase())}</div>
      <div class="tx-acts"><button class="tcirc" data-t="plplay" title="Play">${icon('play')}</button><button class="tcirc" data-t="plshuffle" title="Shuffle">${icon('shuffle')}</button>
        ${pl ? `<button class="tcirc" data-t="plrename" title="Rename">${icon('sliders')}</button><button class="tcirc ${sc.sure ? 'on' : ''}" data-t="pldelete" title="${sc.sure ? 'Tap again to delete' : 'Delete'}">${icon('trash')}</button>` : ''}
        <span>${sc.sure ? 'TAP AGAIN TO DELETE' : `${entries.length} SONGS`}</span></div>
      <div class="tscroll tlist">${entries.map((t, k) => `<div class="tl-row" data-t="plsong" data-v="${k}"><div class="tl-tx"><div class="tl-t ell">${esc(t.title)}</div><div class="tl-s ell">${esc(String(t.artist || '').toUpperCase())}</div></div>${pl ? `<button class="tq" data-t="plremove" data-v="${k}" title="Remove">${icon('close')}</button>` : ''}</div>`).join('') || '<div class="tl-empty">no songs yet. add albums from music</div>'}</div>`;
  }
  // the only place you type on the device: playlist names
  function screenPlName(sc) {
    const title = sc.mode === 'rename' ? 'rename' : 'new playlist';
    return `${backBtn()}${status()}
      <div class="tp-head"><span class="tp-cur">${title}</span></div>
      <div class="tn-form">
        <div class="ts-h">NAME</div>
        <input class="tn-name" maxlength="60" spellcheck="false" placeholder="playlist name" value="${esc(sc.value || '')}">
        ${sc.ids && sc.ids.length ? `<div class="tn-hint">${sc.ids.length} SONGS WILL BE ADDED</div>` : ''}
        <div class="tn-go"><button class="tcirc" data-t="plsave" title="Save">${icon('check')}</button><span>SAVE</span></div>
      </div>`;
  }
  // pick a playlist to add songs to
  function screenPlAdd(sc) {
    const lists = (T.user && T.user.playlists) || [];
    return `${backBtn()}${status()}
      <div class="tp-head"><span class="tp-cur">add to</span></div>
      <div class="tscroll tlist">
        <div class="tl-big tl-new" data-t="plnewwith"><span class="tl-plus">${icon('plus')}</span>new playlist</div>
        ${lists.map((p) => `<div class="tl-big" data-t="pladdto" data-v="${esc(p.id)}">${esc(p.name.toLowerCase())}<small>${p.tracks.length}</small></div>`).join('')}
      </div>`;
  }

  function screenQuickplay() {
    const U = T.user || {}, L = T.lib;
    const pins = (U.pins || []).map((id) => L.albums.get(id)).filter(Boolean);
    const added = [...L.albums.values()].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).slice(0, 6);
    const hist = (U.recent || []).map((id) => L.albums.get(id)).filter(Boolean).slice(0, 6);
    const sec = (label, list) => list.length ? `<div class="tq-l">${label}</div><div class="tq-g">${list.map((a, k) => `<div class="tq-t ${k === 0 ? 'big' : ''}" data-t="album" data-v="${esc(a.id)}">${a.art ? `<img src="${esc(a.art)}" alt="">` : ''}</div>`).join('')}</div>` : '';
    return `${backBtn()}${status()}
      <div class="tp-head"><span class="tp-cur">quickplay</span></div>
      <div class="tscroll tlist">${sec('pins', pins)}${sec('new', added)}${sec('history', hist)}${!pins.length && !added.length ? '<div class="tl-empty">nothing yet</div>' : ''}</div>`;
  }

  function screenNowPlaying() {
    const t = state && state.track;
    if (!t) return `${backBtn()}${status()}<div class="tn-empty"><div class="tn-artist">NOTHING PLAYING</div><div class="tn-album">PICK SOMETHING IN MUSIC</div></div>`;
    const up = (state.upNext || []).filter((q) => q.i > state.index).slice(0, 3);
    const vol = state.muted ? 0 : state.volume;
    return `${backBtn()}${status()}
      <div class="tn-artist">${esc(t.artist)}</div>
      <div class="tn-album">${esc(t.album || '')}</div>
      <div class="tn-art" data-t="ctrl">${t.artLarge || t.art ? `<img src="${esc(t.artLarge || t.art)}" alt="">` : ''}
        <div class="tn-ov ${T.overlay ? 'on' : ''}">
          <div class="tn-tr"><button class="tcirc" data-cmd="prev">${icon('prev')}</button><button class="tcirc big" data-cmd="toggle">${icon(state.playing ? 'pause' : 'play')}</button><button class="tcirc" data-cmd="next">${icon('next')}</button></div>
          <div class="tn-vol"><span>${icon(vol ? 'volume' : 'mute')}</span><div class="slider" data-vol><div class="rail"><div class="fill" style="width:${vol * 100}%"></div></div><div class="knob" style="left:${vol * 100}%"></div></div></div>
        </div>
      </div>
      <div class="tn-prog"><div class="slider" data-seek><div class="rail"><div class="fill"></div></div><div class="knob"></div></div><div class="times"><span class="time"></span><span class="tleft"></span></div></div>
      <div class="tn-title ell">${esc(t.title)}</div>
      <div class="tn-next">${up.map((q) => `<div class="ell" data-i="${q.i}">${esc(q.title)}</div>`).join('')}</div>
      <div class="tn-btns">
        <button class="tcirc ${state.shuffle ? 'on' : ''}" data-cmd="shuffle" title="Shuffle">${icon('shuffle')}</button>
        <button class="tcirc ${state.repeat !== 'off' ? 'on' : ''}" data-cmd="repeat" title="Repeat">${icon(state.repeat === 'one' ? 'repeatOne' : 'repeat')}</button>
        <button class="tcirc" data-t="queue" title="Queue">${icon('queue')}</button>
        <button class="tcirc ${state.loved ? 'on' : ''}" data-cmd="love" title="Love">${icon('heart')}</button>
      </div>`;
  }

  function screenQueue() {
    const q = state && state.queue ? state.queue : [];
    return `${backBtn()}${status()}
      <div class="tp-head"><span class="tp-cur">queue</span></div>
      <div class="tx-acts"><button class="tcirc" data-t="savequeue" title="Save as playlist">${icon('plus')}</button><span>${state ? state.queueLength : 0} SONGS · TAP TO PLAY</span></div>
      <div class="tscroll tlist">${q.map((e) => `<div class="tl-row ${e.i === state.index ? 'cur' : ''}" data-i="${e.i}"><div class="tl-tx"><div class="tl-t ell">${e.i === state.index ? icon('nowPlaying') : ''}${esc(e.title)}</div><div class="tl-s ell">${esc(String(e.artist || '').toUpperCase())}</div></div><button class="tq" data-t="unqueue" data-v="${e.i}" title="Remove">${icon('close')}</button></div>`).join('')}</div>`;
  }

  const screenMissing = () => `${backBtn()}${status()}<div class="tl-empty">not in your collection right now</div>`;

  // ---------------- Touch, part 2: home screen with its side panel, lock screen, wallpapers, visualizer
  const TS = () => Object.assign({ lock: true, lockAfter: 120, wall: 'ribbons', wallFile: '', clock24: false, viz: 'spectrum', radioUi: 'hd', jumpStyle: 'outline', jumpCase: 'lower', glare: false }, (settings.widget && settings.widget.touch) || {});
  const setTS = (patch) => api.settings.set({ widget: { touch: patch } });
  const timeStr = (d = new Date()) => (TS().clock24 ? `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` : `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`);
  const dateStr = (d = new Date()) => d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toLowerCase();

  // built-in wallpapers: all drawn here, nothing to download
  function ribbonsSvg(seed) {
    const cols = ['#ff2d55', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#0a84ff', '#bf5af2', '#ff375f', '#ffffff'];
    let r = seed || 3; const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
    let paths = '';
    for (let i = 0; i < 34; i++) {
      const x0 = -60 + rnd() * 260, c = cols[i % cols.length], w = 4 + rnd() * 9, sw = 70 + rnd() * 80;
      paths += `<path d="M${x0} 620 C ${x0 + sw} 470, ${x0 - sw * 0.6} ${330 - rnd() * 90}, ${x0 + 120 + rnd() * 60} ${200 - rnd() * 90} S ${x0 + 40 + rnd() * 140} -20, ${x0 + 180 + rnd() * 80} -80" stroke="${c}" stroke-width="${w.toFixed(1)}" fill="none" stroke-linecap="round" opacity="${(0.65 + rnd() * 0.35).toFixed(2)}"/>`;
    }
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 276 470" preserveAspectRatio="xMidYMid slice"><rect width="276" height="470" fill="#050505"/><g transform="rotate(-14 138 235)">${paths}</g></svg>`);
  }
  const WALLS = {
    ribbons: { name: 'ribbons', css: () => `#050505 url("${ribbonsSvg(7)}") center/cover` },
    glow: { name: 'glow', css: () => `radial-gradient(circle at 80% 15%, var(--zune-b) 0, transparent 45%), radial-gradient(circle at 15% 85%, var(--zune-a) 0, transparent 50%), #0b0b0b` },
    dusk: { name: 'dusk', css: () => 'radial-gradient(circle at 50% 62%, #ffd27a 0 9%, transparent 9.5%), linear-gradient(180deg, #120a2e 0%, #5a1e5e 45%, #ff6a3d 70%, #2a0c22 71%, #0b0610 100%)' },
    lines: { name: 'lines', css: () => 'repeating-linear-gradient(115deg, rgba(255,255,255,.07) 0 2px, transparent 2px 14px), linear-gradient(160deg, #1d2a3a, #07090d)' },
    dots: { name: 'dots', css: () => 'radial-gradient(circle, color-mix(in srgb, var(--zune-a) 70%, transparent) 1.6px, transparent 2px) 0 0/12px 12px, #0d0d0d' },
    album: { name: 'album art', css: () => { const t = state && state.track; return t && (t.artLarge || t.art) ? `#000 url("${t.artLarge || t.art}") center/cover` : '#000'; } },
    black: { name: 'black', css: () => '#000' },
    custom: { name: 'your picture', css: () => (TS().wallFile ? `#000 url("media://wall/${encodeURIComponent(TS().wallFile)}") center/cover` : '#000') }
  };
  const wallCss = (id) => (WALLS[id] || WALLS.ribbons).css();

  // ---------------- home: the menu, with a side panel of what's playing, pins, history and new
  function screenHome2() {
    const t = state && state.track;
    const U = T.user || {}, L = T.lib;
    const recent = ((U.recent) || []).map((id) => L && L.albums.get(id)).filter(Boolean);
    const added = L ? [...L.albums.values()].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).slice(0, 6) : [];
    const pins = ((U.pins) || []).map((id) => L && L.albums.get(id)).filter(Boolean);
    const strip = [...(t && t.art ? [t.art] : []), ...recent.map((a) => a.art), ...added.map((a) => a.art)].filter(Boolean).slice(0, 14);
    const tiles = (list) => `<div class="hs-g">${list.slice(0, 6).map((a) => `<div class="hs-t" data-t="album" data-v="${esc(a.id)}">${a.art ? `<img src="${esc(a.art)}" alt="">` : ''}</div>`).join('')}</div>`;
    const items = [['music'], ['playlists'], ['radio'], ['now playing'], ['shuffle all'], ['visualizer'], ['settings']];
    return `${status()}
      <div class="hs ${T.homePanel === 'side' ? 'hs-open' : ''}">
        <div class="hs-side">
          <div class="hs-h" data-t="menu" data-k="now playing">Playing</div>
          ${t ? `<div class="hs-play" data-t="menu" data-k="now playing">${t.art ? `<img src="${esc(t.art)}" alt="">` : ''}<div><div class="hs-pt ell">${esc(t.title)}</div><div class="hs-pa ell">${esc(t.artist.toUpperCase())}</div></div></div>` : '<div class="hs-none">nothing playing</div>'}
          ${pins.length ? `<div class="hs-h">Pins</div>${tiles(pins)}` : ''}
          ${recent.length ? `<div class="hs-h">History</div>${tiles(recent)}` : ''}
          ${added.length ? `<div class="hs-h">New</div>${tiles(added)}` : ''}
        </div>
        <div class="hs-main">
          <div class="hs-strip" data-t="side">${strip.map((a) => `<img src="${esc(a)}" alt="">`).join('')}</div>
          <div class="hs-menu tscroll">${items.map(([k, sub], i) => `
            <div class="hs-item" data-t="menu" data-k="${k}">${i === 0 ? `<span class="hs-ic">${icon('play')}</span>` : ''}<div><div class="hs-k">${k}</div>${sub ? `<div class="hs-sub">${esc(sub.toUpperCase())}</div>` : ''}</div></div>`).join('')}</div>
        </div>
      </div>`;
  }

  // ---------------- the visualizer, right on the device
  const VZ = { inst: null, id: null, raf: 0, frame: null, art: null, artUrl: null, last: 0 };
  function screenViz() {
    const list = window.Visualizers || [];
    const cur = list.find((v) => v.id === TS().viz) || list[0];
    return `<canvas class="tv-canvas"></canvas>${backBtn()}<div class="tv-name" data-t="vizpick">${esc((cur ? cur.name : 'visualizer').toLowerCase())}</div>`;
  }
  function startViz() {
    stopViz();
    const cv = root.querySelector('.tv-canvas');
    const list = window.Visualizers || [];
    const v = list.find((x) => x.id === TS().viz) || list[0];
    if (!cv || !v) return;
    try { VZ.inst = v.create(cv); VZ.id = v.id; } catch (e) { console.error(e); return; }
    send('vizStream', true);
    const loop = (ts) => {
      VZ.raf = requestAnimationFrame(loop);
      if (!VZ.frame) return;
      const dt = Math.min(0.05, (ts - (VZ.last || ts)) / 1000); VZ.last = ts;
      const t = state && state.track;
      if (t && t.art !== VZ.artUrl) { VZ.artUrl = t.art; VZ.art = new Image(); VZ.art.src = t.artLarge || t.art; }
      const f = VZ.frame;
      const a = { freq: f.freq, wave: f.wave, bass: f.bass, mid: f.mid, treble: f.treble, level: f.level, beat: f.beat, sampleRate: f.sampleRate };
      f.beat = false;
      try { VZ.inst.frame(a, { art: VZ.art, tint: f.tint, spectrumTheme: f.spectrumTheme, playing: !!(state && state.playing), progress: state && state.duration ? now() / state.duration : 0, track: t }, dt); } catch {}
    };
    VZ.raf = requestAnimationFrame(loop);
  }
  function stopViz() {
    cancelAnimationFrame(VZ.raf);
    if (VZ.inst) { try { VZ.inst.destroy(); } catch {} VZ.inst = null; send('vizStream', false); }
  }
  api.player.onViz && api.player.onViz((f) => {
    f.freq = Uint8Array.from(f.freq);
    f.wave = Uint8Array.from(f.wave);
    VZ.frame = f;
  });

  // ---------------- settings, decluttered into sections
  function screenSettings2(sc) {
    const w = settings.widget, ts = TS();
    const sec = sc.sec;
    const opt = (t, on, attrs) => `<div class="tl-big sm ${on ? 'on' : ''}" ${attrs}>${t}</div>`;
    if (!sec) {
      return `${backBtn()}${status()}
        <div class="tp-head"><span class="tp-cur">settings</span></div>
        <div class="tscroll tlist">
          ${[...(POCKET ? [['music folders', `${(T.roots || []).length} folders · ${T.libCounts ? T.libCounts.songs : 0} songs`]] : []), ['look', 'theme · accent · device'], ['radio', ts.radioUi === 'classic' ? 'original zune' : 'zune hd'], ['lock screen', ts.lock ? `on · ${WALLS[ts.wall] ? WALLS[ts.wall].name : ''}` : 'off'], ['visualizer', ((window.Visualizers || []).find((v) => v.id === ts.viz) || {}).name || ''], [POCKET ? 'window' : 'mini player', w.onTop ? 'stays on top' : 'on the desktop']]
            .map(([k, sub]) => `<div class="tl-big" data-t="setsec" data-v="${k}">${k}<div class="hs-sub">${esc(String(sub).toUpperCase())}</div></div>`).join('')}
        </div>`;
    }
    let body = '';
    if (sec === 'look') {
      const th = (settings.themes || {}).zune || 'dark';
      const colors = ['pink', 'magenta', 'orange', 'red', 'green', 'blue', 'brown', 'black', 'white'];
      const dev = Object.keys(SHELLS);
      body = `<div class="ts-h">THEME</div>${opt('dark', th === 'dark', 'data-t="theme" data-v="dark"')}${opt('light', th === 'light', 'data-t="theme" data-v="light"')}
        <div class="ts-h">ACCENT</div><div class="ts-sw">${colors.map((c) => `<button class="ts-dot ${settings.zuneColor === c ? 'on' : ''}" data-t="accent" data-v="${c}" style="background:linear-gradient(135deg,${(ZUNE_COLORS[c] || [])[0]},${(ZUNE_COLORS[c] || [])[1]})"></button>`).join('')}</div>
        <div class="ts-h">SHELL</div><div class="tsh-g">${dev.map((c) => `<div class="tsh-it ${(w.deviceColors || {}).touch === c ? 'on' : ''}" data-t="devcolor" data-v="${c}"><div class="tsh-pv shell-${c}"><i></i></div><span>${SHELLS[c]}</span></div>`).join('')}</div>
        <div class="ts-h">GLASS REFLECTION</div>${opt('off', !TS().glare, 'data-t="glare" data-v="0"')}${opt('on', !!TS().glare, 'data-t="glare" data-v="1"')}
        <div class="ts-h">SIZE</div>${[['small', 0.85], ['normal', 1], ['large', 1.2]].map(([l, v]) => opt(l, (w.deviceScale || 1) === v, `data-t="scale" data-v="${v}"`)).join('')}`;
    } else if (sec === 'lock screen') {
      body = `<div class="ts-h">LOCK SCREEN</div>${opt('on', ts.lock, 'data-t="lock" data-v="1"')}${opt('off', !ts.lock, 'data-t="lock" data-v="0"')}
        ${ts.lock ? `<div class="ts-h">LOCK AFTER</div>${[[60, '1 minute'], [120, '2 minutes'], [300, '5 minutes'], [900, '15 minutes'], [0, 'only when I hold the button']].map(([v, l]) => opt(l, ts.lockAfter === v, `data-t="lockafter" data-v="${v}"`)).join('')}` : ''}
        <div class="ts-h">WALLPAPER</div>
        <div class="tw-g">${Object.entries(WALLS).filter(([k]) => k !== 'custom' || ts.wallFile).map(([k, v]) => `<div class="tw-it ${ts.wall === k ? 'on' : ''}" data-t="wall" data-v="${k}"><div class="tw-pv" style='background:${wallCss(k)}'></div><span>${v.name}</span></div>`).join('')}</div>
        ${opt('choose a picture…', false, 'data-t="wallpick"')}
        <div class="ts-h">CLOCK</div>${opt('12-hour', !ts.clock24, 'data-t="clock24" data-v="0"')}${opt('24-hour', ts.clock24, 'data-t="clock24" data-v="1"')}
        ${opt('lock now', false, 'data-t="locknow"')}`;
    } else if (sec === 'music folders') {
      const roots = T.roots || [];
      body = `<div class="ts-h">FOLDERS ${esc(NAME.toUpperCase())} WATCHES</div>${roots.map((r, i) => `<div class="tl-row" data-t="rmroot" data-v="${i}"><div class="tl-tx"><div class="tl-t ell">${esc(r.path.split(/[\\/]/).filter(Boolean).pop() || r.path)}</div><div class="tl-s ell">${esc(r.path.toUpperCase())}${r.online ? '' : ' · NOT CONNECTED'}</div></div><span class="tq">${icon('close')}</span></div>`).join('') || '<div class="tl-empty">no folders yet</div>'}
        ${opt('add a folder…', false, 'data-t="addroot"')}${opt('rescan', false, 'data-t="rescan"')}
        <div class="ts-h">ALBUM ART</div>${opt('find hd art online', settings.onlineArt !== false, 'data-t="onlineart" data-v="1"')}${opt('only use my files', settings.onlineArt === false, 'data-t="onlineart" data-v="0"')}
        <div class="ts-h">LIBRARY</div><div class="tl-empty" style="padding-top:4px;font-size:14px">${T.libCounts ? `${T.libCounts.songs} songs · ${T.libCounts.albums} albums` : ''}</div>`;
    } else if (sec === 'letters') {
      const styles = [['outline', 'white outline'], ['solid', 'white tiles'], ['accent', 'accent tiles'], ['accentline', 'accent outline'], ['gray', 'gray tiles']];
      body = `<div class="ts-h">LETTER TILES IN YOUR LISTS</div>
        <div class="tjs-g">${styles.map(([k, l]) => `<div class="tjs-it ${ts.jumpStyle === k ? 'on' : ''}" data-t="jumpstyle" data-v="${k}"><div class="tjs-pv" data-jump="${k}"><span class="tj-h">${ts.jumpCase === 'upper' ? 'A' : 'a'}</span><span class="tj-h">${ts.jumpCase === 'upper' ? 'B' : 'b'}</span></div><span>${l}</span></div>`).join('')}</div>
        <div class="ts-h">LETTERS</div>${opt('lowercase', ts.jumpCase !== 'upper', 'data-t="jumpcase" data-v="lower"')}${opt('uppercase', ts.jumpCase === 'upper', 'data-t="jumpcase" data-v="upper"')}`;
    } else if (sec === 'radio') {
      body = `<div class="ts-h">RADIO LOOKS LIKE</div>${opt('zune hd', ts.radioUi !== 'classic', 'data-t="radioui" data-v="hd"')}${opt('original zune', ts.radioUi === 'classic', 'data-t="radioui" data-v="classic"')}
        <div class="ts-h">FAVOURITES</div>${opt(`${favs().length} stations`, false, 'data-t="rbrowse"')}${favs().length ? opt('clear favourites', false, 'data-t="rclear"') : ''}`;
    } else if (sec === 'visualizer') {
      const groups = {};
      for (const v of window.Visualizers || []) (groups[v.group || 'More'] ||= []).push(v);
      body = Object.entries(groups).map(([g, list]) => `<div class="ts-h">${esc(g.toUpperCase())}</div>${list.map((v) => opt(v.name.toLowerCase(), ts.viz === v.id, `data-t="vizset" data-v="${v.id}"`)).join('')}`).join('') +
        `<div class="ts-h">MORE</div>${opt('play it here', false, 'data-t="menu" data-k="visualizer"')}${POCKET ? '' : opt('open full screen on your pc', false, 'data-t="vizbig"')}`;
    } else {
      body = `<div class="ts-h">STAYS</div>${opt('on top of windows', w.onTop, 'data-t="ontop" data-v="1"')}${opt('on the desktop', !w.onTop, 'data-t="ontop" data-v="0"')}
        ${POCKET ? `<div class="ts-h">SIZE</div>${[['small', 0.85], ['normal', 1], ['large', 1.2]].map(([l, v]) => opt(l, (w.deviceScale || 1) === v, `data-t="scale" data-v="${v}"`)).join('')}
        <div class="ts-h">MORE</div>${opt('lock position', !!w.locked, 'data-t="lockpos"')}${opt('minimize', false, 'data-t="minimize"')}${opt('quit', false, 'data-t="quit"')}`
        : `<div class="ts-h">MORE</div>${opt('open the full app', false, 'data-t="openmain"')}${opt('switch mini player…', false, 'data-t="menu2"')}${opt('close mini player', false, 'data-t="closew"')}`}`;
    }
    return `${backBtn()}${status()}<div class="tp-head"><span class="tp-cur">${esc(sec)}</span></div><div class="tscroll tlist">${body}</div>`;
  }

  // ---------------- the lock screen: swipe up to unlock
  function lockHtml() {
    const ts = TS();
    const t = state && state.track;
    const playing = !!(state && state.playing && t);
    const big = t ? (t.album || t.artist) : '';
    return `
      <div class="lk-bg" style='background:${playing ? '#000' : wallCss(ts.wall)}'></div>
      ${playing ? `
        <div class="lk-art">${t.artLarge || t.art ? `<img src="${esc(t.artLarge || t.art)}" alt="">` : ''}</div>
        <div class="lk-huge"><span>${esc(big.toUpperCase())}&nbsp;&nbsp;</span><span>${esc(big.toUpperCase())}&nbsp;&nbsp;</span></div>
        <div class="lk-np"><div class="ell">${esc(t.title)}</div><small class="ell">${esc(t.artist.toUpperCase())}</small></div>` : ''}
      <div class="lk-ctrl"><button class="tcirc" data-cmd="prev">${icon('prev')}</button><button class="tcirc big" data-cmd="toggle">${icon(playing ? 'pause' : 'play')}</button><button class="tcirc" data-cmd="next">${icon('next')}</button></div>
      <div class="lk-clock ${playing ? 'small' : ''}"><div class="lk-bar"><i></i></div><div class="lk-time">${timeStr()}</div><div class="lk-date">${dateStr()}</div></div>
      <div class="lk-hint">swipe up to unlock</div>`;
  }
  function paintLock() {
    const el = root.querySelector('.tlock');
    if (!el) return;
    el.hidden = !T.locked;
    if (T.locked) el.innerHTML = lockHtml();
  }
  function lockNow() {
    if (!TS().lock) return;
    T.locked = true;
    stopViz();
    paintLock();
  }
  function unlock() {
    T.locked = false;
    T.lastActive = Date.now();
    const el = root.querySelector('.tlock');
    if (el) { el.style.transform = ''; el.hidden = true; }
    if (tcur().s === 'viz') renderTouch(true);
  }
  function startUnlock(e, el) {
    const sy = e.clientY, h = el.getBoundingClientRect().height;
    let dy = 0, dragged = false;
    el.setPointerCapture(e.pointerId);
    el.style.transition = 'none';
    const move = (ev) => { dy = Math.min(0, ev.clientY - sy); if (dy < -6) dragged = true; el.style.transform = `translateY(${dy}px)`; };
    const up = (ev) => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up);
      el.style.transition = '';
      if (-dy > h * 0.3) { el.style.transform = `translateY(-${h}px)`; setTimeout(unlock, 220); }
      else {
        el.style.transform = '';
        if (!dragged) {
          const b = document.elementFromPoint(ev.clientX, ev.clientY);
          const c = b && b.closest('[data-cmd]');
          if (c) send(c.dataset.cmd);
          else { el.classList.add('peek'); clearTimeout(T.peekT); T.peekT = setTimeout(() => el.classList.remove('peek'), 3500); }
        }
      }
      moved = true; setTimeout(() => { moved = false; }, 0);
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  }
  // lock after a while with nothing touched
  setInterval(() => {
    if (!settings || settings.widget.mode !== 'touch' || T.locked) {
      if (T.locked) { const tm = root.querySelector('.lk-time'); if (tm) tm.textContent = timeStr(); }
      return;
    }
    const after = TS().lockAfter;
    if (TS().lock && after > 0 && Date.now() - (T.lastActive || Date.now()) > after * 1000) lockNow();
  }, 5000);
  document.addEventListener('pointerdown', () => { T.lastActive = Date.now(); }, true);
  document.addEventListener('wheel', () => { T.lastActive = Date.now(); }, true);
  // hold the button under the screen to lock
  let hwTimer = null, hwLong = false;
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.touch .hw')) return;
    hwLong = false;
    hwTimer = setTimeout(() => { hwLong = true; if (TS().lock) lockNow(); }, 600);
  });
  document.addEventListener('pointerup', () => clearTimeout(hwTimer));

  // ---------------- radio: a tuner like the device's FM app, for internet stations
  const R = { list: null, src: 'favorites', loading: false, genres: null, dialX: 0 };
  const favs = () => ((settings.radio && settings.radio.favs) || []);
  const isFav = (st) => !!st && favs().some((f) => f.id === st.id);
  function toggleFav(st) {
    if (!st) return;
    const list = isFav(st) ? favs().filter((f) => f.id !== st.id) : [st, ...favs()].slice(0, 60);
    api.settings.set({ radio: { favs: list } });
  }
  async function radioLoad(src, extra) {
    R.src = src; R.loading = true; R.error = '';
    try {
      if (src === 'favorites') R.list = favs();
      else if (src === 'popular') R.list = await api.radio.search({ order: 'clickcount', limit: 80 });
      else if (src === 'top voted') R.list = await api.radio.search({ order: 'votes', limit: 80 });
      else if (src === 'genre') R.list = await api.radio.search({ tag: extra, order: 'clickcount', limit: 80 });
      else if (src === 'search') R.list = extra ? await api.radio.search({ q: extra, order: 'clickcount', limit: 80 }) : [];
      if (R.list && R.list.error) { R.error = 'the radio directory isn’t answering. check your connection'; R.list = []; }
    } catch { R.error = 'the radio directory isn’t answering'; R.list = []; }
    R.loading = false;
  }
  // the stations the tuner dials through: what's playing, else favourites, else popular
  function tunerStations() {
    if (state && state.radioQueue && state.radioQueue.length) return state.radioQueue;
    if (favs().length) return favs();
    return R.popular || [];
  }
  // radio, drawn like the device: Zune HD (default) or the original Zune
  function stationParts(st) {
    if (!st) return { big: '', call: '', genre: '', fq: null };
    const fqm = /\b(\d{2,3}[.,]\d)\b/.exec(st.name);
    const rest = st.name.replace(fqm ? fqm[0] : '', '').replace(/\b(fm|am)\b/ig, '').replace(/\s*[-–|(:]\s*$/, '').replace(/\s+/g, ' ').trim();
    const call = (rest.split(/\s[-–|:]\s|\s\(/)[0] || st.name).trim();
    return { big: fqm ? fqm[1].replace(',', '.') : '', call, genre: (st.tags || [])[0] || '', fq: fqm ? parseFloat(fqm[1].replace(',', '.')) : null };
  }
  function screenRadio() {
    const t = state && state.track;
    const live = t && t.radio ? t.station : null;
    const list = tunerStations();
    const idx = live ? Math.max(0, list.findIndex((s) => s.id === live.id)) : 0;
    const st = live || list[idx] || null;
    const p = stationParts(st);
    const playing = !!(live && state.playing);
    const np = live && t.nowTitle ? t.nowTitle : '';
    const song = np ? (np.split(' - ').slice(1).join(' - ') || np) : '';
    const artist = np && np.includes(' - ') ? np.split(' - ')[0] : '';
    // stations without a frequency get a preset number, the way a dial would
    const big = p.big || String(idx + 1).padStart(2, '0');
    const hq = st && st.bitrate >= 192;
    const near = [-1, 0, 1].map((d) => list[(idx + d + list.length) % list.length]).filter(Boolean);
    if (TS().radioUi === 'classic') {
      const nums = [-2, -1, 0, 1, 2, 3].map((d) => idx + d).filter((i) => i >= 0 && i < Math.max(list.length, 1) + 3);
      const label = (i) => { const s = list[i]; if (!s) return ''; const sp = stationParts(s); return sp.fq ? Math.floor(sp.fq) : i + 1; };
      return `${status()}
        <div class="rc ${playing ? '' : 'off'}">
          <div class="rc-call ell">${esc((p.call || 'radio').toUpperCase())}</div>
          <div class="rc-big" data-t="rplay">${esc(big)}</div>
          <div class="rc-genre ell">${esc(p.genre ? p.genre[0].toUpperCase() + p.genre.slice(1) : '')}</div>
          <div class="rc-dial" data-t="rdialswipe"><div class="rc-line"></div><div class="rc-mark"></div>
            <div class="rc-nums">${[-2, -1, 0, 1, 2].map((d) => { const i = idx + d; return `<span class="${d === 0 ? 'on' : ''}" ${list[i] ? `data-t="tune" data-v="${i}"` : ''}>${list[i] ? label(i) : ''}</span>`; }).join('')}</div></div>
          <div class="rc-rds ell">${esc(st ? (p.call || st.name).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) : 'NO STATIONS')}</div>
          <div class="rc-text">${esc(np || (st ? (playing ? 'on the air' : 'tap the frequency to tune in') : 'open stations to find some'))}${st && st.homepage ? ` -<br>${esc(st.homepage.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '').toUpperCase())}` : ''}</div>
          <div class="rc-foot"><a data-t="rbrowse">${icon('queue')}</a><a data-t="rfav" class="${isFav(st) ? 'on' : ''}">${icon(isFav(st) ? 'heart' : 'heartOutline')}</a></div>
        </div>`;
    }
    return `${backBtn()}${status()}
      <div class="rh ${playing ? '' : 'off'}">
        <div class="rh-st">
          <button class="rh-add ${isFav(st) ? 'on' : ''}" data-t="rfav" title="${isFav(st) ? 'Remove from favourites' : 'Add to favourites'}"><span>+</span>${icon('queue')}</button>
          <div class="rh-call"><div class="ell">${esc((p.call || 'radio').toUpperCase())}</div>${p.genre ? `<small class="ell">${esc(p.genre.toUpperCase())}</small>` : ''}</div>
        </div>
        <div class="rh-big" data-t="rplay" title="Play / stop"><span>${esc(big)}</span>${hq ? `<small><i>${Math.min(9, Math.round(st.bitrate / 100))}</i>HD</small>` : ''}</div>
        <div class="rh-dial" data-t="rdialswipe"><div class="rh-line"></div><div class="rh-dot"></div></div>
        <div class="rh-subs">${near.map((s) => { const i = list.indexOf(s); const sp = stationParts(s); return `<span class="${s === st ? 'on' : ''}" data-t="tune" data-v="${i}">${esc((sp.big || sp.call || s.name).toUpperCase().slice(0, 7))}</span>`; }).join('')}</div>
        <div class="rh-np">${song ? `<div class="ell">${esc(song)}</div>` : `<div class="ell">${st ? (playing ? 'on the air' : 'tap the frequency to tune in') : 'no stations yet'}</div>`}
          <small class="ell">${esc(artist.toUpperCase())}</small>
          <small class="ell">${esc(st ? [st.name, st.country].filter(Boolean).join(' · ').toUpperCase() : 'OPEN THE LIST TO FIND STATIONS')}</small></div>
        <button class="tcirc rh-list" data-t="rbrowse" title="Stations">${icon('queue')}</button>
        <button class="tcirc rh-fav ${isFav(st) ? 'on' : ''}" data-t="rfav" title="Favourite">${icon(isFav(st) ? 'heart' : 'heartOutline')}</button>
      </div>`;
  }
  const RSRC = ['favorites', 'popular', 'genres'];
  function screenRadioList(sc) {
    const src = sc.src || 'favorites';
    let body;
    if (src === 'genres') {
      body = R.genres ? R.genres.map((g) => `<div class="tl-big" data-t="rgenre" data-v="${esc(g.name)}">${esc(g.name)}<small>${g.count}</small></div>`).join('') : '<div class="tl-empty">loading…</div>';
    } else if (R.loading) body = '<div class="tl-empty">tuning in…</div>';
    else if (R.error) body = `<div class="tl-empty">${esc(R.error)}</div>`;
    else {
      const list = R.list || [];
      body = list.map((s, i) => `<div class="tl-row" data-t="rpick" data-v="${i}"><div class="tt-th rd-ico">${s.favicon ? `<img src="${esc(s.favicon)}" alt="" onerror="this.remove()">` : ''}</div><div class="tl-tx"><div class="tl-t ell">${esc(s.name)}</div><div class="tl-s ell">${esc([s.bitrate ? s.bitrate + 'K' : '', s.country, ...(s.tags || []).slice(0, 2)].filter(Boolean).join(' · ').toUpperCase())}</div></div>${isFav(s) ? `<span class="rd-fv">${icon('heart')}</span>` : ''}</div>`).join('') ||
        `<div class="tl-empty">${src === 'favorites' ? 'no favourites yet. find stations in popular, genres or search' : src === 'search' ? 'type a station name' : 'nothing found'}</div>`;
    }
    return `${backBtn()}${status()}
      <div class="tp-head"><span class="tp-cur">${esc(sc.title || src)}</span></div>
      <div class="tp-tabs">${RSRC.map((p) => `<a data-t="rsrc" data-v="${p}" class="${p === src ? 'on' : ''}">${p.toUpperCase()}</a>`).join('')}</div>
      <div class="tscroll tlist ${src === 'search' ? '' : 'rd-top'}">${body}</div>`;
  }
  // drag the dial to tune
  function startDial(e, dial) {
    const trk = dial.querySelector('.rd-track');
    const list = tunerStations();
    const m = /translateX\((-?[\d.]+)px\)/.exec(trk.style.transform);
    const x0 = m ? +m[1] : 0, sx = e.clientX;
    let x = x0, movedDial = false;
    trk.style.transition = 'none';
    const move = (ev) => { x = Math.max(-(list.length - 1) * 64, Math.min(0, x0 + ev.clientX - sx)); if (Math.abs(ev.clientX - sx) > 4) movedDial = true; trk.style.transform = `translateX(${x}px)`; };
    const up = (ev) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      trk.style.transition = '';
      if (!movedDial) { const el = document.elementFromPoint(ev.clientX, ev.clientY); const tk = el && el.closest('[data-t="tune"]'); if (tk) touchAction(tk); return; }
      const i = Math.round(-x / 64);
      trk.style.transform = `translateX(${-i * 64}px)`;
      moved = true; setTimeout(() => { moved = false; }, 0);
      if (list[i]) send('playRadio', { stations: list, index: i });
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
  async function radioAction(a, v, el) {
    const list = tunerStations();
    const t = state && state.track;
    const live = t && t.radio ? t.station : null;
    const idx = live ? Math.max(0, list.findIndex((s) => s.id === live.id)) : 0;
    switch (a) {
      case 'tune': return send('playRadio', { stations: list, index: +v });
      case 'rplay': if (live) return send('toggle'); if (list.length) return send('playRadio', { stations: list, index: 0 }); return tgo({ s: 'radiolist', src: 'popular' }), radioLoad('popular').then(() => renderTouch(false));
      case 'rprev': if (list.length) send('playRadio', { stations: list, index: (idx - 1 + list.length) % list.length }); return;
      case 'rnext': if (list.length) send('playRadio', { stations: list, index: (idx + 1) % list.length }); return;
      case 'rfav': toggleFav(live || list[0]); return;
      case 'rbrowse': tgo({ s: 'radiolist', src: favs().length ? 'favorites' : 'popular' }); await radioLoad(favs().length ? 'favorites' : 'popular'); return renderTouch(false);
      case 'rsrc': {
        const sc = tcur(); sc.src = v; sc.title = v === 'genres' ? 'genres' : v; renderTouch(true);
        if (v === 'genres') { if (!R.genres) { R.genres = await api.radio.genres(); renderTouch(false); } }
        else { await radioLoad(v, sc.q); renderTouch(false); }
        return;
      }
      case 'rgenre': { const sc = tcur(); sc.src = 'genre'; sc.title = v; renderTouch(true); await radioLoad('genre', v); return renderTouch(false); }
      case 'rpick': { send('playRadio', { stations: R.list, index: +v }); return tgo({ s: 'radio' }); }
    }
  }
  document.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !e.target.classList.contains('rd-q')) return;
    const sc = tcur(); sc.q = e.target.value; await radioLoad('search', sc.q); renderTouch(false);
  });

  async function renderTouch(force) {
    const scr = root.querySelector('.touch .tapp');
    if (!scr) return;
    if (!T.booted) { T.booted = true; if (TS().lock) T.locked = true; }
    paintLock();
    const sc = tcur();
    const needsLib = !['np', 'queue', 'settings', 'viz', 'radio', 'radiolist'].includes(sc.s);
    if (needsLib && !T.lib) { scr.innerHTML = `${status()}<div class="tl-empty">loading your collection…</div>`; await loadLib(true); }
    else if (force && sc.s === 'home') loadLib(false).then(() => { if (tcur().s === 'home') paint(); });
    paint();
    function paint() {
      const prevScroll = force ? 0 : (scr.querySelector('.tscroll') || {}).scrollTop || 0;
      const focused = document.activeElement && document.activeElement.classList.contains('ts-search');
      const fn = { home: screenHome2, music: screenMusic, artist: screenArtist, album: screenAlbum, genre: screenGenre, playlists: screenPlaylists, playlist: screenPlaylist, quickplay: screenQuickplay, np: screenNowPlaying, queue: screenQueue, settings: screenSettings2, viz: screenViz, radio: screenRadio, radiolist: screenRadioList, plname: screenPlName, pladd: screenPlAdd }[sc.s] || screenHome2;
      scr.innerHTML = fn(sc);
      scr.dataset.s = sc.s;
      scr.dataset.jump = TS().jumpStyle || 'outline';
      scr.dataset.case = TS().jumpCase || 'lower';
      const ts = scr.querySelector('.tscroll');
      if (ts) ts.scrollTop = prevScroll;
      if (focused) { const i = scr.querySelector('.ts-search'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
      if (sc.s === 'plname') { const inp = scr.querySelector('.tn-name'); if (inp) setTimeout(() => { inp.focus(); inp.select(); }, 30); }
      if (sc.s === 'viz' && !T.locked) startViz(); else stopViz();
      tick(true);
    }
  }
  // the bits of state that should redraw what's on the screen
  function touchStateChanged() {
    const sc = tcur().s;
    const t = state && state.track;
    const key = JSON.stringify([sc, t && t.id, t && t.nowTitle, state && state.playing, state && state.shuffle, state && state.repeat, state && state.loved, state && state.muted, sc === 'np' ? Math.round((state && state.volume || 0) * 50) : 0,
      (sc === 'np' || sc === 'queue') && state && state.upNext && state.upNext.map((q) => q.i).join(), sc === 'queue' && state && state.queueLength]);
    if (key === T.npKey) return;
    T.npKey = key;
    if (T.locked) paintLock();
    if (['np', 'queue', 'home', 'radio'].includes(sc)) renderTouch(false);
  }

  async function touchAction(el) {
    const a = el.dataset.t, v = el.dataset.v;
    const L = T.lib;
    const ids = (list) => list.map((t) => t.id);
    if (a === 'rdialswipe') return;
    if (['tune', 'rplay', 'rprev', 'rnext', 'rfav', 'rbrowse', 'rsrc', 'rgenre', 'rpick'].includes(a)) return radioAction(a, v, el);
    switch (a) {
      case 'back': return tback();
      case 'menu': {
        const k = el.dataset.k;
        if (k === 'music') return tgo({ s: 'music', pivot: 'artists' });
        if (k === 'playlists') return tgo({ s: 'playlists' });
        if (k === 'quickplay') return tgo({ s: 'quickplay' });
        if (k === 'now playing') return tgo({ s: 'np' });
        if (k === 'shuffle all') { send('shuffleAll'); return tgo({ s: 'np' }); }
        if (k === 'visualizer') return tgo({ s: 'viz' });
        if (k === 'radio') { tgo({ s: 'radio' }); if (!favs().length && !R.popular) { R.popular = await api.radio.search({ order: 'clickcount', limit: 60 }).catch(() => []); if (R.popular && R.popular.error) R.popular = []; renderTouch(false); } return; }
        if (k === 'settings') return tgo({ s: 'settings' });
        if (k === 'now playing') return tgo({ s: 'np' });
        return;
      }
      case 'pivot': { const sc = tcur(); sc.pivot = v; sc.more = 0; return renderTouch(true); }
      case 'more': { const sc = tcur(); sc.more = (sc.more || 300) + 300; return renderTouch(false); }
      case 'artist': return tgo({ s: 'artist', v });
      case 'album': return tgo({ s: 'album', v });
      case 'genre': return tgo({ s: 'genre', v });
      case 'song': send('playTracks', { ids: ids(T.songs), index: +v, title: 'Songs' }); return tgo({ s: 'np' });
      case 'playartist': case 'shuffleartist': { const ar = L.artists.get(nrm(tcur().v)); send('playTracks', { ids: ids(ar.albums.flatMap(aTracks)), index: 0, title: ar.name, shuffle: a === 'shuffleartist' }); return tgo({ s: 'np' }); }
      case 'playalbum': case 'shufflealbum': send('playAlbum', { id: tcur().v, shuffle: a === 'shufflealbum' }); return tgo({ s: 'np' });
      case 'albumsong': send('playAlbum', { id: tcur().v, index: +v }); return tgo({ s: 'np' });
      case 'queuealbum': send('queueTracks', { ids: tcur().v ? L.albums.get(tcur().v).trackIds : [] }); return flash(el);
      case 'queuesong': { const t = aTracks(L.albums.get(tcur().v))[+v]; if (t) send('queueTracks', { ids: [t.id] }); return flash(el); }
      case 'pin': send('pin', tcur().v); setTimeout(async () => { await loadLib(true); renderTouch(false); }, 400); return;
      case 'shufflegenre': send('playTracks', { ids: ids((L.genres.get(tcur().v) || []).flatMap(aTracks)), index: 0, title: tcur().v, shuffle: true }); return tgo({ s: 'np' });
      case 'loved': return tgo({ s: 'playlist', loved: true });
      case 'playlist': return tgo({ s: 'playlist', v });
      case 'plplay': case 'plshuffle': case 'plsong': send('playTracks', { ids: T.plTracks.map((t) => t.id), index: a === 'plsong' ? +v : 0, title: 'Playlist', shuffle: a === 'plshuffle' }); return tgo({ s: 'np' });
      case 'queue': return tgo({ s: 'queue' });
      case 'unqueue': send('removeQueue', +v); return;
      case 'savequeuenamed': return;
      case 'savequeue': { const d = new Date(); send('savequeue', `queue ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${timeStr(d)}`.toLowerCase()); flash(el); setTimeout(() => loadLib(true), 1200); return; }
      case 'ctrl': T.overlay = !T.overlay; { const o = root.querySelector('.tn-ov'); if (o) o.classList.toggle('on', T.overlay); } return;
      case 'side': T.homePanel = T.homePanel === 'side' ? 'menu' : 'side'; { const h = root.querySelector('.hs'); if (h) h.classList.toggle('hs-open', T.homePanel === 'side'); } return;
      case 'setsec': if (v === 'music folders') await loadLib(true); return tgo({ s: 'settings', sec: v });
      case 'lock': return setTS({ lock: v === '1' });
      case 'lockafter': return setTS({ lockAfter: +v });
      case 'wall': return setTS({ wall: v });
      case 'wallpick': { const f = await api.widget.pickWallpaper(); if (f) setTS({ wall: 'custom', wallFile: f }); return; }
      case 'clock24': return setTS({ clock24: v === '1' });
      case 'locknow': return lockNow();
      case 'vizset': return setTS({ viz: v });
      case 'vizpick': { const list = window.Visualizers || []; const i = list.findIndex((x) => x.id === TS().viz); await setTS({ viz: list[(i + 1) % list.length].id }); return; }
      case 'vizbig': return send('musicmode');
      case 'radioui': return setTS({ radioUi: v });
      case 'jumpstyle': return setTS({ jumpStyle: v });
      case 'glare': return setTS({ glare: v === '1' });
      case 'jumpcase': return setTS({ jumpCase: v });
      case 'jumpgrid': { tcur().jump = true; return renderTouch(false); }
      case 'jumpclose': { tcur().jump = false; return renderTouch(false); }
      case 'jumpto': {
        const sc = tcur(); sc.jump = false; renderTouch(false);
        const list = root.querySelector('.tmusic'), h = root.querySelector(`#tj-${v === '#' ? 'num' : v}`);
        if (list && h) list.scrollTop = h.offsetTop - 2;
        return;
      }
      case 'plnew': return tgo({ s: 'plname', mode: 'new' });
      case 'plnewwith': return tgo({ s: 'plname', mode: 'new', ids: tcur().ids });
      case 'albumtopl': { const a = L.albums.get(tcur().v); return tgo({ s: 'pladd', ids: a ? a.trackIds : [] }); }
      case 'pladdto': { send('playlistAdd', { id: v, ids: tcur().ids || [] }); flash(el); setTimeout(async () => { await loadLib(true); tback(); }, 900); return; }
      case 'plrename': { const pl = ((T.user && T.user.playlists) || []).find((p) => p.id === tcur().v); return tgo({ s: 'plname', mode: 'rename', id: tcur().v, value: pl ? pl.name : '' }); }
      case 'pldelete': {
        const sc = tcur();
        if (!sc.sure) { sc.sure = true; renderTouch(false); setTimeout(() => { if (tcur() === sc && sc.sure) { sc.sure = false; renderTouch(false); } }, 3000); return; }
        send('playlistDelete', sc.v); setTimeout(async () => { await loadLib(true); tback(); }, 900); return;
      }
      case 'plremove': { send('playlistRemove', { id: tcur().v, index: +v }); setTimeout(async () => { await loadLib(true); renderTouch(false); }, 900); return; }
      case 'plsave': return savePlName();
      case 'addroot': if (await api.lib.addFolder()) setTimeout(async () => { await loadLib(true); renderTouch(false); }, 1500); return;
      case 'rescan': api.lib.rescan(); flash(el); setTimeout(async () => { await loadLib(true); renderTouch(false); }, 3000); return;
      case 'rmroot': {
        const r = (T.roots || [])[+v];
        if (!r) return;
        if (el.dataset.sure !== '1') { el.dataset.sure = '1'; const t = el.querySelector('.tl-s'); if (t) t.textContent = 'TAP AGAIN TO REMOVE · YOUR FILES STAY PUT'; return; }
        await api.lib.removeFolder(r.path); await loadLib(true); return renderTouch(false);
      }
      case 'onlineart': return api.settings.set({ onlineArt: v === '1' });
      case 'lockpos': return api.settings.set({ widget: { locked: !settings.widget.locked } });
      case 'minimize': return api.widget.minimize();
      case 'quit': return api.widget.quit();
      case 'rclear': return api.settings.set({ radio: { favs: [] } });
      case 'theme': return api.settings.set({ themes: { zune: v } });
      case 'accent': return api.settings.set({ zuneColor: v });
      case 'devcolor': return api.settings.set({ widget: { deviceColors: { touch: v } } });
      case 'scale': return api.settings.set({ widget: { deviceScale: +v } });
      case 'ontop': return api.settings.set({ widget: { onTop: v === '1' } });
      case 'openmain': return api.win.showMain();
      case 'menu2': return api.widget.menu();
      case 'closew': return api.settings.set({ widget: { open: false } });
    }
  }
  if (api.mock) window.__touch = { tgo: (x) => tgo(x), thome: () => thome(), T, lockNow: () => lockNow(), unlock: () => unlock(), side: (on) => { T.homePanel = on ? 'side' : 'menu'; renderTouch(false); }, act: (el) => touchAction(el) };
  function savePlName() {
    const sc = tcur();
    const inp = root.querySelector('.tn-name');
    const name = (inp ? inp.value : '').trim();
    if (!name) { if (inp) inp.focus(); return; }
    if (sc.mode === 'rename') send('playlistRename', { id: sc.id, name });
    else send('playlistCreate', { name, ids: sc.ids || [] });
    setTimeout(async () => { await loadLib(true); T.stack.pop(); if (tcur().s === 'pladd') T.stack.pop(); if (sc.mode === 'rename' && tcur().s === 'playlist') tcur().sure = false; renderTouch(true); }, 900);
  }
  document.addEventListener('keydown', (e) => {
    if (!e.target.classList || !e.target.classList.contains('tn-name')) return;
    if (e.key === 'Enter') { e.preventDefault(); savePlName(); }
    if (e.key === 'Escape') tback();
  });
  function flash(el) { el.classList.add('done'); setTimeout(() => el.classList.remove('done'), 700); }

  // drag lists like a touch screen; swipe sideways on now playing to skip, or between music pivots
  function startTouch(e, scr) {
    const sx = e.clientX, sy = e.clientY;
    const list = e.target.closest('.tscroll');
    const top0 = list ? list.scrollTop : 0;
    let mode = null;
    const move = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!mode && Math.hypot(dx, dy) > 6) mode = Math.abs(dy) > Math.abs(dx) ? 'v' : 'h';
      if (mode === 'v' && list) { list.scrollTop = top0 - dy; moved = true; }
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const dx = ev.clientX - sx;
      if (mode === 'h' && Math.abs(dx) > 40) {
        moved = true;
        const s = tcur().s;
        if (s === 'np') send(dx < 0 ? 'next' : 'prev');
        else if (s === 'home') { T.homePanel = dx > 0 ? 'side' : 'menu'; const h = root.querySelector('.hs'); if (h) h.classList.toggle('hs-open', T.homePanel === 'side'); }
        else if (s === 'viz') touchAction({ dataset: { t: 'vizpick' } });
        else if (s === 'radio') radioAction(dx < 0 ? 'rnext' : 'rprev');
        else if (s === 'music') { const sc = tcur(); const i = PIVOTS.indexOf(sc.pivot || 'artists'); sc.pivot = PIVOTS[(i + (dx < 0 ? 1 : 3)) % 4]; renderTouch(true); }
        else if (dx > 0) tback();
      }
      if (mode) setTimeout(() => { moved = false; }, 0);
      else {
        // a plain tap: let the click handler see it
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const t = el && el.closest('[data-t],[data-cmd],[data-i]');
        if (t && t.tagName !== 'INPUT') {
          if (t.dataset.t !== undefined) touchAction(t);
          else if (t.dataset.cmd) send(t.dataset.cmd);
          else if (t.dataset.i !== undefined) send('playIndex', +t.dataset.i);
          moved = true; setTimeout(() => { moved = false; }, 0);
        }
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  document.addEventListener('input', (e) => {
    if (!e.target.classList.contains('ts-search')) return;
    const sc = tcur(); sc.q = e.target.value; sc.more = 0;
    clearTimeout(T.qt); T.qt = setTimeout(() => renderTouch(false), 180);
  });

  function render() {
    if (!settings) return;
    const w = settings.widget;
    const skin = SKINS.includes(settings.skin) ? settings.skin : SKINS[0];
    const th = (settings.themes || {})[skin];
    const de = document.documentElement;
    de.dataset.skin = skin;
    de.dataset.theme = skin === 'rdio' ? th || 'midnight' : `${skin}-${th}`;
    de.dataset.tone = settings.eveningTone || 'both';
    de.dataset.mode = w.mode;
    const zc = ZUNE_COLORS[settings.zuneColor] || ZUNE_COLORS.pink;
    de.style.setProperty('--zune-a', zc[0]); de.style.setProperty('--zune-b', zc[1]);
    de.style.setProperty('--k', w.deviceScale || 1);
    const t = state && state.track;
    const X = window.ExtraWidgets;
    const ratio = state && state.duration ? now() / state.duration : 0;
    // only rebuild DOM when something structural changes; progress is updated separately
    const key = JSON.stringify([X && X.has(w.mode) ? X.key(w.mode, state, ratio) : '', settings.skin, settings.themes, settings.zuneColor, w.deviceColors, w.deviceScale, settings.eveningTone, w.mode, state && state.volume, w.showQueue, w.squareSize, t && t.id, state && state.playing, state && state.shuffle, state && state.repeat, state && state.muted,
      state && state.upNext && state.upNext.map((q) => q.i + q.title), state && state.peaks && state.peaks.slice(0, 8).join()]);
    const touchKey = w.mode === 'touch' ? JSON.stringify([settings.skin, settings.themes, settings.zuneColor, w.deviceColors, w.deviceScale, w.mode, !!(w.touch && w.touch.glare)]) : null;
    const finalKey = touchKey || key;
    if (finalKey === structureKey) { if (touchKey) touchStateChanged(); return; }
    structureKey = finalKey;

    if (X && X.has(w.mode)) {
      // CD Player, Vinyl and Cassette: fixed-size players drawn by widgets-extra.js
      X.render(w.mode, root, state, ratio);
      tick(true);
      return;
    } else if (DEVICES[w.mode]) {
      root.innerHTML = DEVICES[w.mode](t, (w.deviceColors || {})[w.mode] || 'black');
      if (w.mode === 'touch') { T.npKey = ''; renderTouch(false); }
    } else if (w.mode === 'square') {
      const size = w.squareSize || 220;
      root.innerHTML = `
        <div class="square ${size < 180 ? 'small' : ''}" style="--size:${size}px">
          ${t && (t.artLarge || t.art) ? `<img src="${esc(size > 340 ? t.artLarge || t.art : t.art || t.artLarge)}" alt="">` : `<div class="blank">${icon('disc')}</div>`}
          <div class="ov">
            <div class="meta">${t ? `<div class="t ell">${esc(t.title)}</div><div class="s ell">${esc(t.artist)}</div>` : ''}</div>
            <div class="c">
              <button data-cmd="prev">${icon('prev')}</button>
              <button class="play" data-cmd="toggle">${icon(state && state.playing ? 'pause' : 'play')}</button>
              <button data-cmd="next">${icon('next')}</button>
            </div>
            <div class="line"><i></i></div>
          </div>
        </div>`;
    } else if (w.mode === 'card') {
      // the classic 2011-style sidebar player, floating on the desktop
      const vol = state ? (state.muted ? 0 : state.volume) : 0.8;
      root.innerHTML = `
        <div class="cardw">
          <div class="cw-top">
            <button data-act="close" title="Close mini player">${icon('close')}</button>
            <span class="cw-brand">now playing</span>
            <button data-act="main" title="Open ${NAME}">${icon('widget')}</button>
          </div>
          <div class="cw-art" data-act="nowplaying">${t && (t.artLarge || t.art) ? `<img src="${esc(t.artLarge || t.art)}" alt="">` : `<div class="blank">${icon('disc')}</div>`}</div>
          <div class="cw-ctrls">
            <button class="cw-btn" data-cmd="prev" title="Previous">${icon('prev')}</button>
            <button class="cw-btn big" data-cmd="toggle" title="Play/Pause">${icon(state && state.playing ? 'pause' : 'play')}</button>
            <button class="cw-btn" data-cmd="next" title="Next">${icon('next')}</button>
            <button class="cw-btn sq ${w.showQueue ? 'on' : ''}" data-act="queue" title="Queue">${icon('queue')}</button>
          </div>
          <div class="cw-meta">
            ${t ? `<div class="cw-t ell">${esc(t.title)}</div><div class="cw-s ell">${esc(t.artist)}</div><div class="cw-s ell">${esc(t.album)}</div>`
                : `<div class="cw-t">Nothing playing</div><div class="cw-s">Open ${NAME} to pick something</div>`}
          </div>
          <div class="cw-prog">
            <div class="slider wave" data-seek>${waveSvgs()}<div class="knob"></div></div>
            <span class="tleft"></span>
          </div>
          <div class="cw-foot">
            <button data-cmd="mute" title="Mute">${icon(vol ? 'volume' : 'mute')}</button>
            <div class="slider vol" data-vol><div class="rail"><div class="fill" style="width:${vol * 100}%"></div></div><div class="knob" style="left:${vol * 100}%"></div></div>
            <button class="${state && state.shuffle ? 'on' : ''}" data-cmd="shuffle" title="Shuffle">${icon('shuffle')}</button>
            <button class="${state && state.repeat !== 'off' ? 'on' : ''}" data-cmd="repeat" title="Repeat">${icon(state && state.repeat === 'one' ? 'repeatOne' : 'repeat')}</button>
          </div>
        </div>
        ${w.showQueue ? queueHtml(true) : ''}`;
    } else {
      root.innerHTML = `
        <div class="bar">
          <div class="grip">
            <button data-act="close" title="Close mini player">${icon('close')}</button>
            <button data-act="main" title="Open ${NAME}">${icon('widget')}</button>
          </div>
          <div class="art" data-act="nowplaying" title="Open now playing">${t && t.art ? `<img src="${esc(t.art)}" alt="">` : ''}</div>
          <div class="info">
            <div class="title ell">${t ? esc(t.title) : 'Nothing playing'}</div>
            <div class="sub ell">${t ? `${esc(t.artist)} - ${esc(t.album)}` : `Open ${NAME} to pick something`}</div>
            <div class="prog">
              <div class="slider wave" data-seek>${waveSvgs()}<div class="knob"></div></div>
              <span class="time"></span>
            </div>
          </div>
          <div class="ctrls">
            <button data-cmd="prev" title="Previous">${icon('prev')}</button>
            <button class="play" data-cmd="toggle" title="Play/Pause">${icon(state && state.playing ? 'pause' : 'play')}</button>
            <button data-cmd="next" title="Next">${icon('next')}</button>
          </div>
          <div class="side">
            <button class="${w.showQueue ? 'on' : ''}" data-act="queue" title="Queue">${icon('queue')}</button>
            <button data-act="search" title="Search">${icon('search')}</button>
          </div>
        </div>
        ${w.showQueue ? queueHtml(false) : ''}`;
    }
    tick(true);
    requestAnimationFrame(() => api.widget.fit(root.getBoundingClientRect().height));
  }

  function tick(force) {
    if (!state || !settings) return;
    const d = state.duration || 0;
    const r = d ? Math.max(0, Math.min(1, now() / d)) : 0;
    const pct = (r * 100).toFixed(2) + '%';
    const sl = root.querySelector('[data-seek]');
    if (sl && !seeking) setPos(sl, r);
    const tl = root.querySelector('.tleft');
    if (tl) tl.textContent = state.track ? '-' + fmt(d - now()) : '0:00';
    const time = root.querySelector('.time');
    if (time) time.textContent = state.track ? fmt(now()) : '';
    const line = root.querySelector('.line i');
    if (line) line.style.width = pct;
    if (window.ExtraWidgets && window.ExtraWidgets.has(settings.widget.mode)) {
      window.ExtraWidgets.tick(settings.widget.mode, root, state, now());
      if (settings.widget.mode === 'cassette') render();   // the tape packs move with the song
    }
  }
  setInterval(() => { const c = root.querySelector('.clock'); if (c) c.textContent = clock(); }, 20000);
  (function loop() { if (state && state.playing) tick(); requestAnimationFrame(loop); })();

  // ---------------- interaction
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd],[data-act],[data-i]');
    if (!b || moved) return;
    if (b.dataset.cmd === 'volup' || b.dataset.cmd === 'voldown') {
      const v = Math.max(0, Math.min(1, (state ? (state.muted ? 0 : state.volume) : 0.8) + (b.dataset.cmd === 'volup' ? 0.05 : -0.05)));
      return send('volume', v);
    }
    if (b.dataset.cmd) return send(b.dataset.cmd);
    if (b.dataset.i !== undefined) return send('playIndex', +b.dataset.i);
    switch (b.dataset.act) {
      case 'close': api.settings.set({ widget: { open: false } }); break;
      case 'main': api.win.showMain(); break;
      case 'thome': if (!hwLong && !T.locked) thome(); hwLong = false; break;
      case 'nowplaying': api.win.showMain('nowplaying'); break;
      case 'search': api.win.showMain('search'); break;
      case 'queue': api.settings.set({ widget: { showQueue: !settings.widget.showQueue } }); break;
      case 'menu': api.widget.menu(); break;
    }
  });
  root.addEventListener('dblclick', (e) => {
    if (settings && settings.widget.mode === 'square' && !e.target.closest('button')) api.win.showMain('nowplaying');
  });
  document.addEventListener('contextmenu', (e) => { e.preventDefault(); api.widget.menu(); });
  root.addEventListener('wheel', (e) => {
    if (!settings || settings.widget.mode !== 'square' || !e.ctrlKey) return;
    const sizes = [140, 220, 300, 400];
    const i = sizes.indexOf(settings.widget.squareSize);
    const n = sizes[Math.max(0, Math.min(sizes.length - 1, (i < 0 ? 1 : i) + (e.deltaY < 0 ? 1 : -1)))];
    if (n !== settings.widget.squareSize) api.settings.set({ widget: { squareSize: n } });
  });

  // Drag the whole widget by hand (keeps hover + right-click working on Windows).
  let moved = false;
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const sl = e.target.closest('[data-seek]');
    if (sl) return startSeek(e, sl);
    const vs = e.target.closest('[data-vol]');
    if (vs) return startVolume(e, vs);
    const wh = e.target.closest('[data-wheel]');
    if (wh && !e.target.closest('.hub')) return startWheel(e, wh);
    const lk = e.target.closest('.touch .tlock');
    if (lk && !lk.hidden) return startUnlock(e, lk);
    const scr = e.target.closest('.touch .screen');
    if (scr) { if (!e.target.closest('input')) startTouch(e, scr); return; }
    if (e.target.closest('button,.qrow,select') || (settings && settings.widget.locked)) { moved = false; return; }
    moved = false;
    const offX = e.screenX - window.screenX;
    const offY = e.screenY - window.screenY;
    const sx = e.screenX, sy = e.screenY;
    document.body.setPointerCapture(e.pointerId);
    let raf = 0;
    const move = (ev) => {
      if (!moved && Math.hypot(ev.screenX - sx, ev.screenY - sy) < 4) return;
      moved = true;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => api.widget.moveTo(ev.screenX - offX, ev.screenY - offY));
    };
    const up = () => {
      document.body.removeEventListener('pointermove', move);
      document.body.removeEventListener('pointerup', up);
      if (moved) { api.widget.moveEnd(); setTimeout(() => { moved = false; }, 0); }
    };
    document.body.addEventListener('pointermove', move);
    document.body.addEventListener('pointerup', up);
  });

  // turning the wheel changes the volume, like the real thing; a tap on an edge still works as a button
  function startWheel(e, wh) {
    const r = wh.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const angle = (ev) => Math.atan2(ev.clientY - cy, ev.clientX - cx);
    let last = angle(e), turned = 0;
    let vol = state ? (state.muted ? 0 : state.volume) : 0.8;
    wh.setPointerCapture(e.pointerId);
    const panel = root.querySelector('.wvol');
    const move = (ev) => {
      const a = angle(ev);
      let d = a - last;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      last = a;
      turned += Math.abs(d);
      if (turned < 0.15) return;
      moved = true;
      vol = Math.max(0, Math.min(1, vol + d / (Math.PI * 2) * 0.6));
      if (panel) { panel.hidden = false; panel.querySelector('i').style.width = vol * 100 + '%'; }
      wh.style.setProperty('--spin', (parseFloat(getComputedStyle(wh).getPropertyValue('--spin')) || 0) + d * 57.3 + 'deg');
      send('volume', vol);
    };
    const up = () => {
      wh.removeEventListener('pointermove', move); wh.removeEventListener('pointerup', up);
      setTimeout(() => { moved = false; if (panel) panel.hidden = true; }, turned >= 0.15 ? 900 : 0);
    };
    wh.addEventListener('pointermove', move); wh.addEventListener('pointerup', up);
  }
  function startVolume(e, vs) {
    vs.setPointerCapture(e.pointerId);
    const apply = (ev) => {
      const r = vs.getBoundingClientRect();
      const v = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
      vs.querySelector('.fill').style.width = v * 100 + '%';
      vs.querySelector('.knob').style.left = v * 100 + '%';
      send('volume', v);
    };
    apply(e);
    const up = () => { vs.removeEventListener('pointermove', apply); vs.removeEventListener('pointerup', up); };
    vs.addEventListener('pointermove', apply);
    vs.addEventListener('pointerup', up);
  }

  function startSeek(e, sl) {
    seeking = true;
    sl.setPointerCapture(e.pointerId);
    const ratio = (ev) => { const r = sl.getBoundingClientRect(); return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)); };
    const show = (ev) => setPos(sl, ratio(ev));
    show(e);
    const move = (ev) => show(ev);
    const up = (ev) => {
      send('seekRatio', ratio(ev));
      seeking = false;
      sl.removeEventListener('pointermove', move);
      sl.removeEventListener('pointerup', up);
    };
    sl.addEventListener('pointermove', move);
    sl.addEventListener('pointerup', up);
  }

  if (window.ExtraWidgets) window.ExtraWidgets.bind(root, send);

  // ---------------- data
  api.player.onState((s) => { state = s; stateAt = performance.now(); render(); tick(); });
  api.settings.onChange((s) => { settings = s; render(); if (settings.widget.mode === 'touch') { if (['settings', 'viz', 'radio', 'radiolist'].includes(tcur().s)) { if (tcur().s === 'radiolist' && R.src === 'favorites') R.list = favs(); renderTouch(false); } paintLock(); } });
  (async () => {
    settings = await api.settings.get();
    state = await api.player.getState();
    stateAt = performance.now();
    render();
    send('sync');
  })();
})();
