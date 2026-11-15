// Tiny JSON persistence for settings and library (no dependencies).
const { app } = require('electron');
const PRODUCT = require('../product.json');
const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  skin: PRODUCT.skins[0],     // rdio | zune (set by the app)
  themes: { rdio: 'midnight', zune: 'dark', wmp: 'onyx' },   // the chosen theme for each skin
  eveningTone: 'both',       // purple | amber | both  (Rdio evening)
  zuneColor: 'pink',         // accent for the Zune skin
  nowPlayingMedia: 'vinyl',  // vinyl | cd | cassette
  cdFace: 'art',             // art | data
  earthVideo: '',            // your own video for the Earth visualizer (a file path), or '' for the built-in one
  lightLine: false,          // Light theme: Rdio-blue line under the title bar (off by default)
  cassetteMode: 'case',      // case (out of its case, back in when paused) | solo
  npTilt: false,
  spectrumTheme: 'rdio',
  visualizer: 'spectrum',
  playerLayout: 'sidebar',   // sidebar | bar | both
  closeToTray: true,
  volume: 0.8,
  onlineArt: true,           // upgrade small / missing covers from online sources
  artCAA: true,              // MusicBrainz Cover Art Archive
  artITunes: true,           // Apple's catalogue artwork
  discogsToken: '',          // personal Discogs token (optional)
  minArtSize: 1000,          // covers smaller than this get an online upgrade
  askedMusicFolder: false,
  window: { width: 1240, height: 800 },
  widget: {
    open: !!PRODUCT.pocketOnly,
    mode: PRODUCT.pocketOnly ? 'touch' : 'bar',             // bar | card | square | touch | pad | wheel
    onTop: true,
    showQueue: false,
    locked: false,
    squareSize: 220,
    deviceScale: 1,
    touch: { lock: true, lockAfter: 120, wall: 'ribbons', wallFile: '', clock24: false, viz: 'spectrum', radioUi: 'hd', jumpStyle: 'outline', jumpCase: 'lower', glare: false },
    deviceColors: { touch: 'black', pad: 'brown', wheel: 'blue' },
    pos: {}
  }
};

const DEFAULT_LIBRARY = { recent: [], plays: {}, trackPlays: {}, playlists: [], session: null };

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function merge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
  }
  return out;
}

class JsonFile {
  constructor(name, defaults) {
    this.file = path.join(app.getPath('userData'), name);
    this.defaults = defaults;
    this.timer = null;
    try { this.data = merge(defaults, JSON.parse(fs.readFileSync(this.file, 'utf8'))); }
    catch { this.data = merge(defaults, {}); }
  }
  get() { return this.data; }
  patch(p) { this.data = merge(this.data, p); this.save(); return this.data; }
  replace(d) { this.data = merge(this.defaults, d); this.save(); return this.data; }
  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 300);
  }
  flush() {
    clearTimeout(this.timer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (e) { console.error('save failed', this.file, e); }
  }
}

let settings, library;
module.exports = {
  init() {
    settings = new JsonFile('settings.json', DEFAULT_SETTINGS);
    library = new JsonFile('user.json', DEFAULT_LIBRARY);
  },
  settings: () => settings.get(),
  patchSettings: (p) => settings.patch(p),
  library: () => library.get(),
  saveLibrary: (d) => library.replace(d),
  flush() { settings && settings.flush(); library && library.flush(); }
};
