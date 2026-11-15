/* More mini players: a classic CD Player, a Vinyl record and a Cassette.
   widget.js hands each one the player state; buttons use the same data-cmd / data-act attributes
   as the other mini players, so clicks, dragging and the right-click menu all work the same way. */
(() => {
  // content sizes (the window adds a 12px transparent margin on every side)
  const SIZES = { cdplayer: { w: 304, h: 206 }, vinyl: { w: 328, h: 232 }, cassette: { w: 320, h: 216 } };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mmss = (sec) => { sec = Math.max(0, Math.floor(sec || 0)); return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`; };
  let n = 0;

  // ---------------------------------------------------------------- CD Player (late-90s desktop style)
  const G = {   // tiny black glyphs for the transport buttons
    play: '<path d="M3 1.5 L10 6 L3 10.5Z"/>',
    pause: '<rect x="2.5" y="2" width="2.6" height="8"/><rect x="7" y="2" width="2.6" height="8"/>',
    stop: '<rect x="2.5" y="2.5" width="7" height="7"/>',
    prev: '<rect x="1.5" y="2" width="1.6" height="8"/><path d="M10.5 2 L4 6 L10.5 10Z"/>',
    rew: '<path d="M6 2 L1 6 L6 10Z M11 2 L6 6 L11 10Z"/>',
    ffwd: '<path d="M1 2 L6 6 L1 10Z M6 2 L11 6 L6 10Z"/>',
    next: '<path d="M1.5 2 L8 6 L1.5 10Z"/><rect x="8.9" y="2" width="1.6" height="8"/>',
    eject: '<path d="M6 1.5 L11 7 H1Z"/><rect x="1" y="8.4" width="10" height="2"/>'
  };
  const glyph = (k) => `<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">${G[k]}</svg>`;
  function cdplayer(s) {
    const t = s && s.track;
    const up = (s && s.upNext) || [];
    const opts = up.length ? up.map((q) => `<option value="${q.i}" ${q.i === s.index ? 'selected' : ''}>${esc(q.title)} &lt;${mmss(q.duration)}&gt;</option>`).join('')
      : '<option>Nothing in the queue</option>';
    return `<div class="cdp">
      <div class="cdp-title">
        <svg class="cdp-ic" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="#d9dde3" stroke="#555" stroke-width=".8"/><circle cx="8" cy="8" r="4.5" fill="none" stroke="#9fb7d9" stroke-width="2"/><circle cx="8" cy="8" r="1.6" fill="#fff" stroke="#555" stroke-width=".6"/></svg>
        <span class="cdp-name">CD Player</span>
        <span class="cdp-tbs"><button class="cdp-tb" data-act="close" title="Close">_</button><button class="cdp-tb" data-act="main" title="Open the full app">□</button><button class="cdp-tb x" data-act="close" title="Close">×</button></span>
      </div>
      <div class="cdp-menu"><button data-act="main"><u>D</u>isc</button><button data-act="menu"><u>V</u>iew</button><button data-act="menu"><u>O</u>ptions</button><button data-act="nowplaying"><u>H</u>elp</button></div>
      <div class="cdp-top">
        <div class="cdp-lcd"><span class="cdp-trk">[${String(t && s.index >= 0 ? s.index + 1 : 0).padStart(2, '0')}]</span> <span class="cdp-time">00:00</span></div>
        <div class="cdp-btns">
          <div class="cdp-row"><button class="cdp-b wide ${s && s.playing ? 'down' : ''}" data-cmd="play" title="Play">${glyph('play')}</button><button class="cdp-b ${s && !s.playing && t ? 'down' : ''}" data-cmd="pause" title="Pause">${glyph('pause')}</button><button class="cdp-b" data-cmd="stop" title="Stop">${glyph('stop')}</button></div>
          <div class="cdp-row"><button class="cdp-b" data-cmd="prev" title="Previous track">${glyph('prev')}</button><button class="cdp-b" data-cmd="rew" title="Skip back">${glyph('rew')}</button><button class="cdp-b" data-cmd="ffwd" title="Skip ahead">${glyph('ffwd')}</button><button class="cdp-b" data-cmd="next" title="Next track">${glyph('next')}</button><button class="cdp-b" data-act="nowplaying" title="Open now playing">${glyph('eject')}</button></div>
        </div>
      </div>
      <div class="cdp-f"><label>Artist:</label><div class="cdp-in"><span class="ell">${t ? esc(t.artist) : 'Data or no disc loaded'}</span><span class="cdp-dr">&lt;D:&gt;</span><i class="cdp-arrow"></i></div></div>
      <div class="cdp-f"><label>Title:</label><div class="cdp-in ro"><span class="ell">${t ? esc(t.album || t.title) : 'Please insert an audio compact disc.'}</span></div></div>
      <div class="cdp-f"><label>Track:</label><div class="cdp-in sel"><select data-track>${opts}</select><i class="cdp-arrow"></i></div></div>
      <div class="cdp-status"><span class="cdp-total">Total Play: 00:00 m:s</span><span class="cdp-tr">Track: 00:00 m:s</span></div>
    </div>`;
  }

  // ---------------------------------------------------------------- Vinyl: the record slides out of its sleeve while playing
  function vinyl(s) {
    const t = s && s.track;
    const art = t ? esc(t.artLarge || t.art || '') : '';
    return `<div class="vin ${s && s.playing ? 'on' : ''}">
      <div class="vin-rec"><div class="vin-disc"><div class="vin-label" ${art ? `style="background-image:url('${art}')"` : ''}></div></div></div>
      <div class="vin-cover">
        ${art ? `<img src="${art}" alt="">` : '<div class="vin-blank"></div>'}
        <div class="vin-ov">
          <div class="vin-meta">${t ? `<div class="t ell">${esc(t.title)}</div><div class="s ell">${esc(t.artist)}${t.album ? ' — ' + esc(t.album) : ''}</div>` : '<div class="t">Nothing playing</div>'}</div>
          <div class="vin-c">
            <button data-cmd="prev" title="Previous">${icon('prev')}</button>
            <button class="play" data-cmd="toggle" title="Play/Pause">${icon(s && s.playing ? 'pause' : 'play')}</button>
            <button data-cmd="next" title="Next">${icon('next')}</button>
          </div>
          <div class="vin-line"><i></i></div>
        </div>
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------- Cassette: the cassette while playing, its case when paused
  function cassetteSvg(t, ratio) {
    const id = 'wc' + (++n);
    const r0 = 9, rF = 27;
    const pack = (k) => Math.sqrt(r0 * r0 + k * (rF * rF - r0 * r0));
    const pL = pack(1 - ratio).toFixed(1), pR = pack(ratio).toFixed(1);
    const hub = (cx) => `<g class="reel" style="transform-origin:${cx}px 56px"><circle cx="${cx}" cy="56" r="7.6" fill="url(#${id}hub)"/><circle cx="${cx}" cy="56" r="4.6" fill="#141517"/>${[0, 60, 120, 180, 240, 300].map((a) => `<rect x="${cx - 0.9}" y="51.2" width="1.8" height="2.4" rx=".4" fill="#f2f1ec" transform="rotate(${a} ${cx} 56)"/>`).join('')}</g>`;
    const screw = (x, y) => `<circle cx="${x}" cy="${y}" r="2.5" fill="#2b2d31" stroke="#55585e" stroke-width=".5"/><path d="M${x - 1.5} ${y - 0.4} l3 0.8 M${x - 0.4} ${y + 1.5} l0.8 -3" stroke="#0d0e10" stroke-width=".6"/>`;
    const ring = (x) => `<circle cx="${x}" cy="111" r="7" fill="rgba(255,255,255,.07)" stroke="rgba(255,255,255,.18)" stroke-width=".8"/><circle cx="${x}" cy="111" r="4.2" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="1.4"/><circle cx="${x}" cy="111" r="1.8" fill="#0b0b0c"/>`;
    const tape = `<circle cx="70" cy="56" r="${pL}" fill="url(#${id}tape)"/><circle cx="130" cy="56" r="${pR}" fill="url(#${id}tape)"/>`;
    return `<svg class="wc-svg" viewBox="0 0 200 127" aria-hidden="true">
      <defs>
        <pattern id="${id}grid" width="2.2" height="2.2" patternUnits="userSpaceOnUse"><rect x=".25" y=".25" width="1.7" height="1.7" fill="none" stroke="rgba(255,255,255,.09)" stroke-width=".35"/></pattern>
        <linearGradient id="${id}shell" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgba(74,77,84,.92)"/><stop offset=".5" stop-color="rgba(44,46,51,.92)"/><stop offset="1" stop-color="rgba(30,31,35,.95)"/></linearGradient>
        <linearGradient id="${id}label" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e4e7e3"/><stop offset="1" stop-color="#cfd3ce"/></linearGradient>
        <radialGradient id="${id}tape"><stop offset=".3" stop-color="#3a2a22"/><stop offset=".85" stop-color="#2a1d17"/><stop offset="1" stop-color="#4a372c"/></radialGradient>
        <radialGradient id="${id}hub" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#fff"/><stop offset=".7" stop-color="#e2e1dc"/><stop offset="1" stop-color="#b9b8b2"/></radialGradient>
        <linearGradient id="${id}gloss" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgba(255,255,255,.16)"/><stop offset=".3" stop-color="rgba(255,255,255,.03)"/><stop offset=".55" stop-color="rgba(255,255,255,0)"/><stop offset="1" stop-color="rgba(255,255,255,.05)"/></linearGradient>
        <clipPath id="${id}body"><rect x="2" y="2" width="196" height="123" rx="6"/></clipPath>
        <clipPath id="${id}win"><rect x="40.5" y="45" width="119" height="22" rx="1.6"/></clipPath>
      </defs>
      <g clip-path="url(#${id}body)">${tape}<rect x="2" y="2" width="196" height="123" fill="url(#${id}shell)"/><rect x="2" y="2" width="196" height="123" fill="url(#${id}grid)"/></g>
      <rect x="2" y="2" width="196" height="123" rx="6" fill="none" stroke="#15161a" stroke-width="1.2"/>
      <rect x="22" y="2" width="14" height="5" rx="1" fill="rgba(0,0,0,.45)"/><rect x="164" y="2" width="14" height="5" rx="1" fill="rgba(0,0,0,.45)"/>
      <rect x="13" y="11" width="174" height="73" rx="3" fill="url(#${id}label)"/>
      <rect x="18" y="14.5" width="164" height="27" rx="1.5" fill="#f7f7f3"/>
      <rect x="18" y="27.8" width="164" height=".45" fill="#b9c2c4"/><rect x="18" y="36.8" width="164" height=".45" fill="#b9c2c4"/>
      <text x="22" y="25.6" data-fit="156" font-family="'Segoe Print', 'Bradley Hand', 'Comic Sans MS', cursive" font-size="7.6" fill="#1e2b55">${esc(t ? t.title : 'Nothing playing')}</text>
      <text x="22" y="35" data-fit="156" font-family="'Segoe Print', 'Bradley Hand', 'Comic Sans MS', cursive" font-size="5.6" fill="#33406b">${esc(t ? [t.artist, t.album].filter(Boolean).join(' — ') : '')}</text>
      <text x="19" y="63" font-family="Arial, Helvetica, sans-serif" font-size="11" font-weight="700" fill="#16171a">A</text>
      <rect x="13" y="72" width="174" height="10" fill="#1590d4"/>
      <text x="19" y="79.4" font-family="Arial, Helvetica, sans-serif" font-size="4.3" fill="rgba(255,255,255,.9)" letter-spacing=".3">TYPE I · NORMAL POSITION</text>
      <rect x="40" y="44.5" width="120" height="23" rx="2" fill="#121315" stroke="#0c0d0f" stroke-width="1"/>
      <g clip-path="url(#${id}win)" opacity=".95">${tape}<rect x="40" y="44.5" width="120" height="23" fill="rgba(20,21,24,.35)"/></g>
      <rect x="86" y="46" width="28" height="20" fill="rgba(255,255,255,.05)" stroke="rgba(255,255,255,.12)" stroke-width=".4"/>
      <path d="M86 56 H114" stroke="rgba(255,255,255,.35)" stroke-width=".35"/>
      ${[88, 92, 96, 100, 104, 108, 112].map((x, i) => `<path d="M${x} ${i % 3 === 0 ? 53.6 : 54.8} V${i % 3 === 0 ? 58.4 : 57.2}" stroke="rgba(255,255,255,.4)" stroke-width=".35"/>`).join('')}
      <circle cx="70" cy="56" r="9.6" fill="rgba(0,0,0,.35)"/><circle cx="130" cy="56" r="9.6" fill="rgba(0,0,0,.35)"/>
      ${hub(70)}${hub(130)}
      <path d="M48 125 L55.5 98.5 H144.5 L152 125" fill="rgba(255,255,255,.05)" stroke="#121316" stroke-width="1"/>
      <circle cx="68" cy="116.5" r="3.3" fill="#0a0a0b" stroke="rgba(255,255,255,.18)" stroke-width=".5"/><circle cx="132" cy="116.5" r="3.3" fill="#0a0a0b" stroke="rgba(255,255,255,.18)" stroke-width=".5"/>
      <rect x="81" y="112.5" width="6.5" height="6.5" rx="1.2" fill="#0a0a0b" stroke="rgba(255,255,255,.18)" stroke-width=".5"/><rect x="112.5" y="112.5" width="6.5" height="6.5" rx="1.2" fill="#0a0a0b" stroke="rgba(255,255,255,.18)" stroke-width=".5"/>
      <rect x="93" y="118.5" width="14" height="5" rx="1" fill="#5a3f33" stroke="#2a1d17" stroke-width=".4"/>
      <circle cx="100" cy="104" r="1.9" fill="#0a0a0b"/>
      ${ring(20)}${ring(180)}
      ${screw(8.5, 8.5)}${screw(191.5, 8.5)}${screw(8.5, 118.5)}${screw(191.5, 118.5)}${screw(100, 91.5)}
      <rect x="2" y="2" width="196" height="123" rx="6" fill="url(#${id}gloss)"/>
    </svg>`;
  }
  function caseSvg(t) {
    const id = 'wk' + (++n);
    const art = t ? esc(t.artLarge || t.art || '') : '';
    return `<svg class="wk-svg" viewBox="0 0 128 200" aria-hidden="true">
      <defs>
        <clipPath id="${id}art"><rect x="7" y="11" width="114" height="114"/></clipPath>
        <linearGradient id="${id}glare" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgba(255,255,255,.26)"/><stop offset=".28" stop-color="rgba(255,255,255,.06)"/><stop offset=".29" stop-color="rgba(255,255,255,0)"/><stop offset=".8" stop-color="rgba(255,255,255,0)"/><stop offset="1" stop-color="rgba(255,255,255,.08)"/></linearGradient>
        <linearGradient id="${id}hinge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2c30"/><stop offset=".45" stop-color="#9ea2a8"/><stop offset=".6" stop-color="#3a3c41"/><stop offset="1" stop-color="#151619"/></linearGradient>
      </defs>
      <rect x="1" y="1" width="126" height="198" rx="3" fill="rgba(235,240,245,.10)" stroke="rgba(255,255,255,.45)" stroke-width="1"/>
      <rect x="7" y="11" width="114" height="178" fill="#f2efe8"/>
      ${art ? `<image href="${art}" x="7" y="11" width="114" height="114" clip-path="url(#${id}art)" preserveAspectRatio="xMidYMid slice"/>` : '<rect x="7" y="11" width="114" height="114" fill="#1590d4"/>'}
      <rect x="7" y="125" width="114" height="3" fill="#1590d4"/>
      <text x="12" y="142" data-fit="104" font-family="Poppins, 'Segoe UI', sans-serif" font-size="9" font-weight="700" fill="#1b1d21">${esc(t ? t.album || t.title : '')}</text>
      <text x="12" y="153" data-fit="104" font-family="Poppins, 'Segoe UI', sans-serif" font-size="6.6" fill="#555b63">${esc(t ? t.artist : '')}</text>
      ${[166, 172, 178].map((y, i) => `<rect x="12" y="${y}" width="${70 - i * 14}" height="1.6" rx=".8" fill="#d6d0c3"/>`).join('')}
      <text x="116" y="182" font-family="Arial, sans-serif" font-size="5" font-weight="700" fill="#9aa0a7" text-anchor="end" letter-spacing=".4">STEREO</text>
      <rect x="1" y="1" width="126" height="8" rx="2" fill="url(#${id}hinge)"/>
      <rect x="1" y="191" width="126" height="8" rx="2" fill="url(#${id}hinge)"/>
      <rect x="2.5" y="9" width="2.5" height="182" fill="rgba(255,255,255,.18)"/><rect x="123" y="9" width="2.5" height="182" fill="rgba(255,255,255,.1)"/>
      <rect x="1" y="1" width="126" height="198" rx="3" fill="url(#${id}glare)"/>
    </svg>`;
  }
  function cassette(s, ratio) {
    const t = s && s.track;
    return `<div class="wcass ${s && s.playing ? 'on' : ''}">
      <div class="wc-tape">${cassetteSvg(t, ratio)}</div>
      <div class="wc-case">${caseSvg(t)}</div>
      <div class="wc-c">
        <button data-cmd="prev" title="Previous">${icon('prev')}</button>
        <button class="play" data-cmd="toggle" title="Play/Pause">${icon(s && s.playing ? 'pause' : 'play')}</button>
        <button data-cmd="next" title="Next">${icon('next')}</button>
      </div>
    </div>`;
  }

  // Shorten SVG text marked data-fit so it stays on its label.
  function fitText(root) {
    for (const tx of root.querySelectorAll('text[data-fit]')) {
      const max = +tx.dataset.fit, full = tx.textContent;
      try {
        if (tx.getComputedTextLength() <= max) continue;
        let lo = 0, hi = full.length;
        while (lo < hi) { const m = Math.ceil((lo + hi) / 2); tx.textContent = full.slice(0, m).trimEnd() + '…'; if (tx.getComputedTextLength() <= max) lo = m; else hi = m - 1; }
        tx.textContent = full.slice(0, lo).trimEnd() + '…';
      } catch {}
    }
  }

  window.ExtraWidgets = {
    sizes: SIZES,
    has: (mode) => Object.prototype.hasOwnProperty.call(SIZES, mode),
    // what forces a redraw (progress is updated by tick; the cassette's tape packs redraw every few percent)
    key(mode, s, ratio) { return mode === 'cassette' ? Math.round(ratio * 30) : ''; },
    render(mode, root, s, ratio) {
      root.innerHTML = mode === 'cdplayer' ? cdplayer(s) : mode === 'vinyl' ? vinyl(s) : cassette(s, ratio);
      fitText(root);
    },
    tick(mode, root, s, pos) {
      const d = (s && s.duration) || 0;
      if (mode === 'cdplayer') {
        const tm = root.querySelector('.cdp-time');
        if (tm) tm.textContent = mmss(pos);
        const tr = root.querySelector('.cdp-tr');
        if (tr) tr.textContent = `Track: ${mmss(d)} m:s`;
        const tot = root.querySelector('.cdp-total');
        if (tot) tot.textContent = `Total Play: ${mmss((s && s.queueDuration) || d)} m:s`;
      } else if (mode === 'vinyl') {
        const line = root.querySelector('.vin-line i');
        if (line) line.style.width = (d ? Math.min(100, (pos / d) * 100) : 0).toFixed(2) + '%';
      }
    },
    // the CD Player's track list, plus its skip buttons
    bind(root, send, getState) {
      root.addEventListener('change', (e) => {
        if (e.target.matches('[data-track]')) send('playIndex', +e.target.value);
      });
    }
  };
})();
