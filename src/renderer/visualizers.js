/* Zudio Music mode visualizers.
   Each visualizer: { id, name, create(canvas) -> { frame(audio, meta, dt), resize(), destroy() } }
   audio = { freq: Uint8Array(1024), wave: Uint8Array(2048), bass, mid, treble, level, beat }
   meta  = { title, artist, album, art (HTMLImageElement|null), progress (0-1), playing, tint [r,g,b] 0-255 } */
(() => {
  const ACCENT = '#008fd5';
  const TAU = Math.PI * 2;

  // ---------------------------------------------------------------- helpers
  function fit(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return { w, h, dpr };
  }
  // 64 log-spaced bands from ~30 Hz to ~16 kHz
  function bands(freq, n, sampleRate = 44100) {
    const out = new Float32Array(n);
    const nyq = sampleRate / 2, bins = freq.length;
    for (let i = 0; i < n; i++) {
      const f0 = 30 * Math.pow(16000 / 30, i / n), f1 = 30 * Math.pow(16000 / 30, (i + 1) / n);
      const b0 = Math.max(1, Math.floor((f0 / nyq) * bins)), b1 = Math.max(b0 + 1, Math.ceil((f1 / nyq) * bins));
      let s = 0;
      for (let b = b0; b < b1 && b < bins; b++) s = Math.max(s, freq[b]);
      out[i] = s / 255;
    }
    return out;
  }

  // ---------------------------------------------------------------- WebGL plumbing
  function glScene(canvas, fragSrc) {
    const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false });
    if (!gl) return null;
    const vs = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fragSrc));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = {};
    const uni = (name) => (u[name] ??= gl.getUniformLocation(prog, name));
    return {
      draw(uniforms, scale = 1) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2) * scale;
        const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        gl.viewport(0, 0, w, h);
        gl.uniform2f(uni('uRes'), w, h);
        for (const [k, v] of Object.entries(uniforms)) {
          if (Array.isArray(v)) gl.uniform3f(uni(k), v[0], v[1], v[2]); else gl.uniform1f(uni(k), v);
        }
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      destroy() { const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); }
    };
  }
  const NOISE = `
    float hash(vec3 p){ p=fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
    float noise(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
      return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                 mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
    float fbm(vec3 p){ float v=0.,a=.5; for(int i=0;i<6;i++){ v+=a*noise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=.5; } return v; }`;

  // ================================================================ 1. Spectrum (early-2000s media player bars)
  // Colourways for Spectrum: [top, middle, bottom, peak cap, background glow]
  const SPECTRUM_THEMES = {
    rdio:    { name: 'Classic blue', stops: ['#bff0ff', '#19a7ef', '#00507a'], cap: '#e8f8ff', glow: '#071a28', floor: 'rgba(0,143,213,.55)' },
    classic: { name: 'Classic',   stops: ['#ff3b2f', '#ffd23f', '#22c55e'], cap: '#ffffff', glow: '#06180c', floor: 'rgba(34,197,94,.5)', mid: 0.45 },
    fire:    { name: 'Fire',      stops: ['#fff3b0', '#ff8a1f', '#a3120b'], cap: '#fff7d6', glow: '#240802', floor: 'rgba(255,120,30,.5)' },
    sunset:  { name: 'Sunset',    stops: ['#ffd27a', '#e0507a', '#4a2a86'], cap: '#ffe9c7', glow: '#1b0f2c', floor: 'rgba(224,80,122,.5)' },
    ice:     { name: 'Ice',       stops: ['#ffffff', '#9fe7ff', '#2b6c8f'], cap: '#ffffff', glow: '#0a1a22', floor: 'rgba(159,231,255,.45)' },
    mono:    { name: 'Mono',      stops: ['#ffffff', '#c9ced4', '#5b6168'], cap: '#ffffff', glow: '#111214', floor: 'rgba(255,255,255,.35)' },
    neon:    { name: 'Neon',      stops: ['#f0abfc', '#a855f7', '#1d4ed8'], cap: '#fae8ff', glow: '#12061f', floor: 'rgba(168,85,247,.5)' },
    rainbow: { name: 'Rainbow',   rainbow: true, cap: '#ffffff', glow: '#0b0b10', floor: 'rgba(255,255,255,.3)' }
  };

  // ================================================================ 1. Spectrum (early-2000s media player bars)
  const spectrum = {
    id: 'spectrum', name: 'Spectrum', group: 'Classic media player',
    create(canvas) {
      const ctx = canvas.getContext('2d');
      const N = 48;
      const peaks = new Float32Array(N), held = new Float32Array(N), vals = new Float32Array(N);
      return {
        frame(a, meta, dt) {
          const th = SPECTRUM_THEMES[meta.spectrumTheme] || SPECTRUM_THEMES.rdio;
          const { w, h } = fit(canvas);
          const g = ctx.createRadialGradient(w / 2, h * 0.62, 10, w / 2, h * 0.62, Math.max(w, h) * 0.7);
          g.addColorStop(0, th.glow); g.addColorStop(1, '#000');
          ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
          const b = bands(a.freq, N, a.sampleRate);
          const base = h * 0.66, maxH = h * 0.5, gap = w * 0.004;
          const bw = (w * 0.8 - gap * (N - 1)) / N, x0 = w * 0.1;
          for (let i = 0; i < N; i++) {
            vals[i] = Math.max(b[i], vals[i] - dt * 2.2);
            if (vals[i] >= peaks[i]) { peaks[i] = vals[i]; held[i] = 0.35; }
            else if ((held[i] -= dt) < 0) peaks[i] = Math.max(0, peaks[i] - dt * 0.7);
            const x = x0 + i * (bw + gap), bh = Math.max(2, vals[i] * maxH);
            let fill, refl;
            if (th.rainbow) {
              const hue = (i / N) * 300;
              const lg = ctx.createLinearGradient(0, base - maxH, 0, base);
              lg.addColorStop(0, `hsl(${hue},100%,85%)`); lg.addColorStop(0.35, `hsl(${hue},95%,58%)`); lg.addColorStop(1, `hsl(${hue},90%,28%)`);
              fill = lg; refl = `hsl(${hue},95%,58%)`;
            } else {
              const lg = ctx.createLinearGradient(0, base - maxH, 0, base);
              lg.addColorStop(0, th.stops[0]); lg.addColorStop(th.mid || 0.35, th.stops[1]); lg.addColorStop(1, th.stops[2]);
              fill = lg; refl = th.stops[1];
            }
            // segmented LED look
            ctx.fillStyle = fill;
            const seg = Math.max(3, h * 0.008);
            for (let y = base - seg; y > base - bh; y -= seg * 1.6) ctx.fillRect(x, y, bw, seg);
            // peak cap
            ctx.fillStyle = th.cap;
            ctx.fillRect(x, base - peaks[i] * maxH - seg * 2.2, bw, seg * 0.9);
            // reflection
            ctx.globalAlpha = 0.18;
            ctx.fillStyle = refl;
            for (let y = base + seg * 0.6; y < base + bh * 0.45; y += seg * 1.6) ctx.fillRect(x, y, bw, seg);
            ctx.globalAlpha = 1;
          }
          // floor line
          ctx.fillStyle = th.floor;
          ctx.fillRect(x0, base + 1, w * 0.8, Math.max(1, h * 0.002));
        },
        resize() {}, destroy() {}
      };
    }
  };

  // ================================================================ 2. Scope (glowing oscilloscope with trails)
  const scope = {
    id: 'scope', name: 'Scope', group: 'Classic media player',
    create(canvas) {
      const ctx = canvas.getContext('2d');
      let hue = 200;
      return {
        frame(a, meta, dt) {
          const { w, h } = fit(canvas);
          ctx.fillStyle = 'rgba(0,0,0,.22)';
          ctx.fillRect(0, 0, w, h);
          hue = (hue + dt * 8) % 360;
          const amp = h * (0.2 + a.bass * 0.08);
          for (let pass = 0; pass < 2; pass++) {
            ctx.beginPath();
            const n = a.wave.length, step = 4;
            for (let i = 0; i < n; i += step) {
              const x = (i / (n - 1)) * w;
              const y = h / 2 + ((a.wave[i] - 128) / 128) * amp * (pass ? -0.6 : 1);
              i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
            }
            ctx.strokeStyle = pass ? `hsla(${(hue + 160) % 360},90%,65%,.55)` : `hsl(${hue},95%,62%)`;
            ctx.lineWidth = Math.max(1.5, h * 0.004);
            ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = h * 0.03;
            ctx.stroke();
          }
          ctx.shadowBlur = 0;
        },
        resize() {}, destroy() {}
      };
    }
  };

  // ================================================================ 3. Swirl (feedback kaleidoscope, "Ambience"-era)
  const swirl = {
    id: 'swirl', name: 'Swirl', group: 'Classic media player',
    create(canvas) {
      const ctx = canvas.getContext('2d');
      let buf = document.createElement('canvas');
      let tmp = document.createElement('canvas'), tctx = tmp.getContext('2d');
      let hue = 190, spin = 0;
      return {
        frame(a, meta, dt) {
          const { w, h } = fit(canvas);
          const sw = Math.round(w / 2), sh = Math.round(h / 2);            // render at half res for speed
          if (buf.width !== sw || buf.height !== sh) { buf.width = tmp.width = sw; buf.height = tmp.height = sh; }
          hue = (hue + dt * (6 + a.mid * 10)) % 360;
          spin += dt * (0.12 + a.bass * 0.18);
          // feedback: previous frame zoomed + rotated, decaying a little every frame
          tctx.globalCompositeOperation = 'source-over';
          tctx.globalAlpha = 1;
          tctx.fillStyle = '#000';
          tctx.fillRect(0, 0, sw, sh);
          tctx.save();
          tctx.translate(sw / 2, sh / 2);
          tctx.rotate((0.004 + a.bass * 0.006) * dt * 60);
          const z = 1 + (0.01 + a.level * 0.015) * dt * 60;
          tctx.scale(z, z);
          tctx.globalAlpha = 0.86;
          tctx.drawImage(buf, -sw / 2, -sh / 2);
          tctx.restore();
          tctx.globalAlpha = 1;
          // new shape: a waveform rose, mirrored 6 ways
          tctx.save();
          tctx.translate(sw / 2, sh / 2);
          tctx.globalCompositeOperation = 'lighter';
          const R = Math.min(sw, sh) * (0.17 + a.bass * 0.06);
          for (let k = 0; k < 6; k++) {
            tctx.rotate(TAU / 6);
            tctx.beginPath();
            for (let i = 0; i <= 128; i++) {
              const t = i / 128, ang = t * Math.PI + spin;
              const v = (a.wave[Math.floor(t * (a.wave.length - 1))] - 128) / 128;
              const r = R * (1 + v * 0.9);
              const x = Math.cos(ang) * r, y = Math.sin(ang) * r * 0.6;
              i ? tctx.lineTo(x, y) : tctx.moveTo(x, y);
            }
            tctx.strokeStyle = `hsla(${(hue + k * 22) % 360},95%,58%,.55)`;
            tctx.lineWidth = 1.6;
            tctx.stroke();
          }
          if (a.beat) {
            const rg = tctx.createRadialGradient(0, 0, 0, 0, 0, R * 1.6);
            rg.addColorStop(0, `hsla(${hue},100%,65%,.22)`); rg.addColorStop(1, 'transparent');
            tctx.fillStyle = rg; tctx.fillRect(-sw, -sh, sw * 2, sh * 2);
          }
          tctx.restore();
          [buf, tmp] = [tmp, buf];
          tctx = tmp.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(buf, 0, 0, w, h);
        },
        resize() {}, destroy() {}
      };
    }
  };

  // ================================================================ 4. Earth (a slow, cinematic orbit)
  // A small, realistic globe that drifts through a sequence of shots: lit, half-lit, a crescent,
  // the sun rising behind the limb with its orange ring, a blue star beside a thin crescent,
  // and a close pass over the edge of the planet. The music brightens the sun and the atmosphere.
  const EARTH_FRAG = `precision highp float;
    uniform vec2 uRes; uniform float uTime, uBass, uLevel, uD, uSpin, uFocal, uOx, uOy;
    uniform vec3 uSun, uSunCol, uRing;
    float hash(vec3 p){ p=fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
    float noise(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
      return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                 mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
    float fbm6(vec3 p){ float v=0.,a=.5; for(int i=0;i<6;i++){ v+=a*noise(p); p=p*2.02+vec3(1.7,9.2,3.1); a*=.5; } return v; }
    float fbm4(vec3 p){ float v=0.,a=.5; for(int i=0;i<4;i++){ v+=a*noise(p); p=p*2.03+vec3(5.1,1.3,7.7); a*=.5; } return v; }
    mat3 rotY(float a){ float c=cos(a),s=sin(a); return mat3(c,0.,-s, 0.,1.,0., s,0.,c); }
    mat3 rotX(float a){ float c=cos(a),s=sin(a); return mat3(1.,0.,0., 0.,c,s, 0.,-s,c); }
    float height(vec3 q){ vec3 w=vec3(fbm4(q*1.3+3.1),fbm4(q*1.3+7.4),fbm4(q*1.3+1.9)); return fbm6(q*1.55+w*0.9); }
    // swirling cloud cover: two warped layers, like weather systems seen from orbit
    float clouds(vec3 q){
      vec3 w=vec3(fbm4(q*1.7+2.0),fbm4(q*1.7+5.0),fbm4(q*1.7+9.0));
      float big=fbm6(q*2.2+w*1.6);
      float fine=fbm4(q*7.0+w*2.5);
      return smoothstep(0.40,0.70,big*0.8+fine*0.28);
    }
    void main(){
      vec2 uv=(gl_FragCoord.xy-.5*uRes)/uRes.y - vec2(uOx,uOy);
      vec3 ro=vec3(0.,0.,uD);
      vec3 rd=normalize(vec3(uv,-uFocal));
      vec3 S=normalize(uSun);
      vec3 col=vec3(0.0);
      // stars: tiny, sparse, steady
      vec2 g=floor(gl_FragCoord.xy/1.5);
      float st=hash(vec3(g,7.0));
      if(st>0.9983){ col+=vec3(0.75,0.8,0.92)*pow((st-0.9983)*588.0,3.0)*0.8; }
      float b=dot(ro,rd); float c=dot(ro,ro)-1.0; float h=b*b-c;
      vec3 cp=ro+rd*(-b); float dmin=length(cp);
      float toward=max(dot(rd,S),0.0);
      // the ring of light when the sun is behind the planet (strongest near the sun)
      float ringK=pow(toward,60.0)*2.2+pow(toward,8.0)*0.35;
      float hit=step(0.0,h)*step(0.0,-b);
      if(hit>0.5){
        float t=-b-sqrt(h); vec3 p=ro+rd*t; vec3 n=normalize(p);
        mat3 R=rotY(uSpin)*rotX(0.41);
        vec3 q=R*n;
        float e=height(q);
        float sea=0.53;
        float land=smoothstep(sea-0.004,sea+0.004,e);
        float lat=abs(q.y);
        float ndl=dot(n,S);
        // light warms and fades across the terminator
        float diff=smoothstep(-0.06,0.6,ndl)*max(ndl+0.06,0.0)/1.06;
        vec3 lightCol=mix(vec3(1.0,0.5,0.25),vec3(1.0),smoothstep(-0.02,0.3,ndl))*uSunCol;
        float elev=clamp((e-sea)/0.25,0.0,1.0);
        float dry=smoothstep(0.15,0.35,1.0-abs(lat-0.27)*3.2)*smoothstep(0.45,0.62,fbm4(q*3.0+11.0));
        vec3 terrain=mix(mix(vec3(0.16,0.17,0.11),vec3(0.33,0.29,0.21),smoothstep(0.1,0.5,elev)),vec3(0.58,0.47,0.34),dry);
        terrain=mix(terrain,vec3(0.40,0.37,0.33),smoothstep(0.55,0.95,elev));
        float shallow=smoothstep(sea-0.07,sea,e);
        vec3 ocean=mix(vec3(0.01,0.045,0.11),vec3(0.03,0.15,0.22),shallow);
        vec3 surf=mix(ocean,terrain,land);
        float ice=smoothstep(0.8,0.88,lat+(fbm4(q*5.0)-0.5)*0.12);
        surf=mix(surf,vec3(0.85,0.9,0.95),ice);
        vec3 qc=rotY(uTime*0.004)*q;
        float cl=clouds(qc);
        vec3 lit=surf*diff*lightCol*1.15;
        // glint on the water
        vec3 hv=normalize(S-rd);
        lit+=lightCol*(pow(max(dot(n,hv),0.0),160.0)*1.1+pow(max(dot(n,hv),0.0),20.0)*0.08)*(1.0-land)*(1.0-cl)*step(0.0,ndl);
        // clouds: bright, slightly blue in shadowed folds
        vec3 cloudCol=mix(vec3(0.62,0.7,0.82),vec3(0.97,0.97,1.0),smoothstep(0.3,0.9,cl));
        lit=mix(lit,cloudCol*diff*lightCol*1.1,cl*0.92);
        // the night side is almost black, just a faint glow
        float night=smoothstep(0.02,-0.25,ndl);
        lit+=(surf*0.02+vec3(0.003,0.006,0.014))*night;
        // atmosphere: pale blue at the lit limb, the coloured ring when backlit
        float fres=pow(1.0-max(dot(n,-rd),0.0),3.0);
        lit+=vec3(0.32,0.55,1.0)*fres*smoothstep(-0.15,0.45,ndl)*(0.8+uLevel*0.4);
        lit+=uRing*pow(fres,1.6)*ringK*smoothstep(-0.6,0.1,ndl)*(1.0+uBass*0.6);
        col=lit;
      }
      // halo just outside the rim
      float alt=max(dmin-1.0,0.0);
      vec3 hp=normalize(cp);
      float hl=dot(hp,S);
      float outside=1.0-hit;
      col+=vec3(0.3,0.55,1.0)*exp(-alt*55.0)*smoothstep(-0.25,0.45,hl)*0.85*outside*(0.8+uLevel*0.4);
      col+=uRing*exp(-alt*70.0)*ringK*smoothstep(-0.7,0.05,hl)*1.4*outside*(1.0+uBass*0.7);
      // the sun: a hard core and a soft bloom, hidden when the planet is in the way
      float bs=dot(ro,S); vec3 sc=ro-S*bs; float ds=length(sc)-1.0;
      float blocked=step(bs,0.0);
      float visCore=mix(1.0,smoothstep(-0.004,0.01,ds),blocked);
      float visBloom=mix(1.0,smoothstep(-0.05,0.03,ds),blocked);
      float core=smoothstep(0.99993,0.99998,toward)*(1.0-hit);
      float bloom=pow(toward,1400.0)*1.5+pow(toward,160.0)*0.22+pow(toward,20.0)*0.025;
      col+=uSunCol*(core*4.0*visCore+bloom*visBloom*(1.0+uBass*0.8));
      col=1.0-exp(-col*1.3);
      gl_FragColor=vec4(pow(col,vec3(0.95)),1.0);
    }`;
  // the shots: distance, where the globe sits, and where the sun is (theta: angle from straight
  // behind the planet, phi: around the screen). Each holds a while, then eases into the next.
  const EARTH_SHOTS = [
    { D: 7.2, ox: 0, oy: 0, focal: 1.7, theta: 140, phi: 15, sun: [1, 0.98, 0.95], ring: [1, 0.45, 0.16] },
    { D: 6.9, ox: 0, oy: 0, focal: 1.7, theta: 92, phi: 8, sun: [1, 0.97, 0.93], ring: [1, 0.45, 0.16] },
    { D: 7.0, ox: 0.04, oy: 0, focal: 1.7, theta: 42, phi: 4, sun: [1, 0.96, 0.9], ring: [1, 0.45, 0.16] },
    { D: 4.6, ox: 0.02, oy: 0.03, focal: 1.7, theta: 12.2, phi: 215, sun: [1, 0.86, 0.68], ring: [1, 0.38, 0.1] },
    { D: 7.4, ox: -0.12, oy: 0, focal: 1.7, theta: 13, phi: 2, sun: [0.62, 0.78, 1.0], ring: [0.45, 0.65, 1.0] },
    { D: 1.85, ox: 0.62, oy: -0.78, focal: 1.5, theta: 118, phi: 40, sun: [1, 0.98, 0.95], ring: [1, 0.45, 0.16] }
  ];
  // Earth can play your own video instead (Settings → Visualizers → Earth video). It loops silently,
  // follows play/pause, and the music gently lifts its brightness. It picks up where it left off.
  let earthVideoTime = 0;
  function earthVideo(canvas, url) {
    const ctx = canvas.getContext('2d');
    const v = document.createElement('video');
    v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
    v.src = url;
    let failed = false, bass = 0, lvl = 0;
    v.addEventListener('error', () => { failed = true; });
    v.addEventListener('loadedmetadata', () => { if (earthVideoTime && earthVideoTime < v.duration) v.currentTime = earthVideoTime; });
    return {
      frame(a, meta, dt) {
        const { w, h } = fit(canvas);
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
        if (failed) {
          ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = `${Math.round(h * 0.022)}px "Segoe UI", sans-serif`; ctx.textAlign = 'center';
          ctx.fillText('Couldn’t open your Earth video. Choose it again in Settings → Visualizers.', w / 2, h / 2);
          return;
        }
        if (meta.playing && v.paused) v.play().catch(() => {});
        if (!meta.playing && !v.paused) v.pause();
        if (v.readyState < 2) return;
        bass += (a.bass - bass) * 0.08; lvl += (a.level - lvl) * 0.06;
        const s = Math.max(w / v.videoWidth, h / v.videoHeight);
        const dw = v.videoWidth * s, dh = v.videoHeight * s;
        ctx.filter = `brightness(${(1 + bass * 0.18 + lvl * 0.1).toFixed(3)}) saturate(${(1 + lvl * 0.25).toFixed(3)})`;
        ctx.drawImage(v, (w - dw) / 2, (h - dh) / 2, dw, dh);
        ctx.filter = 'none';
      },
      resize() {},
      destroy() { earthVideoTime = v.currentTime || 0; v.pause(); v.removeAttribute('src'); v.load(); }
    };
  }
  const earth = {
    id: 'earth', name: 'Earth', group: 'Console',
    create(canvas) {
      if (window.EarthVideo) return earthVideo(canvas, window.EarthVideo);
      const s = glScene(canvas, EARTH_FRAG);
      let t = 0, bass = 0, lvl = 0;
      const HOLD = 24, MOVE = 14;
      const ease = (x) => x * x * (3 - 2 * x);
      const lerp = (a, b, k) => a + (b - a) * k;
      const sunDir = (theta, phi) => {
        const th = theta * Math.PI / 180, ph = phi * Math.PI / 180;
        return [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), -Math.cos(th)];
      };
      return {
        frame(a, meta, dt) {
          if (!s) return;
          if (Number.isFinite(dt) && dt > 0) t += dt;   // the very first frame can arrive without a time step
          bass += (a.bass - bass) * 0.06; lvl += (a.level - lvl) * 0.05;
          const span = HOLD + MOVE, n = EARTH_SHOTS.length;
          const i = Math.floor(t / span) % n, into = (t % span) - HOLD;
          const A = EARTH_SHOTS[i], B = EARTH_SHOTS[(i + 1) % n];
          const k = into > 0 ? ease(into / MOVE) : 0;
          const m = (key) => lerp(A[key], B[key], k);
          const mv = (key) => [0, 1, 2].map((j) => lerp(A[key][j], B[key][j], k));
          // the sun travels the short way around the screen
          let dphi = B.phi - A.phi; if (dphi > 180) dphi -= 360; if (dphi < -180) dphi += 360;
          s.draw({
            uTime: t, uBass: bass, uLevel: lvl, uSpin: t * 0.018,
            uD: m('D'), uOx: m('ox'), uOy: m('oy'), uFocal: m('focal'),
            uSun: sunDir(m('theta'), A.phi + dphi * k), uSunCol: mv('sun'), uRing: mv('ring')
          }, 1);
        },
        resize() {}, destroy() { s && s.destroy(); }
      };
    }
  };

  // ================================================================ 6. Cassette deck
  const cassette = {
    id: 'cassette', name: 'Cassette Deck', group: 'Retro',
    create(canvas) {
      const ctx = canvas.getContext('2d');
      let angL = 0, angR = 0, vuL = 0, vuR = 0;
      const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); };
      // shorten text to fit the label, with an ellipsis (uses the current font)
      const clip = (text, max) => {
        if (ctx.measureText(text).width <= max) return text;
        let lo = 0, hi = text.length;
        while (lo < hi) { const m = Math.ceil((lo + hi) / 2); if (ctx.measureText(text.slice(0, m).trimEnd() + '…').width <= max) lo = m; else hi = m - 1; }
        return text.slice(0, lo).trimEnd() + '…';
      };
      function reel(cx, cy, pack, hub, ang) {
        ctx.fillStyle = '#3b2b20';
        ctx.beginPath(); ctx.arc(cx, cy, pack, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 1;
        for (let r = hub * 1.2; r < pack; r += hub * 0.18) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke(); }
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang);
        ctx.fillStyle = '#f1f1ee';
        ctx.beginPath(); ctx.arc(0, 0, hub, 0, TAU); ctx.fill();
        ctx.fillStyle = '#16181b';
        ctx.beginPath(); ctx.arc(0, 0, hub * 0.55, 0, TAU); ctx.fill();
        ctx.fillStyle = '#f1f1ee';
        for (let k = 0; k < 6; k++) { ctx.rotate(TAU / 6); ctx.fillRect(-hub * 0.09, -hub * 0.58, hub * 0.18, hub * 0.22); }
        ctx.restore();
      }
      function meter(x, y, w, h, v, label) {
        rr(x, y, w, h, h * 0.08); ctx.fillStyle = '#efe6cf'; ctx.fill();
        ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 2; ctx.stroke();
        const cx = x + w / 2, cy = y + h * 1.05, R = h * 0.82;
        ctx.lineWidth = 1.2;
        for (let i = 0; i <= 10; i++) {
          const a = -2.3 + (i / 10) * 1.46;
          ctx.strokeStyle = i > 7 ? '#d23a2a' : '#2a2a2a';
          ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R * 0.88, cy + Math.sin(a) * R * 0.88); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.stroke();
        }
        ctx.strokeStyle = '#d23a2a'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(cx, cy, R * 0.94, -2.3 + 1.46 * 0.72, -0.84); ctx.stroke();
        ctx.fillStyle = '#2a2a2a'; ctx.font = `600 ${h * 0.13}px Poppins, sans-serif`; ctx.textAlign = 'center';
        ctx.fillText('VU', cx, y + h * 0.62); ctx.fillText(label, x + w * 0.1, y + h * 0.88);
        const a = -2.3 + Math.min(1, v) * 1.46;
        ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R * 0.98, cy + Math.sin(a) * R * 0.98); ctx.stroke();
      }
      return {
        frame(a, meta, dt) {
          const { w, h } = fit(canvas);
          // deck panel
          const bg = ctx.createLinearGradient(0, 0, 0, h);
          bg.addColorStop(0, '#26282c'); bg.addColorStop(1, '#0e0f11');
          ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
          const S = Math.min(w / 1.9, h / 1.55);                  // cassette width
          const cw = S, ch = S * 0.63, cx = (w - cw) / 2, cy = h * 0.1;
          // cassette well
          rr(cx - S * 0.05, cy - S * 0.04, cw + S * 0.1, ch + S * 0.08, S * 0.03);
          ctx.fillStyle = '#08090a'; ctx.fill();
          // shell
          rr(cx, cy, cw, ch, S * 0.04); ctx.fillStyle = '#1d1f23'; ctx.fill();
          ctx.strokeStyle = '#3a3e45'; ctx.lineWidth = 2; ctx.stroke();
          // label
          const lx = cx + cw * 0.05, ly = cy + ch * 0.06, lw = cw * 0.9, lh = ch * 0.62;
          rr(lx, ly, lw, lh, S * 0.015); ctx.fillStyle = '#efe9dc'; ctx.fill();
          ctx.fillStyle = ACCENT; ctx.fillRect(lx, ly + lh * 0.42, lw, lh * 0.04);
          ctx.fillRect(lx, ly + lh * 0.93, lw, lh * 0.07);
          const art = lh * 0.34;
          if (meta.art && meta.art.complete && meta.art.naturalWidth) ctx.drawImage(meta.art, lx + lw * 0.025, ly + lh * 0.05, art, art);
          ctx.fillStyle = '#22252a'; ctx.textAlign = 'left';
          ctx.font = `700 ${lh * 0.12}px Poppins, sans-serif`;
          const tx = lx + lw * 0.03 + art + lw * 0.02, tmax = lx + lw * 0.86 - tx;   // stop short of the big "A"
          ctx.fillText(clip(meta.title || 'Nothing playing', tmax), tx, ly + lh * 0.17);
          ctx.font = `400 ${lh * 0.09}px Poppins, sans-serif`; ctx.fillStyle = '#59606a';
          ctx.fillText(clip(`${meta.artist || ''}${meta.album ? ' — ' + meta.album : ''}`, tmax), tx, ly + lh * 0.31);
          ctx.font = `700 ${lh * 0.2}px Poppins, sans-serif`; ctx.fillStyle = ACCENT; ctx.textAlign = 'center';
          ctx.fillText('A', lx + lw * 0.94, ly + lh * 0.25);
          // window + reels
          const wx = cx + cw * 0.25, wy = ly + lh * 0.5, ww = cw * 0.5, wh = lh * 0.38;
          rr(wx, wy, ww, wh, wh / 2); ctx.fillStyle = '#0b0c0e'; ctx.fill();
          ctx.save(); rr(wx, wy, ww, wh, wh / 2); ctx.clip();
          const p = meta.progress || 0, hub = wh * 0.24, maxPack = wh * 0.95;
          const packL = hub * 1.25 + (maxPack - hub * 1.25) * (1 - p), packR = hub * 1.25 + (maxPack - hub * 1.25) * p;
          // constant tape speed: smaller pack spins faster
          const speed = meta.playing ? 1.8 : 0;
          angL -= dt * speed * (maxPack / packL); angR -= dt * speed * (maxPack / packR);
          reel(wx + ww * 0.22, wy + wh / 2, packL, hub, angL);
          reel(wx + ww * 0.78, wy + wh / 2, packR, hub, angR);
          ctx.restore();
          // bottom trapezoid + screws
          ctx.beginPath();
          ctx.moveTo(cx + cw * 0.2, cy + ch); ctx.lineTo(cx + cw * 0.25, cy + ch * 0.8); ctx.lineTo(cx + cw * 0.75, cy + ch * 0.8); ctx.lineTo(cx + cw * 0.8, cy + ch);
          ctx.fillStyle = '#15171a'; ctx.fill(); ctx.strokeStyle = '#2c3036'; ctx.stroke();
          for (const [sx, sy] of [[0.035, 0.05], [0.965, 0.05], [0.035, 0.95], [0.965, 0.95], [0.5, 0.74]]) {
            ctx.fillStyle = '#4b5058'; ctx.beginPath(); ctx.arc(cx + cw * sx, cy + ch * sy, S * 0.012, 0, TAU); ctx.fill();
          }
          // VU meters
          const target = a.level * 2.4;
          vuL += (Math.min(1.05, target + a.bass * 0.25) - vuL) * Math.min(1, dt * 9);
          vuR += (Math.min(1.05, target + a.treble * 0.3) - vuR) * Math.min(1, dt * 7);
          const mw = S * 0.34, mh = S * 0.2, my = cy + ch + S * 0.09;
          meter(w / 2 - mw - S * 0.03, my, mw, mh, vuL, 'L');
          meter(w / 2 + S * 0.03, my, mw, mh, vuR, 'R');
          // transport lamp
          ctx.fillStyle = meta.playing ? ACCENT : '#333';
          ctx.shadowColor = ACCENT; ctx.shadowBlur = meta.playing ? 14 : 0;
          ctx.beginPath(); ctx.arc(w / 2, my + mh + S * 0.05, S * 0.009, 0, TAU); ctx.fill();
          ctx.shadowBlur = 0;
        },
        resize() {}, destroy() {}
      };
    }
  };


  // ================================================================ 7. Disco Ball
  const disco = {
    id: 'disco', name: 'Disco Ball', group: 'Party',
    create(canvas) {
      const ctx = canvas.getContext('2d');
      let rot = 0, flash = 0;
      const spots = Array.from({ length: 90 }, () => ({ u: Math.random() * TAU, v: (Math.random() - 0.5) * 1.6, s: 0.5 + Math.random(), hue: [200, 200, 320, 45, 0][Math.floor(Math.random() * 5)] }));
      const LAT = 14, LON = 28;
      return {
        frame(a, meta, dt) {
          const { w, h } = fit(canvas);
          rot += dt * (0.22 + a.level * 0.15);
          flash = Math.max(a.beat ? 1 : 0, flash - dt * 2.5);
          // room
          const bg = ctx.createRadialGradient(w / 2, h * 0.32, 0, w / 2, h * 0.4, Math.max(w, h) * 0.8);
          bg.addColorStop(0, '#16131f'); bg.addColorStop(1, '#030305');
          ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
          const cx = w / 2, cy = h * 0.36, R = Math.min(w, h) * 0.17;
          // light beams from above
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          for (const [x, col] of [[w * 0.12, '0,143,213'], [w * 0.88, '255,90,190']]) {
            const lg = ctx.createLinearGradient(x, 0, cx, cy);
            lg.addColorStop(0, `rgba(${col},${0.18 + flash * 0.15})`); lg.addColorStop(1, `rgba(${col},0)`);
            ctx.fillStyle = lg;
            ctx.beginPath(); ctx.moveTo(x - w * 0.02, 0); ctx.lineTo(x + w * 0.02, 0); ctx.lineTo(cx + R * 0.3, cy); ctx.lineTo(cx - R * 0.3, cy); ctx.fill();
          }
          // reflected light spots drifting across the room
          for (const sp of spots) {
            const ang = sp.u + rot;
            const x = cx + Math.sin(ang) * w * 0.55 * Math.cos(sp.v * 0.6);
            const y = cy + sp.v * h * 0.55 + Math.cos(ang) * h * 0.04;
            const depth = Math.cos(ang);                     // spots on the far wall are dimmer
            if (depth < -0.2) continue;
            const r = (2 + sp.s * 3.5) * (Math.min(w, h) / 700) * (0.7 + depth * 0.5);
            const alpha = (0.35 + depth * 0.4) * (0.6 + a.level * 0.6 + flash * 0.4);
            const gg = ctx.createRadialGradient(x, y, 0, x, y, r * 2.6);
            gg.addColorStop(0, `hsla(${sp.hue},${sp.hue === 0 ? 0 : 90}%,85%,${alpha})`); gg.addColorStop(1, 'transparent');
            ctx.fillStyle = gg; ctx.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
          }
          ctx.restore();
          // chain
          ctx.strokeStyle = '#6b6f78'; ctx.lineWidth = Math.max(1, w * 0.0015);
          ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, cy - R); ctx.stroke();
          // the ball: mirrored facets lit by a key light, glinting as they turn
          const light = [-0.5, -0.6, 0.62];
          for (let i = 0; i < LAT; i++) {
            const t0 = -Math.PI / 2 + (i / LAT) * Math.PI, t1 = -Math.PI / 2 + ((i + 1) / LAT) * Math.PI;
            const n = Math.max(6, Math.round(LON * Math.cos((t0 + t1) / 2)));
            for (let j = 0; j < n; j++) {
              const p0 = (j / n) * TAU + rot, p1 = ((j + 1) / n) * TAU + rot;
              const pm = (p0 + p1) / 2, tm = (t0 + t1) / 2;
              const nz = Math.cos(tm) * Math.cos(pm);
              if (nz <= 0.02) continue;                    // facing away
              const nx = Math.cos(tm) * Math.sin(pm), ny = Math.sin(tm);
              const lam = Math.max(0, nx * light[0] + ny * light[1] + nz * light[2]);
              const glint = ((i * 31 + j * 17 + Math.floor(rot * 6)) % 23 === 0) ? 1 : 0;
              const v = Math.min(255, 40 + lam * 150 + glint * (120 + flash * 100) + nz * 40);
              const P = (t, ph) => [cx + R * Math.cos(t) * Math.sin(ph), cy + R * Math.sin(t)];
              const q = [P(t0, p0), P(t0, p1), P(t1, p1), P(t1, p0)];
              ctx.fillStyle = glint ? `rgb(${v},${v},${Math.min(255, v + 30)})` : `rgb(${v * 0.92},${v * 0.95},${v})`;
              ctx.beginPath(); ctx.moveTo(q[0][0], q[0][1]); for (let k = 1; k < 4; k++) ctx.lineTo(q[k][0], q[k][1]); ctx.closePath(); ctx.fill();
              ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1; ctx.stroke();
            }
          }
          // soft highlight
          const hl = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, 0, cx - R * 0.35, cy - R * 0.4, R * 0.9);
          hl.addColorStop(0, 'rgba(255,255,255,.25)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = hl; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
          // dance-floor glow
          const fl = ctx.createRadialGradient(cx, h * 1.05, 0, cx, h * 1.05, w * 0.6);
          fl.addColorStop(0, `rgba(0,143,213,${0.12 + a.bass * 0.12})`); fl.addColorStop(1, 'transparent');
          ctx.fillStyle = fl; ctx.fillRect(0, h * 0.5, w, h * 0.5);
        },
        resize() {}, destroy() {}
      };
    }
  };

  // ================================================================ 8. Mist (soft smoky waveform, "ocean mist" style)
  const mist = {
    id: 'mist', name: 'Mist', group: 'Classic media player',
    create(canvas) {
      const ctx = canvas.getContext('2d');
      let hue = 200;
      return {
        frame(a, meta, dt) {
          const { w, h } = fit(canvas);
          hue = 195 + Math.sin(performance.now() / 9000) * 25;
          ctx.fillStyle = 'rgba(2,6,14,.12)';
          ctx.fillRect(0, 0, w, h);
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          for (let layer = 0; layer < 3; layer++) {
            const amp = h * (0.12 + a.bass * 0.06) * (1 - layer * 0.25);
            ctx.beginPath();
            ctx.moveTo(0, h / 2);
            const n = 160;
            for (let i = 0; i <= n; i++) {
              const idx = Math.floor((i / n) * (a.wave.length - 1));
              const v = (a.wave[idx] - 128) / 128;
              ctx.lineTo((i / n) * w, h / 2 + v * amp + Math.sin(i * 0.05 + layer + performance.now() / 1800) * h * 0.02);
            }
            for (let i = n; i >= 0; i--) {
              const idx = Math.floor((i / n) * (a.wave.length - 1));
              const v = (a.wave[idx] - 128) / 128;
              ctx.lineTo((i / n) * w, h / 2 - v * amp * 0.6 + h * 0.03);
            }
            ctx.closePath();
            ctx.fillStyle = `hsla(${hue + layer * 18},80%,55%,${0.035 + a.level * 0.03})`;
            ctx.fill();
          }
          ctx.restore();
        },
        resize() {}, destroy() {}
      };
    }
  };

  // ================================================================ 9. Inferno (spectrum as flames)
  const inferno = {
    id: 'inferno', name: 'Inferno', group: 'Classic media player',
    create(canvas) {
      const ctx = canvas.getContext('2d');
      const FW = 160, FH = 90;
      const heat = new Float32Array(FW * FH);
      const buf = document.createElement('canvas'); buf.width = FW; buf.height = FH;
      const bctx = buf.getContext('2d');
      const img = bctx.createImageData(FW, FH);
      const pal = (v) => {               // black → red → orange → yellow → white
        v = Math.min(1, Math.max(0, v));
        return [Math.min(255, v * 3 * 255), Math.min(255, Math.max(0, v * 3 - 1) * 255), Math.min(255, Math.max(0, v * 3 - 2) * 255)];
      };
      return {
        frame(a, meta, dt) {
          const { w, h } = fit(canvas);
          const b = bands(a.freq, FW, a.sampleRate);
          for (let x = 0; x < FW; x++) {
            const mirrored = b[Math.floor(Math.abs(x - FW / 2) / (FW / 2) * (FW - 1))];
            heat[(FH - 1) * FW + x] = Math.min(1, mirrored * 0.85 + Math.random() * 0.05);
          }
          for (let y = 0; y < FH - 1; y++) {
            for (let x = 0; x < FW; x++) {
              const xl = (x - 1 + FW) % FW, xr = (x + 1) % FW;
              const below = (y + 1) * FW;
              heat[y * FW + x] = Math.max(0, (heat[below + xl] + heat[below + x] + heat[below + xr] + heat[Math.min(FH - 1, y + 2) * FW + x]) / 4.0 - 0.014);
            }
          }
          for (let i = 0; i < FW * FH; i++) {
            const [r, g, bl] = pal(heat[i] * 1.4);
            img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = bl; img.data[i * 4 + 3] = 255;
          }
          bctx.putImageData(img, 0, 0);
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(buf, 0, 0, w, h);
        },
        resize() {}, destroy() {}
      };
    }
  };

  // ================================================================ 10. Spikes (radial spectrum around the album art)
  const spikes = {
    id: 'spikes', name: 'Spikes', group: 'Classic media player',
    create(canvas) {
      const ctx = canvas.getContext('2d');
      const N = 96;
      const vals = new Float32Array(N);
      let rot = 0;
      return {
        frame(a, meta, dt) {
          const { w, h } = fit(canvas);
          ctx.fillStyle = '#04060a'; ctx.fillRect(0, 0, w, h);
          rot += dt * 0.06;
          const b = bands(a.freq, N / 2, a.sampleRate);
          const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.17;
          ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
          for (let i = 0; i < N; i++) {
            const v = b[i < N / 2 ? i : N - 1 - i];
            vals[i] += (v - vals[i]) * Math.min(1, dt * 12);
            const ang = (i / N) * TAU;
            const len = R * 0.08 + vals[i] * R * 1.3;
            ctx.strokeStyle = `hsla(${200 + vals[i] * 60},90%,${50 + vals[i] * 25}%,.9)`;
            ctx.lineWidth = Math.max(2, (TAU * R) / N * 0.55);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(Math.cos(ang) * (R + 6), Math.sin(ang) * (R + 6));
            ctx.lineTo(Math.cos(ang) * (R + 6 + len), Math.sin(ang) * (R + 6 + len));
            ctx.stroke();
          }
          ctx.restore();
          // album art in the middle
          ctx.save();
          ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip();
          if (meta.art && meta.art.complete && meta.art.naturalWidth) ctx.drawImage(meta.art, cx - R, cy - R, R * 2, R * 2);
          else { ctx.fillStyle = '#0d2233'; ctx.fillRect(cx - R, cy - R, R * 2, R * 2); }
          ctx.restore();
          ctx.strokeStyle = 'rgba(0,143,213,.8)'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(cx, cy, R + 1, 0, TAU); ctx.stroke();
        },
        resize() {}, destroy() {}
      };
    }
  };

  // ================================================================ 11. Particles (fountain of light)
  const particles = {
    id: 'particles', name: 'Particles', group: 'Classic media player',
    create(canvas) {
      const ctx = canvas.getContext('2d');
      const ps = [];
      return {
        frame(a, meta, dt) {
          const { w, h } = fit(canvas);
          ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(0, 0, w, h);
          const rate = 30 + a.level * 220 + (a.beat ? 120 : 0);
          for (let k = 0; k < rate * dt && ps.length < 1600; k++) {
            const ang = -Math.PI / 2 + (Math.random() - 0.5) * (0.6 + a.mid * 0.6);
            const sp = h * (0.55 + Math.random() * 0.35 + a.bass * 0.25);
            ps.push({ x: w / 2 + (Math.random() - 0.5) * w * 0.04, y: h * 0.98, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 1, hue: 190 + Math.random() * 40 + a.treble * 80 });
          }
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          for (let i = ps.length - 1; i >= 0; i--) {
            const p = ps[i];
            p.vy += h * 0.55 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt * 0.45;
            if (p.life <= 0 || p.y > h) { ps.splice(i, 1); continue; }
            ctx.fillStyle = `hsla(${p.hue},90%,65%,${p.life * 0.8})`;
            const r = Math.max(1, h * 0.004 * (0.5 + p.life));
            ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
          }
          ctx.restore();
        },
        resize() {}, destroy() { ps.length = 0; }
      };
    }
  };

  // ================================================================ 12. Circles (orbiting rings)
  const circles = {
    id: 'circles', name: 'Circles', group: 'Classic media player',
    create(canvas) {
      const ctx = canvas.getContext('2d');
      let t = 0;
      return {
        frame(a, meta, dt) {
          const { w, h } = fit(canvas);
          ctx.fillStyle = 'rgba(3,3,8,.2)'; ctx.fillRect(0, 0, w, h);
          t += dt * (0.25 + a.level * 0.2);
          const b = bands(a.freq, 8, a.sampleRate);
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          for (let i = 0; i < 8; i++) {
            const orbit = Math.min(w, h) * (0.08 + i * 0.045);
            const ang = t * (1 + i * 0.13) * (i % 2 ? -1 : 1) + i;
            const x = w / 2 + Math.cos(ang) * orbit * 1.4, y = h / 2 + Math.sin(ang) * orbit;
            const r = Math.min(w, h) * (0.03 + b[i] * 0.09);
            ctx.strokeStyle = `hsla(${(i * 40 + t * 20) % 360},90%,60%,.7)`;
            ctx.lineWidth = Math.max(1.5, h * 0.004);
            ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
          }
          ctx.restore();
        },
        resize() {}, destroy() {}
      };
    }
  };

  // ================================================================ 13. Tunnel (warp through rings of light)
  const TUNNEL_FRAG = `precision highp float;
    uniform vec2 uRes; uniform float uTime, uBass, uLevel; uniform vec3 uCol;
    void main(){
      vec2 uv=(gl_FragCoord.xy-.5*uRes)/uRes.y;
      float r=length(uv), a=atan(uv.y,uv.x);
      float z=0.35/max(r,0.001)+uTime*0.6;
      float rings=smoothstep(0.82,1.0,abs(sin(z*3.14159)))*(0.5+uLevel*0.6);
      float spokes=smoothstep(0.92,1.0,abs(sin(a*8.0+uTime*0.2)))*0.35;
      vec3 c=uCol*(rings+spokes)*smoothstep(0.0,0.35,r)*(1.0+uBass*0.3);
      c+=uCol*0.08/max(r,0.08)*0.15;
      gl_FragColor=vec4(c,1.0);
    }`;
  const tunnel = {
    id: 'tunnel', name: 'Tunnel', group: 'Party',
    create(canvas) {
      const s = glScene(canvas, TUNNEL_FRAG);
      let t = 0, bass = 0, lvl = 0;
      return {
        frame(a, meta, dt) {
          if (!s) return;
          t += dt * (0.6 + lvl * 0.5);
          bass += (a.bass - bass) * 0.08; lvl += (a.level - lvl) * 0.08;
          const col = meta.tint ? meta.tint.map((v) => Math.min(1, v / 255 * 1.8 + 0.1)) : [0.1, 0.6, 0.95];
          s.draw({ uTime: t, uBass: bass, uLevel: lvl, uCol: col }, 0.8);
        },
        resize() {}, destroy() { s && s.destroy(); }
      };
    }
  };

  // ================================================================ 14. Starfield
  const starfield = {
    id: 'starfield', name: 'Starfield', group: 'Retro',
    create(canvas) {
      const ctx = canvas.getContext('2d');
      const stars = Array.from({ length: 700 }, () => ({ x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2, z: Math.random() }));
      return {
        frame(a, meta, dt) {
          const { w, h } = fit(canvas);
          ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(0, 0, w, h);
          const speed = 0.12 + a.level * 0.35;
          for (const s of stars) {
            const pz = s.z;
            s.z -= dt * speed;
            if (s.z <= 0.02) { s.x = (Math.random() - 0.5) * 2; s.y = (Math.random() - 0.5) * 2; s.z = 1; continue; }
            const k = Math.min(w, h) * 0.5;
            const x = w / 2 + (s.x / s.z) * k, y = h / 2 + (s.y / s.z) * k;
            const px = w / 2 + (s.x / pz) * k, py = h / 2 + (s.y / pz) * k;
            const b = Math.min(1, (1 - s.z) * 1.4);
            ctx.strokeStyle = `rgba(${200 + b * 55},${215 + b * 40},255,${b})`;
            ctx.lineWidth = Math.max(1, (1 - s.z) * 2.5);
            ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke();
          }
        },
        resize() {}, destroy() {}
      };
    }
  };

  // ================================================================ 15. Color Wash (slow plasma, "musical colors" style)
  const PLASMA_FRAG = `precision highp float;
    uniform vec2 uRes; uniform float uTime, uLevel;
    void main(){
      vec2 uv=gl_FragCoord.xy/uRes.y;
      float t=uTime*0.15;
      float v=sin(uv.x*3.0+t)+sin(uv.y*2.6-t*1.3)+sin((uv.x+uv.y)*2.2+t*0.7)+sin(length(uv-vec2(0.9,0.5))*4.0-t);
      vec3 c=0.5+0.5*cos(vec3(0.0,2.1,4.2)+v*1.1+t);
      c=mix(c,vec3(0.0,0.56,0.84),0.25);
      gl_FragColor=vec4(c*(0.45+uLevel*0.5),1.0);
    }`;
  const colorwash = {
    id: 'colorwash', name: 'Color Wash', group: 'Classic media player',
    create(canvas) {
      const s = glScene(canvas, PLASMA_FRAG);
      let t = 0, lvl = 0;
      return {
        frame(a, meta, dt) { if (!s) return; t += dt; lvl += (a.level - lvl) * 0.05; s.draw({ uTime: t, uLevel: lvl }, 0.5); },
        resize() {}, destroy() { s && s.destroy(); }
      };
    }
  };

  // ================================================================ 16. Kaleidoscope (the album art, mirrored)
  const kaleido = {
    id: 'kaleidoscope', name: 'Kaleidoscope', group: 'Party',
    create(canvas) {
      const ctx = canvas.getContext('2d');
      let rot = 0;
      return {
        frame(a, meta, dt) {
          const { w, h } = fit(canvas);
          ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
          rot += dt * (0.05 + a.level * 0.06);
          const art = meta.art && meta.art.complete && meta.art.naturalWidth ? meta.art : null;
          if (!art) return;
          const R = Math.hypot(w, h) / 2, seg = 12, size = Math.min(art.naturalWidth, art.naturalHeight);
          const zoom = 1 + a.bass * 0.04;
          ctx.save(); ctx.translate(w / 2, h / 2);
          for (let i = 0; i < seg; i++) {
            ctx.save();
            ctx.rotate((i * TAU) / seg);
            if (i % 2) ctx.scale(1, -1);
            ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, 0, TAU / seg + 0.01); ctx.closePath(); ctx.clip();
            ctx.rotate(rot);
            ctx.drawImage(art, 0, 0, size, size, -R * 0.2 * zoom, -R * 0.2 * zoom, R * 1.1 * zoom, R * 1.1 * zoom);
            ctx.restore();
          }
          ctx.restore();
          const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, R);
          v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.65)');
          ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
        },
        resize() {}, destroy() {}
      };
    }
  };

  // ================================================================ 17. Aurora (northern-lights curtains)
  const AURORA_FRAG = `precision highp float;
    uniform vec2 uRes; uniform float uTime, uBass, uMid, uTreble;
    ${NOISE}
    void main(){
      vec2 uv=gl_FragCoord.xy/uRes.xy; float ar=uRes.x/uRes.y;
      vec3 sky=mix(vec3(0.01,0.02,0.06),vec3(0.02,0.06,0.12),uv.y);
      vec3 col=sky;
      for(int i=0;i<3;i++){
        float fi=float(i);
        float x=uv.x*ar*(1.2+fi*0.4)+uTime*(0.03+fi*0.015);
        float band=0.55+fi*0.1+0.12*sin(x*1.7+fi*2.0+uTime*0.2)+0.08*fbm(vec3(x*1.3,fi,uTime*0.05));
        float d=uv.y-band;
        float curtain=smoothstep(0.35+uMid*0.15,0.0,d)*smoothstep(-0.03,0.02,d);
        float rays=0.55+0.45*noise(vec3(x*14.0,uv.y*2.0,uTime*0.25+fi));
        vec3 c=mix(vec3(0.1,1.0,0.55),vec3(0.35,0.4,1.0),fi*0.5+uv.y*0.3);
        col+=c*curtain*rays*(0.35+uBass*0.5)*(0.7-fi*0.15);
      }
      float stars=step(0.997,hash(vec3(floor(gl_FragCoord.xy*0.5),1.0)))*(0.5+0.5*sin(uTime*2.0+gl_FragCoord.x));
      col+=stars*0.6*(1.0-smoothstep(0.4,0.9,col.g));
      float ground=smoothstep(0.13,0.1,uv.y+0.02*sin(uv.x*9.0)+0.015*sin(uv.x*23.0));
      col=mix(col,vec3(0.0,0.005,0.01),ground);
      gl_FragColor=vec4(col,1.0);
    }`;
  const aurora = {
    id: 'aurora', name: 'Aurora', group: 'Nature',
    create(canvas) {
      const s = glScene(canvas, AURORA_FRAG);
      let t = 0; const sm = { b: 0, m: 0, tr: 0 };
      return {
        frame(a, meta, dt) {
          if (!s) return;
          t += dt * (0.6 + a.level * 0.6);
          sm.b += (a.bass - sm.b) * 0.05; sm.m += (a.mid - sm.m) * 0.05; sm.tr += (a.treble - sm.tr) * 0.05;
          s.draw({ uTime: t, uBass: sm.b, uMid: sm.m, uTreble: sm.tr }, 0.6);
        },
        resize() {}, destroy() { s && s.destroy(); }
      };
    }
  };

  // ================================================================ 18. Neon Highway (synthwave terrain made of the spectrum)
  const highway = {
    id: 'highway', name: 'Neon Highway', group: 'Retro',
    create(canvas) {
      const ctx = canvas.getContext('2d');
      const rows = []; let scroll = 0, acc = 0;
      return {
        frame(a, meta, dt) {
          const { w, h } = fit(canvas);
          const b = bands(a.freq, 48, a.sampleRate);
          acc += dt;
          if (acc > 0.07 || !rows.length) { acc = 0; rows.unshift(Array.from(b)); if (rows.length > 34) rows.pop(); }
          scroll = (scroll + dt * (0.6 + a.bass)) % 1;
          const hor = h * 0.46;
          const sky = ctx.createLinearGradient(0, 0, 0, hor);
          sky.addColorStop(0, '#07021a'); sky.addColorStop(0.7, '#2a0a4a'); sky.addColorStop(1, '#ff2a8a');
          ctx.fillStyle = sky; ctx.fillRect(0, 0, w, hor);
          ctx.fillStyle = '#07010f'; ctx.fillRect(0, hor, w, h - hor);
          // the sun, sliced
          const r = h * (0.17 + a.bass * 0.015), cx = w / 2, cy = hor - r * 0.35;
          const sun = ctx.createLinearGradient(0, cy - r, 0, cy + r);
          sun.addColorStop(0, '#ffe36e'); sun.addColorStop(1, '#ff2f8f');
          ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.clip();
          ctx.fillStyle = sun; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
          ctx.fillStyle = '#2a0a4a';
          for (let i = 0; i < 6; i++) { const y = cy + r * (0.1 + i * 0.16); ctx.fillRect(cx - r, y, r * 2, 2 + i * 1.6); }
          ctx.restore();
          // terrain rows, far to near
          const proj = (z) => hor + (h - hor) * Math.pow(z, 2.2);
          for (let ri = rows.length - 1; ri >= 0; ri--) {
            const z = Math.min(1, (ri + scroll) / rows.length);
            const zz = 1 - z;
            const y0 = proj(zz);
            const spread = w * (0.25 + zz * 2.1);
            const row = rows[ri];
            ctx.beginPath();
            for (let i = 0; i <= 48; i++) {
              const u = i / 48, side = Math.abs(u - 0.5) * 2;
              const v = row[Math.min(47, Math.floor(side * 47))] * Math.pow(side, 1.4);
              const x = cx + (u - 0.5) * spread;
              const y = y0 - v * h * 0.22 * zz;
              i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
            }
            ctx.strokeStyle = `rgba(${Math.round(80 + 175 * zz)},${Math.round(60 + 40 * zz)},255,${0.25 + zz * 0.75})`;
            ctx.lineWidth = 1 + zz * 2; ctx.shadowColor = '#c04bff'; ctx.shadowBlur = 8 * zz;
            ctx.stroke();
          }
          ctx.shadowBlur = 0;
          // road lines toward the horizon
          ctx.strokeStyle = 'rgba(0,200,255,.45)'; ctx.lineWidth = 1.5;
          for (let i = -6; i <= 6; i++) { ctx.beginPath(); ctx.moveTo(cx + i * w * 0.012, hor); ctx.lineTo(cx + i * w * 0.2, h); ctx.stroke(); }
        },
        resize() {}, destroy() {}
      };
    }
  };

  // ================================================================ 19. Hi-Fi (a 90s stereo rack: VU needles + LED ladders)
  const hifi = {
    id: 'hifi', name: 'Hi-Fi Rack', group: 'Retro',
    create(canvas) {
      const ctx = canvas.getContext('2d');
      const needle = [0, 0]; const peak = new Float32Array(20); const hold = new Float32Array(20);
      return {
        frame(a, meta, dt) {
          const { w, h } = fit(canvas);
          const g = ctx.createLinearGradient(0, 0, 0, h);
          g.addColorStop(0, '#26272b'); g.addColorStop(1, '#0e0e10');
          ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
          // brushed lines
          ctx.fillStyle = 'rgba(255,255,255,.015)';
          for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
          const pw = Math.min(w * 0.38, h * 0.62), ph = pw * 0.62, gap = pw * 0.08;
          const left = w / 2 - pw - gap / 2, top = h * 0.12;
          const lv = [a.bass * 0.7 + a.mid * 0.5, a.mid * 0.6 + a.treble * 0.6];
          [0, 1].forEach((k) => {
            needle[k] += (Math.min(1.1, lv[k] * 1.2) - needle[k]) * (lv[k] > needle[k] ? 0.25 : 0.06);
            const x = left + k * (pw + gap), y = top;
            const face = ctx.createLinearGradient(0, y, 0, y + ph);
            face.addColorStop(0, '#ffe7b0'); face.addColorStop(1, '#f2c46a');
            ctx.fillStyle = '#000'; ctx.fillRect(x - 6, y - 6, pw + 12, ph + 12);
            ctx.fillStyle = face; ctx.fillRect(x, y, pw, ph);
            const cx = x + pw / 2, cy = y + ph * 1.05, R = ph * 0.85;
            ctx.strokeStyle = '#3a2a10'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, R, -2.3, -0.84); ctx.stroke();
            ctx.strokeStyle = '#c0261b'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(cx, cy, R, -1.15, -0.84); ctx.stroke();
            ctx.fillStyle = '#3a2a10'; ctx.font = `${Math.round(ph * 0.07)}px Poppins, sans-serif`; ctx.textAlign = 'center';
            ['-20', '-10', '-5', '0', '+3'].forEach((lab, i) => { const an = -2.3 + i * 0.365; ctx.fillText(lab, cx + Math.cos(an) * (R + ph * 0.08), cy + Math.sin(an) * (R + ph * 0.08)); });
            ctx.font = `700 ${Math.round(ph * 0.09)}px Poppins, sans-serif`; ctx.fillText('VU', cx, y + ph * 0.75);
            const an = -2.3 + needle[k] * 1.46;
            ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(an) * R * 1.02, cy + Math.sin(an) * R * 1.02); ctx.stroke();
            ctx.fillStyle = 'rgba(255,190,80,.18)'; ctx.fillRect(x, y, pw, ph);  // backlight
            ctx.fillStyle = '#fff'; ctx.font = `${Math.round(ph * 0.06)}px Poppins, sans-serif`; ctx.fillText(k ? 'RIGHT' : 'LEFT', cx, y + ph + 26);
          });
          // LED ladders
          const b = bands(a.freq, 20, a.sampleRate);
          const lx = left, ly = top + ph + 60, lw = pw * 2 + gap, lh = h - ly - h * 0.08;
          const cw = lw / 20, segs = 16, sh = lh / segs;
          for (let i = 0; i < 20; i++) {
            const v = Math.min(1, b[i] * 1.1);
            peak[i] += (v - peak[i]) * (v > peak[i] ? 0.5 : 0.12);
            if (peak[i] > hold[i]) hold[i] = peak[i]; else hold[i] = Math.max(0, hold[i] - dt * 0.35);
            const lit = Math.round(peak[i] * segs), hk = Math.min(segs - 1, Math.round(hold[i] * segs));
            for (let s = 0; s < segs; s++) {
              const on = s < lit || s === hk;
              const col = s > segs * 0.82 ? '255,60,40' : s > segs * 0.62 ? '255,200,40' : '40,230,120';
              ctx.fillStyle = `rgba(${col},${on ? 0.95 : 0.08})`;
              ctx.fillRect(lx + i * cw + 2, ly + lh - (s + 1) * sh + 2, cw - 4, sh - 3);
            }
          }
        },
        resize() {}, destroy() {}
      };
    }
  };

  // ================================================================ 20. Lissajous (the waveform plotted against itself)
  const lissajous = {
    id: 'lissajous', name: 'Lissajous', group: 'Classic media player',
    create(canvas) {
      const ctx = canvas.getContext('2d');
      let hue = 190, rot = 0;
      return {
        frame(a, meta, dt) {
          const { w, h } = fit(canvas);
          ctx.fillStyle = 'rgba(0,0,0,.16)'; ctx.fillRect(0, 0, w, h);
          hue = (hue + dt * 6) % 360; rot += dt * 0.08;
          const n = a.wave.length, lag = 37, R = Math.min(w, h) * (0.36 + a.bass * 0.04);
          ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(rot);
          ctx.beginPath();
          for (let i = 0; i < n - lag; i += 2) {
            const x = ((a.wave[i] - 128) / 128) * R * 1.6, y = ((a.wave[i + lag] - 128) / 128) * R * 1.6;
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          ctx.strokeStyle = `hsla(${hue},95%,65%,.85)`; ctx.lineWidth = Math.max(1.2, h * 0.0025);
          ctx.shadowColor = `hsl(${hue},95%,60%)`; ctx.shadowBlur = h * 0.02;
          ctx.stroke(); ctx.restore(); ctx.shadowBlur = 0;
        },
        resize() {}, destroy() {}
      };
    }
  };

  // ================================================================ 21. Turntable (top-down, the record turning under the arm)
  const turntable = {
    id: 'turntable', name: 'Turntable', group: 'Album art',
    create(canvas) {
      const ctx = canvas.getContext('2d');
      let ang = 0;
      return {
        frame(a, meta, dt) {
          const { w, h } = fit(canvas);
          ctx.fillStyle = '#121212'; ctx.fillRect(0, 0, w, h);
          const R = Math.min(w, h) * 0.42, cx = w / 2 - R * 0.12, cy = h / 2;
          // plinth
          ctx.fillStyle = '#1c1b1a'; ctx.beginPath(); ctx.roundRect(cx - R * 1.18, cy - R * 1.12, R * 2.75, R * 2.24, R * 0.06); ctx.fill();
          ctx.fillStyle = '#2a2a2b'; ctx.beginPath(); ctx.arc(cx, cy, R * 1.04, 0, TAU); ctx.fill();
          if (meta.playing) ang += dt * TAU * (33.3 / 60);
          ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang);
          ctx.fillStyle = '#0a0a0a'; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
          // grooves lit by the spectrum
          const b = bands(a.freq, 40, a.sampleRate);
          for (let i = 0; i < 40; i++) {
            const r = R * (0.38 + (i / 40) * 0.6);
            ctx.strokeStyle = `rgba(${meta.tint ? meta.tint.join(',') : '0,143,213'},${0.05 + b[39 - i] * 0.35})`;
            ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
          }
          const sheen = ctx.createConicGradient ? ctx.createConicGradient(0, 0, 0) : null;
          if (sheen) { sheen.addColorStop(0, 'rgba(255,255,255,0)'); sheen.addColorStop(0.12, 'rgba(255,255,255,.09)'); sheen.addColorStop(0.25, 'rgba(255,255,255,0)'); sheen.addColorStop(0.62, 'rgba(255,255,255,.07)'); sheen.addColorStop(0.75, 'rgba(255,255,255,0)'); ctx.rotate(-ang); ctx.fillStyle = sheen; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill(); ctx.rotate(ang); }
          const art = meta.art && meta.art.complete && meta.art.naturalWidth ? meta.art : null;
          ctx.save(); ctx.beginPath(); ctx.arc(0, 0, R * 0.34, 0, TAU); ctx.clip();
          if (art) ctx.drawImage(art, -R * 0.34, -R * 0.34, R * 0.68, R * 0.68); else { ctx.fillStyle = '#008fd5'; ctx.fill(); }
          ctx.restore();
          ctx.fillStyle = '#ddd'; ctx.beginPath(); ctx.arc(0, 0, R * 0.02, 0, TAU); ctx.fill();
          ctx.restore();
          // tonearm, tracking with progress
          const px = cx + R * 1.25, py = cy - R * 0.85;
          const tip = -0.2 + 0.32 * (meta.progress || 0);
          const armA = Math.PI * 0.62 + tip;
          ctx.fillStyle = '#3b3b3d'; ctx.beginPath(); ctx.arc(px, py, R * 0.12, 0, TAU); ctx.fill();
          ctx.strokeStyle = '#c9c9cc'; ctx.lineWidth = R * 0.03; ctx.lineCap = 'round';
          const ex = px + Math.cos(armA) * R * 1.35, ey = py + Math.sin(armA) * R * 1.35;
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ex, ey); ctx.stroke();
          ctx.fillStyle = '#e5e5e7'; ctx.save(); ctx.translate(ex, ey); ctx.rotate(armA); ctx.fillRect(-R * 0.02, -R * 0.05, R * 0.14, R * 0.1); ctx.restore();
          ctx.lineCap = 'butt';
        },
        resize() {}, destroy() {}
      };
    }
  };

  // ================================================================ 22. Album Glow (the cover, breathing with the music)
  const albumglow = {
    id: 'albumglow', name: 'Album Glow', group: 'Album art',
    create(canvas) {
      const ctx = canvas.getContext('2d');
      const rings = []; let t = 0, pulse = 0;
      return {
        frame(a, meta, dt) {
          const { w, h } = fit(canvas);
          t += dt;
          const art = meta.art && meta.art.complete && meta.art.naturalWidth ? meta.art : null;
          const S = Math.min(w, h) * 0.46;
          ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
          if (art) { ctx.save(); ctx.filter = 'blur(60px) saturate(1.4)'; ctx.globalAlpha = 0.55; ctx.drawImage(art, -w * 0.1, -h * 0.1, w * 1.2, h * 1.2); ctx.restore(); }
          if (a.beat) rings.push({ r: S * 0.55, a: 0.6 });
          pulse += ((a.bass * 0.06) - pulse) * 0.2;
          const tint = meta.tint ? meta.tint.join(',') : '0,143,213';
          for (const r of rings) { r.r += dt * S * 0.9; r.a -= dt * 0.5; ctx.strokeStyle = `rgba(${tint},${Math.max(0, r.a)})`; ctx.lineWidth = 3; ctx.strokeRect(w / 2 - r.r, h / 2 - r.r, r.r * 2, r.r * 2); }
          while (rings.length && rings[0].a <= 0) rings.shift();
          const s = S * (1 + pulse);
          ctx.save(); ctx.shadowColor = `rgba(${tint},.8)`; ctx.shadowBlur = 40 + a.level * 60;
          if (art) ctx.drawImage(art, w / 2 - s / 2, h / 2 - s / 2 - h * 0.03, s, s);
          else { ctx.fillStyle = '#0d0d0d'; ctx.fillRect(w / 2 - s / 2, h / 2 - s / 2, s, s); }
          ctx.restore();
          // reflection
          if (art) { ctx.save(); ctx.globalAlpha = 0.18; ctx.translate(0, h / 2 + s / 2 - h * 0.03 + s / 2 + 6); ctx.scale(1, -1); ctx.drawImage(art, w / 2 - s / 2, -s / 2, s, s * 0.35); ctx.restore(); }
        },
        resize() {}, destroy() {}
      };
    }
  };

  // ================================================================ 23. Ridgeline (recent spectra stacked like mountain ridges)
  const ridgeline = {
    id: 'ridgeline', name: 'Ridgeline', group: 'Classic media player',
    create(canvas) {
      const ctx = canvas.getContext('2d');
      const hist = []; let acc = 0;
      return {
        frame(a, meta, dt) {
          const { w, h } = fit(canvas);
          acc += dt;
          if (acc > 0.09 || !hist.length) { acc = 0; hist.unshift(Array.from(bands(a.freq, 64, a.sampleRate))); if (hist.length > 42) hist.pop(); }
          ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
          const left = w * 0.18, right = w * 0.82, top = h * 0.16, step = (h * 0.7) / 42;
          for (let k = hist.length - 1; k >= 0; k--) {
            const row = hist[k], y0 = top + (42 - k) * step;
            ctx.beginPath(); ctx.moveTo(left, y0);
            for (let i = 0; i < 64; i++) {
              const u = i / 63, x = left + u * (right - left);
              const env = Math.sin(Math.PI * u);
              ctx.lineTo(x, y0 - row[i] * env * h * 0.16);
            }
            ctx.lineTo(right, y0);
            ctx.fillStyle = '#000'; ctx.fill();
            ctx.strokeStyle = k === 0 ? '#19a7ef' : `rgba(255,255,255,${0.35 + (1 - k / 42) * 0.6})`;
            ctx.lineWidth = k === 0 ? 2 : 1.2; ctx.stroke();
          }
        },
        resize() {}, destroy() {}
      };
    }
  };

  // ================================================================ 24. Fireworks (bursts on the beat)
  const fireworks = {
    id: 'fireworks', name: 'Fireworks', group: 'Party',
    create(canvas) {
      const ctx = canvas.getContext('2d');
      const parts = []; let quiet = 2.3;
      const burst = (w, h, power) => {
        const x = w * (0.15 + Math.random() * 0.7), y = h * (0.15 + Math.random() * 0.4), hue = Math.random() * 360, n = 60 + Math.round(power * 80);
        for (let i = 0; i < n; i++) { const an = Math.random() * TAU, sp = (0.3 + Math.random()) * Math.min(w, h) * 0.32 * (0.6 + power * 0.6); parts.push({ x, y, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp, life: 1, hue: hue + Math.random() * 30 }); }
      };
      return {
        frame(a, meta, dt) {
          const { w, h } = fit(canvas);
          ctx.fillStyle = 'rgba(2,3,10,.22)'; ctx.fillRect(0, 0, w, h);
          quiet += dt;
          if (a.beat || (meta.playing && quiet > 2.4)) { burst(w, h, a.bass); quiet = 0; }
          ctx.globalCompositeOperation = 'lighter';
          for (const p of parts) {
            p.vx *= 1 - dt * 1.4; p.vy = p.vy * (1 - dt * 1.4) + dt * h * 0.18;
            p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt * 0.55;
            ctx.fillStyle = `hsla(${p.hue},95%,65%,${Math.max(0, p.life)})`;
            ctx.fillRect(p.x, p.y, 2.2, 2.2);
          }
          ctx.globalCompositeOperation = 'source-over';
          for (let i = parts.length - 1; i >= 0; i--) if (parts[i].life <= 0) parts.splice(i, 1);
        },
        resize() {}, destroy() {}
      };
    }
  };

  window.Visualizers = [spectrum, scope, lissajous, ridgeline, mist, inferno, spikes, particles, circles, colorwash, swirl, aurora, earth, albumglow, turntable, kaleido, disco, tunnel, fireworks, cassette, hifi, highway, starfield];
  window.SpectrumThemes = SPECTRUM_THEMES;
})();
