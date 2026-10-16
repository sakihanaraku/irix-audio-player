'use strict';











const WIN_ILLEGAL = /[<>:"|?*\u0000-\u001f]/;
const WIN_DRIVE = /^[A-Za-z]:[\\/]/;
const WIN_UNC = /^\\\\[^\\/]+[\\/][^\\/]+/;
const WIN_DRIVE_RELATIVE = /^[A-Za-z]:(?![\\/])/;      


function expandEnv(input, env = {}) {
  let out = input.replace(/%([^%]+)%/g, (m, name) => (env[name] !== undefined ? env[name] : m));
  out = out.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, name) => (env[name] !== undefined ? env[name] : m));
  out = out.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, name) => (env[name] !== undefined ? env[name] : m));
  return out;
}









function parsePathInput(raw, opts = {}) {
  const platform = opts.platform || process.platform;
  const env = opts.env || process.env;
  const home = opts.home || env.HOME || env.USERPROFILE || '';

  if (typeof raw !== 'string') return { ok: false, reason: 'empty' };
  let text = raw.trim();
  if (!text) return { ok: false, reason: 'empty' };

  
  const quoted = /^(['"])([\s\S]*)\1$/.exec(text);
  if (quoted) text = quoted[2].trim();
  if (!text) return { ok: false, reason: 'empty' };

  text = expandEnv(text, env);

  if (platform === 'win32') {
    
    if (/%[^%]+%/.test(text)) return { ok: false, reason: 'bad-env' };
    if (/^~($|[\\/])/.test(text)) {
      if (!home) return { ok: false, reason: 'bad-home' };
      text = home + text.slice(1);
    }
    if (WIN_DRIVE_RELATIVE.test(text)) return { ok: false, reason: 'drive-relative' };
    if (!WIN_DRIVE.test(text) && !WIN_UNC.test(text)) return { ok: false, reason: 'not-absolute' };
    
    const rest = text.replace(/^[A-Za-z]:/, '').replace(/^\\\\[^\\/]+[\\/][^\\/]+/, '');
    if (WIN_ILLEGAL.test(rest)) return { ok: false, reason: 'illegal-char' };
    return { ok: true, path: text, kind: 'win' };
  }

  
  if (/^~($|\/)/.test(text)) {
    if (!home) return { ok: false, reason: 'bad-home' };
    text = home + text.slice(1);
  }
  if (!text.startsWith('/')) return { ok: false, reason: 'not-absolute' };
  if (text.includes('\u0000')) return { ok: false, reason: 'illegal-char' };
  return { ok: true, path: text, kind: 'posix' };
}


const REASON_TEXT = {
  empty: 'path.err.empty',
  'bad-env': 'path.err.badEnv',
  'bad-home': 'path.err.badHome',
  'drive-relative': 'path.err.driveRelative',
  'not-absolute': 'path.err.notAbsolute',
  'illegal-char': 'path.err.illegalChar',
  'not-found': 'path.err.notFound',
  'not-dir': 'path.err.notDir',
};

module.exports = { parsePathInput, expandEnv, REASON_TEXT, WIN_ILLEGAL };
