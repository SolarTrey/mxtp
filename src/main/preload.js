const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (cb) => {
  const fn = (_e, ...args) => cb(...args);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  product: ipcRenderer.sendSync('product'),
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    onChange: on('settings:changed')
  },
  // your plays, playlists, queue (small, saved as JSON)
  user: {
    get: () => ipcRenderer.invoke('user:get'),
    save: (data) => ipcRenderer.invoke('user:save', data)
  },
  // the music on your drives
  lib: {
    get: () => ipcRenderer.invoke('lib:get'),
    addFolder: () => ipcRenderer.invoke('lib:addFolder'),
    removeFolder: (p) => ipcRenderer.invoke('lib:removeFolder', p),
    rescan: () => ipcRenderer.invoke('lib:rescan'),
    openPaths: (paths, play) => ipcRenderer.invoke('lib:openPaths', paths, play),
    pickFiles: () => ipcRenderer.invoke('lib:pickFiles'),
    peaks: (id) => ipcRenderer.invoke('lib:peaks', id),
    showItem: (id) => ipcRenderer.send('lib:showItem', id),
    pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return null; } },
    onChange: on('lib:changed'),
    onProgress: on('lib:progress'),
    onOpenFiles: on('app:openFiles'),
    ready: () => ipcRenderer.invoke('app:ready')
  },
  radio: {
    search: (opts) => ipcRenderer.invoke('radio:search', opts),
    genres: () => ipcRenderer.invoke('radio:genres'),
    nowPlaying: (url) => ipcRenderer.invoke('radio:nowPlaying', url),
    clicked: (id) => ipcRenderer.send('radio:clicked', id)
  },
  art: {
    lookup: (albumId) => ipcRenderer.invoke('art:lookup', albumId),
    choose: (albumId) => ipcRenderer.invoke('art:choose', albumId),
    onUpdate: on('art:updated'),
    onBusy: on('art:busy')
  },
  player: {
    sendState: (s) => ipcRenderer.send('player:state', s),
    getState: () => ipcRenderer.invoke('player:getState'),
    onState: on('player:state'),
    command: (cmd, arg) => ipcRenderer.send('player:command', cmd, arg),
    onCommand: on('player:command'),
    sendViz: (f) => ipcRenderer.send('player:viz', f),
    onViz: on('player:viz')
  },
  win: {
    showMain: (route) => ipcRenderer.send('win:showMain', route),
    openExternal: (url) => ipcRenderer.send('win:openExternal', url),
    copy: (text) => ipcRenderer.send('win:copy', text),
    fullscreen: (on) => ipcRenderer.invoke('win:fullscreen', on),
    pickVideo: () => ipcRenderer.invoke('app:pickVideo'),
    onNavigate: on('app:navigate')
  },
  widget: {
    fit: (h) => ipcRenderer.send('widget:fit', h),
    moveTo: (x, y) => ipcRenderer.send('widget:moveTo', x, y),
    moveEnd: () => ipcRenderer.send('widget:moveEnd'),
    bounds: () => ipcRenderer.invoke('widget:bounds'),
    menu: () => ipcRenderer.send('widget:menu'),
    pickWallpaper: () => ipcRenderer.invoke('widget:pickWallpaper'),
    minimize: () => ipcRenderer.send('widget:minimize'),
    quit: () => ipcRenderer.send('app:quit')
  }
});
