(function (G) {
  'use strict';

  var REGION_RE = /_\.([a-zA-Z0-9_$]+)\(\s*([a-zA-Z0-9_$]+)\s*,\s*31\s*\)/g;
  var AGE_RE = /_\.([a-zA-Z0-9_$]+)\(\s*([a-zA-Z0-9_$]+)\s*,\s*32\s*\)/g;

  function esc(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function patchBundle(src) {
    var region = Array.from(src.matchAll(REGION_RE));
    var age = Array.from(src.matchAll(AGE_RE));

    if (region.length !== 1 || age.length !== 1) {
      return {
        ok: false,
        error: 'не найдена сигнатура (region x' + region.length + ', age x' + age.length + '). Google обновил Flow — нужно обновить расширение.',
        source: src,
        regionCount: region.length,
        ageCount: age.length
      };
    }

    var rFn = region[0][1];
    var rArg = region[0][2];
    if (rFn !== age[0][1] || rArg !== age[0][2]) {
      return {
        ok: false,
        error: 'не совпал accessor флагов',
        source: src,
        regionCount: region.length,
        ageCount: age.length
      };
    }

    var callRe = new RegExp('_\\.' + esc(rFn) + '\\(\\s*' + esc(rArg) + '\\s*,\\s*31\\s*\\)', 'g');
    var replaced = 0;
    var out = src.replace(callRe, function () { replaced++; return 'true'; });

    if (!replaced) {
      return {
        ok: false,
        error: 'замена не применилась',
        source: src,
        regionCount: region.length,
        ageCount: age.length
      };
    }

    out += '\n;window.__FLOW_UNLOCKED=true;';
    return { ok: true, error: null, source: out, count: replaced };
  }

  G.FlowUnlockPatch = Object.freeze({ patchBundle: patchBundle });
})(globalThis);
