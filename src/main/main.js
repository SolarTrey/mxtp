const {
  app, BrowserWindow, ipcMain, protocol, Menu, Tray, nativeImage, shell, screen, clipboard, dialog
} = require('electron');
const path = require('path');
const fs = require('fs');
const PRODUCT = require('../product.json');
// Zudio HD: the pocket player is the whole app; the main window stays hidden and just plays the music
const POCKET = !!PRODUCT.pocketOnly;
const store = require('./store');
const { Library, AUDIO_EXT } = require('./library');
const { ArtManager } = require('./art');
const { makeHandler } = require('./media');
const radio = require('./radio');

const ROOT = path.join(__dirname, '..', '..');
const ICON = path.join(ROOT, 'assets', 'icon.png');
const TITLEBAR_H = 52;

// Native window-button colours per skin + theme.
const CHROME = {
  'rdio:light':      { titlebar: '#f1f3f5', symbol: '#55606a', bg: '#ffffff' },
  'rdio:evening':    { titlebar: '#251c3b', symbol: '#d6cce6', bg: '#1e1730' },
  'rdio:evening-amber': { titlebar: '#261d13', symbol: '#e6d4bb', bg: '#1c1610' },
  'rdio:midnight':   { titlebar: '#000000', symbol: '#9aa0a6', bg: '#000000' },
  'zune:light':      { titlebar: '#f4f4f4', symbol: '#6b6b6b', bg: '#f4f4f4' },
  'zune:dark':       { titlebar: '#121212', symbol: '#9a9a9a', bg: '#121212' },
  'wmp:onyx':        { titlebar: '#0b0f16', symbol: '#c8d4e4', bg: '#05070b' },
  'wmp:azure':       { titlebar: '#1f4f96', symbol: '#e8f1ff', bg: '#dfe9f6' }
};
const ALL_SKIN_THEMES = { rdio: ['light', 'evening', 'midnight'], zune: ['dark', 'light'], wmp: ['onyx', 'azure'] };
// only the skins this app ships with
const SKIN_THEMES = Object.fromEntries(PRODUCT.skins.map((k) => [k, ALL_SKIN_THEMES[k]]));

const WIDGET_PAD = 12;
// content sizes of each mini player style (the window adds a transparent margin for the shadow)
const WIDGET_SIZES = {
  bar: { w: 400, h: 84 }, card: { w: 236, h: 430 },
  touch: { w: 298, h: 576 }, pad: { w: 214, h: 376 }, wheel: { w: 214, h: 362 },
  cdplayer: { w: 304, h: 206 }, vinyl: { w: 328, h: 232 }, cassette: { w: 320, h: 356 }
};

let mainWin = null;
let widgetWin = null;
let tray = null;
let quitting = false;
let lastState = null;
let library = null;
let art = null;
let pendingOpen = [];

protocol.registerSchemesAsPrivileged([{
  scheme: 'media',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: false }
}]);

app.setAppUserModelId(`com.${PRODUCT.id}.player`);
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_e, argv) => {
  showMain();
  const files = filesFromArgv(argv);
  if (files.length) openPaths(files, true, true);
});

function filesFromArgv(argv) {
  return argv.slice(1).filter((a) => !a.startsWith('-') && a !== '.' && path.isAbsolute(a)).filter((a) => {
    try { const st = fs.statSync(a); return st.isDirectory() || AUDIO_EXT.has(path.extname(a).slice(1).toLowerCase()); } catch { return false; }
  });
}

// ---------------------------------------------------------------- windows
function chrome() {
  const s = store.settings();
  const skin = SKIN_THEMES[s.skin] ? s.skin : PRODUCT.skins[0];
  let theme = s.themes && s.themes[skin];
  if (skin === 'rdio' && theme === 'evening' && s.eveningTone === 'amber') theme = 'evening-amber';
  return CHROME[`${skin}:${theme}`] || CHROME[`${skin}:${SKIN_THEMES[skin][0]}`];
}

// Hover over the app in the Windows taskbar: previous, play/pause, next and like buttons under the preview.
function updateThumbar(state) {
  if (process.platform !== 'win32' || !mainWin || mainWin.isDestroyed() || POCKET) return;
  const img = (n) => nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'thumbar', n + '.png'));
  const send = (cmd) => () => mainWin && mainWin.webContents.send('player:command', cmd);
  const flags = state && state.track ? [] : ['disabled'];
  try {
    mainWin.setThumbarButtons([
      { tooltip: 'Previous', icon: img('prev'), click: send('prev'), flags },
      { tooltip: state && state.playing ? 'Pause' : 'Play', icon: img(state && state.playing ? 'pause' : 'play'), click: send('toggle'), flags },
      { tooltip: 'Next', icon: img('next'), click: send('next'), flags },
      { tooltip: state && state.liked ? 'Unlike' : 'Like', icon: img(state && state.liked ? 'heart' : 'heartOutline'), click: send('love'), flags }
    ]);
  } catch {}
}
function createMain() {
  const s = store.settings();
  const t = chrome();
  mainWin = new BrowserWindow({
    width: s.window.width || 1240,
    height: s.window.height || 800,
    x: s.window.x, y: s.window.y,
    minWidth: 940, minHeight: 620,
    show: false,
    title: PRODUCT.name,
    icon: ICON,
    backgroundColor: t.bg,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: t.titlebar, symbolColor: t.symbol, height: TITLEBAR_H - 2 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  });
  if (s.window.maximized) mainWin.maximize();
  mainWin.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
  if (!POCKET) mainWin.once('ready-to-show', () => { mainWin.show(); updateThumbar(lastState); });

  const saveBounds = debounce(() => {
    if (!mainWin || mainWin.isDestroyed()) return;
    const maximized = mainWin.isMaximized();
    const b = mainWin.getNormalBounds();
    store.patchSettings({ window: { ...b, maximized } });
  }, 400);
  mainWin.on('resize', saveBounds);
  mainWin.on('move', saveBounds);
  mainWin.on('close', (e) => {
    if (!quitting && (POCKET || store.settings().closeToTray)) { e.preventDefault(); mainWin.hide(); }
  });
  mainWin.on('closed', () => { mainWin = null; if (!quitting) app.quit(); });
  mainWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  // dropping a file on the window shouldn't navigate away from the app
  mainWin.webContents.on('will-navigate', (e) => e.preventDefault());
}

function showMain(route) {
  if (POCKET) { if (!widgetWin) createWidget(); else { widgetWin.show(); widgetWin.focus(); } return; }
  if (!mainWin) return;
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
  if (typeof route === 'string') mainWin.webContents.send('app:navigate', route);
}

// ---------------------------------------------------------------- widget (mini player)
function widgetSize(w) {
  if (w.mode === 'square') {
    const s = clamp(w.squareSize || 220, 100, 600);
    return { width: s + WIDGET_PAD * 2, height: s + WIDGET_PAD * 2 };
  }
  const z = WIDGET_SIZES[w.mode] || WIDGET_SIZES.bar;
  const k = ['touch', 'pad', 'wheel'].includes(w.mode) ? (w.deviceScale || 1) : 1;
  return { width: Math.round(z.w * k) + WIDGET_PAD * 2, height: Math.round(z.h * k) + WIDGET_PAD * 2 };
}

function widgetPosition(w, size) {
  const saved = w.pos && w.pos[w.mode];
  if (saved && Number.isFinite(saved.x)) {
    const d = screen.getDisplayMatching({ ...saved, ...size }).workArea;
    const onScreen = saved.x < d.x + d.width - 40 && saved.x + size.width > d.x + 40 &&
                     saved.y < d.y + d.height - 40 && saved.y + size.height > d.y;
    if (onScreen) return saved;
  }
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - size.width - 16, y: wa.y + wa.height - size.height - 16 };
}

function createWidget() {
  if (widgetWin) { widgetWin.showInactive(); return; }
  const w = store.settings().widget;
  const size = widgetSize(w);
  const pos = widgetPosition(w, size);
  widgetWin = new BrowserWindow({
    ...size, ...pos,
    frame: false, transparent: true, resizable: false, maximizable: false, minimizable: POCKET, fullscreenable: false,
    skipTaskbar: !POCKET, hasShadow: false, show: false,
    title: `${PRODUCT.name} mini player`,
    icon: ICON,
    backgroundColor: '#00000000',
    alwaysOnTop: !!w.onTop,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false }
  });
  widgetWin.setAlwaysOnTop(!!w.onTop, 'floating');
  widgetWin.setMovable(!w.locked);
  widgetWin.loadFile(path.join(ROOT, 'src', 'renderer', 'widget.html'));
  widgetWin.once('ready-to-show', () => { applyShellIcon(); POCKET ? widgetWin.show() : widgetWin.showInactive(); });
  widgetWin.on('closed', () => { widgetWin = null; if (POCKET && !quitting) { quitting = true; app.quit(); } });
  rebuildTray();
}
function closeWidget() { if (widgetWin) widgetWin.close(); widgetWin = null; rebuildTray(); }
function saveWidgetPos() {
  if (!widgetWin) return;
  const w = store.settings().widget;
  const [x, y] = widgetWin.getPosition();
  store.patchSettings({ widget: { pos: { [w.mode]: { x, y } } } });
}
function applyWidgetSettings(prev) {
  const w = store.settings().widget;
  if (!w.open) { if (POCKET) { quitting = true; app.quit(); return; } closeWidget(); return; }
  if (!widgetWin) { createWidget(); return; }
  widgetWin.setAlwaysOnTop(!!w.onTop, 'floating');
  widgetWin.setMovable(!w.locked);
  if (!prev || prev.mode !== w.mode || prev.squareSize !== w.squareSize || prev.deviceScale !== w.deviceScale) {
    const size = widgetSize(w);
    const pos = prev && prev.mode === w.mode ? anchoredPos(size) : widgetPosition(w, size);
    widgetWin.setBounds({ ...pos, ...size });
  }
}
function anchoredPos(size) {
  const b = widgetWin.getBounds();
  const wa = screen.getDisplayMatching(b).workArea;
  const lower = b.y + b.height / 2 > wa.y + wa.height / 2;
  const right = b.x + b.width / 2 > wa.x + wa.width / 2;
  return { x: right ? b.x + b.width - size.width : b.x, y: lower ? b.y + b.height - size.height : b.y };
}

const SHELL_COLORS = [['black', 'Black'], ['platinum', 'Platinum'], ['blue', 'Blue'], ['red', 'Red'], ['lilac', 'Lilac'], ['purple', 'Purple'], ['lime', 'Lime'], ['slate', 'Slate'], ['rose', 'Red pattern'], ['white', 'White']];
const DEVICE_COLORS = [['black', 'Black'], ['brown', 'Brown'], ['white', 'White'], ['pink', 'Pink'], ['red', 'Red'], ['green', 'Green'], ['blue', 'Blue'], ['platinum', 'Platinum'], ['magenta', 'Magenta'], ['orange', 'Orange']];
function pocketMenu() {
  const w = store.settings().widget;
  return Menu.buildFromTemplate([
    { label: lastState && lastState.track ? `${lastState.track.title} — ${lastState.track.artist}` : 'Nothing playing', enabled: false },
    { type: 'separator' },
    { label: 'Always on top', type: 'radio', checked: w.onTop, click: () => setSettings({ widget: { onTop: true } }) },
    { label: 'On the desktop (behind other windows)', type: 'radio', checked: !w.onTop, click: () => setSettings({ widget: { onTop: false } }) },
    { label: 'Lock position', type: 'checkbox', checked: w.locked, click: (i) => setSettings({ widget: { locked: i.checked } }) },
    { label: 'Size', submenu: [['Small', 0.85], ['Normal', 1], ['Large', 1.2]].map(([label, v]) => ({ label, type: 'radio', checked: (w.deviceScale || 1) === v, click: () => setSettings({ widget: { deviceScale: v } }) })) },
    { label: 'Shell', submenu: SHELL_COLORS.map(([v, label]) => ({ label, type: 'radio', checked: (w.deviceColors || {}).touch === v, click: () => setSettings({ widget: { deviceColors: { touch: v } } }) })) },
    { type: 'separator' },
    { label: 'Minimize', click: () => widgetWin && widgetWin.minimize() },
    { label: `Quit ${PRODUCT.name}`, click: () => { quitting = true; app.quit(); } }
  ]);
}
function widgetMenu() {
  if (POCKET) return pocketMenu();
  const s = store.settings();
  const w = s.widget;
  const set = (patch) => setSettings({ widget: patch });
  const sizes = [['Small', 140], ['Medium', 220], ['Large', 300], ['Extra large', 400]];
  const isDevice = ['touch', 'pad', 'wheel'].includes(w.mode);
  const radio = (mode, label) => ({ label, type: 'radio', checked: w.mode === mode, click: () => set({ mode }) });
  return Menu.buildFromTemplate([
    { label: lastState && lastState.track ? `${lastState.track.title} — ${lastState.track.artist}` : 'Nothing playing', enabled: false },
    { type: 'separator' },
    radio('bar', 'Bar'), radio('card', 'Classic'), radio('square', 'Album art square'),
    radio('cdplayer', 'CD Player'), radio('vinyl', 'Vinyl'), radio('cassette', 'Cassette'),
    ...(PRODUCT.devices ? [{ type: 'separator' }, radio('touch', 'Pocket player: Touch'), radio('pad', 'Pocket player: Pad'), radio('wheel', 'Pocket player: Wheel')] : []),
    { label: w.mode === 'touch' ? 'Shell' : 'Device colour', visible: isDevice, submenu: (w.mode === 'touch' ? SHELL_COLORS : DEVICE_COLORS).map(([v, label]) => ({
      label, type: 'radio', checked: (w.deviceColors || {})[w.mode] === v, click: () => set({ deviceColors: { [w.mode]: v } })
    })) },
    { label: 'Device size', visible: isDevice, submenu: [['Small', 0.85], ['Normal', 1], ['Large', 1.2]].map(([label, v]) => ({
      label, type: 'radio', checked: (w.deviceScale || 1) === v, click: () => set({ deviceScale: v })
    })) },
    { label: 'Show queue', type: 'checkbox', checked: w.showQueue, visible: w.mode === 'bar' || w.mode === 'card', click: (i) => set({ showQueue: i.checked }) },
    { label: 'Square size', visible: w.mode === 'square', submenu: sizes.map(([label, v]) => ({ label, type: 'radio', checked: w.squareSize === v, click: () => set({ squareSize: v }) })) },
    { type: 'separator' },
    { label: 'Always on top', type: 'radio', checked: w.onTop, click: () => set({ onTop: true }) },
    { label: 'Desktop widget (stays behind other windows)', type: 'radio', checked: !w.onTop, click: () => set({ onTop: false }) },
    { label: 'Lock position', type: 'checkbox', checked: w.locked, click: (i) => set({ locked: i.checked }) },
    { type: 'separator' },
    ...(PRODUCT.skins.length > 1 ? [{ label: 'Skin', submenu: PRODUCT.skins.map((k) => ({
      label: { rdio: 'Rdio', zune: 'Zune', wmp: 'Media Player' }[k], type: 'radio', checked: s.skin === k, click: () => setSettings({ skin: k })
    })) }] : []),
    { label: 'Theme', submenu: (SKIN_THEMES[s.skin] || Object.values(SKIN_THEMES)[0]).map((t) => ({
      label: t[0].toUpperCase() + t.slice(1), type: 'radio', checked: s.themes[s.skin] === t, click: () => setSettings({ themes: { [s.skin]: t } })
    })) },
    { label: `Open ${PRODUCT.name}`, click: () => showMain() },
    { label: 'Close mini player', click: () => set({ open: false }) }
  ]);
}

// ---------------------------------------------------------------- settings
function setSettings(patch) {
  const prev = store.settings();
  const prevWidget = { ...prev.widget };
  const next = store.patchSettings(patch);
  if ((patch.skin || patch.themes || patch.eveningTone) && mainWin) {
    const t = chrome();
    try { mainWin.setTitleBarOverlay({ color: t.titlebar, symbolColor: t.symbol, height: TITLEBAR_H - 2 }); } catch {}
    mainWin.setBackgroundColor(t.bg);
  }
  if (patch.widget) { applyWidgetSettings(prevWidget); if (patch.widget.deviceColors) applyShellIcon(); }
  if (patch.onlineArt || patch.discogsToken || patch.artITunes || patch.artCAA) art && art.refreshAll();
  broadcast('settings:changed', next);
  rebuildTray();
  return next;
}
function broadcast(channel, ...args) {
  for (const w of [mainWin, widgetWin]) if (w && !w.isDestroyed()) w.webContents.send(channel, ...args);
}

// Zudio HD: the app icon is the device, in whichever shell you picked
function shellIconPaths() {
  const c = (store.settings().widget.deviceColors || {}).touch || 'black';
  const app = path.join(ROOT, 'assets', 'shells', `${c}.png`), tr = path.join(ROOT, 'assets', 'shells', `${c}_tray.png`);
  return fs.existsSync(app) ? { app, tray: tr } : null;
}
function applyShellIcon() {
  if (!POCKET) return;
  const p = shellIconPaths();
  if (!p) return;
  const img = nativeImage.createFromPath(p.app);
  for (const w of [widgetWin, mainWin]) if (w && !w.isDestroyed()) w.setIcon(img);
  if (tray) tray.setImage(nativeImage.createFromPath(p.tray));
}

// ---------------------------------------------------------------- tray
function rebuildTray() {
  if (!tray) return;
  const s = store.settings();
  const t = lastState && lastState.track;
  const send = (cmd) => () => mainWin && mainWin.webContents.send('player:command', cmd);
  tray.setToolTip(t ? `${t.title} — ${t.artist}` : PRODUCT.name);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: t ? `${t.title} — ${t.artist}` : 'Nothing playing', enabled: false },
    { type: 'separator' },
    { label: lastState && lastState.playing ? 'Pause' : 'Play', click: send('toggle') },
    { label: 'Next', click: send('next') },
    { label: 'Previous', click: send('prev') },
    { type: 'separator' },
    { label: `Show ${PRODUCT.name}`, click: () => showMain() },
    ...(POCKET ? [{ label: 'Always on top', type: 'checkbox', checked: !!s.widget.onTop, click: (i) => setSettings({ widget: { onTop: i.checked } }) }] : [{ label: 'Mini player', type: 'checkbox', checked: !!s.widget.open, click: (i) => setSettings({ widget: { open: i.checked } }) },
    { label: 'Mini player always on top', type: 'checkbox', checked: !!s.widget.onTop, click: (i) => setSettings({ widget: { onTop: i.checked } }) }]),
    { type: 'separator' },
    { label: `Quit ${PRODUCT.name}`, click: () => { quitting = true; app.quit(); } }
  ]));
}
function createTray() {
  const img = nativeImage.createFromPath(path.join(ROOT, 'assets', 'tray.png'));
  tray = new Tray(img.isEmpty() ? nativeImage.createFromPath(ICON) : img);
  tray.on('click', () => showMain());
  rebuildTray();
  applyShellIcon();
}

// ---------------------------------------------------------------- library → renderer
function withArt(album) {
  const u = art.urls(album.id);
  return u ? { ...album, art: u.art, artLarge: u.artLarge, artW: u.w, artH: u.h, artSource: u.source } : album;
}
function snapshot() {
  const s = library.snapshot();
  s.albums = s.albums.map(withArt);
  s.artBusy = art.running;
  return s;
}
const pushLibrary = debounce(() => { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('lib:changed', snapshot()); }, 600);

// notify: files opened from Explorer / the command line get sent to the window to play
async function openPaths(paths, play, notify = false) {
  const tracks = await library.openFiles(paths);
  const out = tracks.map((t) => { const a = t.albumId && library.albumById.get(t.albumId); const u = a && art.urls(a.id); return { ...leanTrack(t), art: u ? u.art : null, artLarge: u ? u.artLarge : null }; });
  if (!out.length || !notify) return out;
  if (mainWin && !mainWin.isDestroyed() && mainWin.webContents.isLoading() === false && rendererReady) mainWin.webContents.send('app:openFiles', out, play);
  else pendingOpen.push(...out);
  return out;
}
let rendererReady = false;
function leanTrack(t) {
  return { id: t.id, title: t.title, artist: t.artist, album: t.albumTitle || t.album || '', albumId: t.albumId || null, albumArtist: t.albumArtistResolved || t.artist, track: t.track, disc: t.disc, year: t.year, genre: t.genre, duration: t.duration, codec: t.codecLabel, lossless: t.lossless, sampleRate: t.sampleRate, bits: t.bits, bitrate: t.bitrate, native: t.native, path: t.path, loose: !!t.loose };
}

// ---------------------------------------------------------------- IPC
function registerIpc() {
  ipcMain.on('product', (e) => { e.returnValue = PRODUCT; });
  ipcMain.handle('settings:get', () => store.settings());
  ipcMain.handle('settings:set', (_e, patch) => setSettings(patch));
  ipcMain.handle('user:get', () => store.library());
  ipcMain.handle('user:save', (_e, data) => { store.saveLibrary(data); return true; });

  ipcMain.handle('lib:get', () => snapshot());
  ipcMain.handle('lib:addFolder', async () => {
    const r = await dialog.showOpenDialog(POCKET ? widgetWin : mainWin, { title: 'Add a music folder', properties: ['openDirectory', 'multiSelections'] });
    if (r.canceled) return false;
    for (const p of r.filePaths) library.addRoot(p);
    return true;
  });
  ipcMain.handle('lib:addFolderPath', (_e, p) => library.addRoot(p));
  ipcMain.handle('lib:removeFolder', (_e, p) => { library.removeRoot(p); return true; });
  ipcMain.handle('lib:rescan', () => { library.scan(); return true; });
  ipcMain.handle('lib:openPaths', (_e, paths, play) => openPaths(paths, play));
  ipcMain.handle('lib:pickFiles', async () => {
    const exts = [...AUDIO_EXT];
    const r = await dialog.showOpenDialog(mainWin, { title: 'Open music', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Music', extensions: exts }, { name: 'All files', extensions: ['*'] }] });
    return r.canceled ? [] : openPaths(r.filePaths, true);
  });
  ipcMain.handle('lib:peaks', async (_e, id) => { try { return await library.peaksFor(id); } catch { return null; } });
  ipcMain.on('lib:showItem', (_e, id) => { const t = library.getTrack(id); if (t) shell.showItemInFolder(t.path); });
  ipcMain.handle('app:ready', () => { rendererReady = true; const p = pendingOpen; pendingOpen = []; return p; });

  ipcMain.handle('art:lookup', (_e, albumId) => { art.lookUpAgain(albumId); return true; });
  ipcMain.handle('art:choose', async (_e, albumId) => {
    const r = await dialog.showOpenDialog(mainWin, { title: 'Choose album art', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }] });
    if (r.canceled) return false;
    await art.useFile(albumId, r.filePaths[0]);
    return true;
  });

  // player relay: the main window owns the audio; the mini player and tray send commands.
  ipcMain.on('player:state', (_e, state) => {
    const prevKey = lastState && lastState.track ? lastState.track.id + lastState.playing + lastState.liked : '';
    lastState = state;
    if (widgetWin && !widgetWin.isDestroyed()) widgetWin.webContents.send('player:state', state);
    const key = state.track ? state.track.id + state.playing + state.liked : '';
    if (key !== prevKey) { rebuildTray(); updateThumbar(state); }
  });
  ipcMain.handle('player:getState', () => lastState);
  ipcMain.on('player:command', (_e, cmd, arg) => { if (mainWin) mainWin.webContents.send('player:command', cmd, arg); });

  ipcMain.on('win:showMain', (_e, route) => showMain(route));
  ipcMain.on('win:openExternal', (_e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });
  ipcMain.on('win:copy', (_e, text) => clipboard.writeText(String(text || '')));
  ipcMain.handle('win:fullscreen', (_e, on) => {
    if (!mainWin) return false;
    mainWin.setFullScreen(typeof on === 'boolean' ? on : !mainWin.isFullScreen());
    return mainWin.isFullScreen();
  });

  ipcMain.on('widget:fit', (_e, contentHeight) => {
    if (!widgetWin) return;
    const w = store.settings().widget;
    if (w.mode !== 'bar' && w.mode !== 'card') return;
    const size = { width: WIDGET_SIZES[w.mode].w + WIDGET_PAD * 2, height: Math.round(contentHeight) + WIDGET_PAD * 2 };
    const b = widgetWin.getBounds();
    if (b.height === size.height && b.width === size.width) return;
    widgetWin.setBounds({ ...anchoredPos(size), ...size });
  });
  ipcMain.on('widget:moveTo', (_e, x, y) => { if (widgetWin && !store.settings().widget.locked) widgetWin.setPosition(Math.round(x), Math.round(y)); });
  ipcMain.on('widget:moveEnd', saveWidgetPos);
  ipcMain.on('widget:minimize', () => { if (widgetWin) widgetWin.minimize(); });
  ipcMain.on('app:quit', () => { quitting = true; app.quit(); });
  ipcMain.handle('widget:bounds', () => (widgetWin ? widgetWin.getBounds() : null));
  ipcMain.on('widget:menu', () => { if (widgetWin) widgetMenu().popup({ window: widgetWin }); });
  ipcMain.handle('radio:search', async (_e, opts) => { try { return await radio.search(opts || {}); } catch (e) { return { error: String(e.message || e) }; } });
  ipcMain.handle('radio:genres', async () => { try { return await radio.genres(); } catch { return []; } });
  ipcMain.handle('radio:nowPlaying', (_e, url) => radio.nowPlaying(url));
  ipcMain.on('radio:clicked', (_e, id) => radio.clicked(id));
  ipcMain.on('player:viz', (_e, f) => { if (widgetWin && !widgetWin.isDestroyed()) widgetWin.webContents.send('player:viz', f); });
  // your own video for the Earth visualizer (it stays where it is; only its location is saved)
  ipcMain.handle('app:pickVideo', async () => {
    const r = await dialog.showOpenDialog(mainWin, { title: 'Choose a video for the Earth visualizer', properties: ['openFile'],
      filters: [{ name: 'Videos', extensions: ['mp4', 'm4v', 'webm', 'mov', 'mkv', 'ogv'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    setSettings({ earthVideo: r.filePaths[0] });
    return r.filePaths[0];
  });
  // a picture for the pocket player's lock screen: copied into Zudio's own folder
  ipcMain.handle('widget:pickWallpaper', async () => {
    const r = await dialog.showOpenDialog(widgetWin || mainWin, { title: 'Choose a wallpaper', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }] });
    if (r.canceled) return null;
    const dir = path.join(app.getPath('userData'), 'wallpapers');
    fs.mkdirSync(dir, { recursive: true });
    const name = `wall-${Date.now()}${path.extname(r.filePaths[0]).toLowerCase()}`;
    fs.copyFileSync(r.filePaths[0], path.join(dir, name));
    return name;
  });
}

// ---------------------------------------------------------------- lifecycle
app.whenReady().then(() => {
  store.init();
  const dataDir = app.getPath('userData');
  library = new Library(dataDir);
  art = new ArtManager(dataDir, library, () => store.settings());
  protocol.handle('media', makeHandler(library, art, dataDir));

  library.on('progress', (p) => { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('lib:progress', p); });
  library.on('changed', () => { pushLibrary(); art.refreshAll(); });
  art.on('updated', (albumId) => {
    const u = art.urls(albumId);
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('art:updated', albumId, u);
    if (widgetWin && !widgetWin.isDestroyed()) widgetWin.webContents.send('art:updated', albumId, u);
  });
  art.on('busy', (b) => { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('art:busy', b); });

  registerIpc();
  createMain();
  createTray();
  if (POCKET) store.patchSettings({ widget: { open: true, mode: 'touch' } });
  if (store.settings().widget.open) createWidget();

  // first run: offer the Windows Music folder straight away
  if (!library.roots.length && !store.settings().askedMusicFolder) {
    store.patchSettings({ askedMusicFolder: true });
    try { const music = app.getPath('music'); if (fs.existsSync(music)) library.addRoot(music); } catch {}
  } else {
    library.scan();
  }
  art.refreshAll();

  const files = filesFromArgv(process.argv);
  if (files.length) openPaths(files, true, true);
});

app.on('before-quit', () => { quitting = true; store.flush(); library && library.flush(); art && art.flush(); });
app.on('window-all-closed', () => { if (quitting) app.quit(); });

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
