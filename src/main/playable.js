





'use strict';






function resolvePlayableTarget(resolved, track = {}) {
  if (resolved && typeof resolved === 'object' && typeof resolved.path === 'string' && !resolved.metaOnly) {
    return { path: resolved.path, meta: resolved.meta || track.meta || null };
  }
  
  const path = (typeof resolved === 'string' && resolved)
    ? resolved
    : (track.playPath || track.path || '');
  return { path, meta: track.meta || null };
}

module.exports = { resolvePlayableTarget };
