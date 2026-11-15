// Locates the bundled ffmpeg / ffprobe binaries (ffmpeg-static, ffprobe-static).
// Inside a packaged app they live in app.asar.unpacked; during development (or tests)
// we fall back to whatever is on the PATH.
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

function unpacked(p) {
  return p ? p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1') : p;
}
function resolveBin(modName, pick, fallback) {
  try {
    const m = require(modName);
    const p = unpacked(pick(m));
    if (p && fs.existsSync(p)) return p;
  } catch { /* not installed */ }
  return fallback;
}

const FFMPEG = process.env.APP_FFMPEG || resolveBin('ffmpeg-static', (m) => (typeof m === 'string' ? m : m.path), 'ffmpeg');
const FFPROBE = process.env.APP_FFPROBE || resolveBin('ffprobe-static', (m) => m.path, 'ffprobe');

// Run a binary and collect stdout as a Buffer. Rejects on non-zero exit.
function run(bin, args, { timeout = 120000, maxBytes = 512 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true });
    const out = [];
    let size = 0, err = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`${path.basename(bin)} timed out`)); }, timeout);
    p.stdout.on('data', (d) => { size += d.length; if (size <= maxBytes) out.push(d); });
    p.stderr.on('data', (d) => { if (err.length < 4000) err += d; });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`${path.basename(bin)} failed (${code}): ${err.trim().split('\n').pop()}`));
    });
  });
}

module.exports = { FFMPEG, FFPROBE, run };
