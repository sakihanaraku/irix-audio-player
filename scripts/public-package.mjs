









export const LINUX_ONLY_SCRIPTS = [
  'dist:linux',
  'dist:linux:dir',
  'dist:linux:arch',
  'docker:linux',
  'docker:linux:dir',
  'docker:win',
  'make:icons',
];






export function sanitizePublicPackageJson(text) {
  const pkg = JSON.parse(String(text));
  if (pkg.scripts && typeof pkg.scripts === 'object') {
    for (const key of LINUX_ONLY_SCRIPTS) delete pkg.scripts[key];
  }
  if (pkg.build && typeof pkg.build === 'object') {
    
    delete pkg.build.linux;
    delete pkg.build.pacman;
  }
  if (pkg['//homepage']) {
    pkg['//homepage'] = 'electron-builder 需要 homepage；换成你自己的项目地址。';
  }
  return JSON.stringify(pkg, null, 2) + '\n';
}







export function sanitizePublicFile(rel, raw) {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'utf8');
  if (rel === 'package.json') {
    return Buffer.from(sanitizePublicPackageJson(buf.toString('utf8')), 'utf8');
  }
  return buf;
}
