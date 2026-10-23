importScripts('patch.js');

const HOME_URL = 'https://flow.google.com/';
const FLOW_HOST = 'flow.google.com';
const CDP_VERSION = '1.3';
const ATTACH_TIMEOUT_MS = 30000;
const DETACH_IDLE_MS = 6000;
const REDIRECT_COOLDOWN_MS = 15000;
const REPATCH_WINDOW_MS = 60000;
const MAX_REPATCH = 3;

const sessions = new Map();
const lastRedirectAt = new Map();
let enabled = true;

const isFlowUrl = (u) => typeof u === 'string' && u.startsWith(HOME_URL);

function isUnsupportedUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && x.hostname === FLOW_HOST &&
           /\/unsupported-country\/?$/.test(x.pathname);
  } catch { return false; }
}

function isBundleUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' &&
           x.hostname === 'www.gstatic.com' &&
           x.pathname.includes('AiSandboxAngularFrontend') &&
           x.pathname.includes('/js/');
  } catch { return false; }
}

const sendCmd = (tabId, method, params) =>
  chrome.debugger.sendCommand({ tabId }, method, params);

function decodeBody(res) {
  if (!res.base64Encoded) return res.body;
  const bin = atob(res.body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function encodeBody(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  const CH = 0x2000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  }
  return { body: btoa(bin), byteLength: bytes.byteLength };
}

function cleanHeaders(headers, byteLength) {
  const drop = new Set([
    'age', 'cache-control', 'content-encoding', 'content-length',
    'content-md5', 'etag', 'transfer-encoding'
  ]);
  const kept = (headers || []).filter(h => !drop.has(h.name.toLowerCase()));
  kept.push({ name: 'Cache-Control', value: 'no-store' });
  kept.push({ name: 'Content-Length', value: String(byteLength) });
  return kept;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function setBadge(state, tabId, detail) {
  const conf = {
    ON:  { text: 'ON',  color: '#1a73e8', title: 'Flow Unlock: включён' },
    OFF: { text: 'OFF', color: '#5f6368', title: 'Flow Unlock: выключен' },
    OK:  { text: 'OK',  color: '#188038', title: 'Flow Unlock: патч применён' },
    ERR: { text: 'ERR', color: '#d93025', title: 'Flow Unlock: ошибка' + (detail ? ' — ' + detail : '') }
  }[state];
  if (!conf) return;
  const scope = Number.isInteger(tabId) ? { tabId } : {};
  try {
    await Promise.all([
      chrome.action.setBadgeBackgroundColor({ ...scope, color: conf.color }),
      chrome.action.setBadgeText({ ...scope, text: conf.text }),
      chrome.action.setTitle({ ...scope, title: conf.title })
    ]);
  } catch {}
}

function globalBadge() {
  setBadge(enabled ? 'ON' : 'OFF');
}

async function store(data) {
  try { await chrome.storage.local.set(data); } catch {}
}

async function finish(tabId, ok, error, detail) {
  await detach(tabId);
  await store({
    lastError: ok ? null : (error || 'неизвестная ошибка'),
    lastRunAt: new Date().toISOString()
  });
  await setBadge(ok ? 'OK' : 'ERR', tabId, detail || error);
  if (ok) setTimeout(globalBadge, 2500);
}

function clearTimers(s) {
  if (!s) return;
  if (s.timeoutId) clearTimeout(s.timeoutId);
  if (s.idleId) clearTimeout(s.idleId);
  s.timeoutId = null;
  s.idleId = null;
}

async function detach(tabId) {
  const s = sessions.get(tabId);
  clearTimers(s);
  sessions.delete(tabId);
  try { await sendCmd(tabId, 'Fetch.disable'); } catch {}
  try { await chrome.debugger.detach({ tabId }); } catch {}
}

function scheduleIdleDetach(tabId) {
  const s = sessions.get(tabId);
  if (!s) return;
  if (s.idleId) clearTimeout(s.idleId);
  s.idleId = setTimeout(() => detach(tabId), DETACH_IDLE_MS);
}

function friendlyAttachError(e) {
  const msg = String(e && e.message || e);
  if (/another debugger/i.test(msg)) {
    return 'закрой DevTools (F12) на вкладке Flow и нажми «Перезапустить»';
  }
  if (/cannot access|not allowed/i.test(msg)) {
    return 'Chrome не дал доступ к вкладке — перезагрузи вкладку Flow';
  }
  return msg;
}

async function startPatch(tabId) {
  if (!enabled || !Number.isInteger(tabId) || sessions.has(tabId)) return;

  try {
    await chrome.debugger.attach({ tabId }, CDP_VERSION);
  } catch (e) {
    await store({ lastError: friendlyAttachError(e), lastRunAt: new Date().toISOString() });
    await setBadge('ERR', tabId, 'attach');
    return;
  }

  const s = { handling: new Set(), timeoutId: null, idleId: null };
  s.timeoutId = setTimeout(() => {
    if (sessions.has(tabId)) {
      finish(tabId, false, 'бандл Flow не пойман за 30 с. Нажми «Перезапустить».');
    }
  }, ATTACH_TIMEOUT_MS);
  sessions.set(tabId, s);

  try {
    await sendCmd(tabId, 'Page.enable');
    await sendCmd(tabId, 'Network.enable');
    await sendCmd(tabId, 'Network.setCacheDisabled', { cacheDisabled: true });
    await sendCmd(tabId, 'Fetch.enable', {
      patterns: [{
        urlPattern: 'https://www.gstatic.com/*',
        resourceType: 'Script',
        requestStage: 'Response'
      }]
    });
  } catch (e) {
    await finish(tabId, false, friendlyAttachError(e));
  }
}

async function handleBundle(tabId, params, s) {
  const url = params.request?.url || '';
  const reqId = params.requestId;

  if (!isBundleUrl(url) || s.handling.has(reqId)) {
    await sendCmd(tabId, 'Fetch.continueRequest', { requestId: reqId }).catch(() => {});
    return;
  }

  s.handling.add(reqId);
  if (s.timeoutId) {
    clearTimeout(s.timeoutId);
    s.timeoutId = null;
  }

  try {
    const raw = await sendCmd(tabId, 'Fetch.getResponseBody', { requestId: reqId });
    const text = decodeBody(raw);
    const patched = globalThis.FlowUnlockPatch.patchBundle(text);

    if (!patched.ok) {
      const unrelated = !patched.regionCount && !patched.ageCount &&
                        text.indexOf('unsupported-country') === -1;
      if (unrelated) {
        await sendCmd(tabId, 'Fetch.continueRequest', { requestId: reqId }).catch(() => {});
        return;
      }
      throw new Error(patched.error);
    }

    const enc = encodeBody(patched.source);
    await sendCmd(tabId, 'Fetch.fulfillRequest', {
      requestId: reqId,
      responseCode: params.responseStatusCode || 200,
      responseHeaders: cleanHeaders(params.responseHeaders, enc.byteLength),
      body: enc.body
    });

    const cur = await chrome.storage.local.get('patchedCount').catch(() => ({}));
    await store({
      lastPatchedUrl: url,
      lastRunAt: new Date().toISOString(),
      lastError: null,
      patchedCount: (Number(cur.patchedCount) || 0) + 1
    });
    await setBadge('OK', tabId);
    setTimeout(globalBadge, 2500);
    scheduleIdleDetach(tabId);
  } catch (e) {
    await sendCmd(tabId, 'Fetch.continueRequest', { requestId: reqId }).catch(() => {});
    await finish(tabId, false, String(e && e.message || e));
  } finally {
    s.handling.delete(reqId);
  }
}

if (chrome.debugger) {
  chrome.debugger.onEvent.addListener((src, method, params) => {
    if (method !== 'Fetch.requestPaused' || !Number.isInteger(src.tabId)) return;
    const s = sessions.get(src.tabId);
    if (!s) {
      sendCmd(src.tabId, 'Fetch.continueRequest', { requestId: params.requestId }).catch(() => {});
      return;
    }
    handleBundle(src.tabId, params, s).catch(() => {});
  });

  chrome.debugger.onDetach.addListener((src) => {
    if (!Number.isInteger(src.tabId)) return;
    const s = sessions.get(src.tabId);
    if (!s) return;
    clearTimers(s);
    sessions.delete(src.tabId);
  });
}

function maybeRedirectUnsupported(tabId, url) {
  if (!isUnsupportedUrl(url)) return false;
  const last = lastRedirectAt.get(tabId) || 0;
  if (Date.now() - last >= REDIRECT_COOLDOWN_MS) {
    lastRedirectAt.set(tabId, Date.now());
    chrome.tabs.update(tabId, { url: HOME_URL }).catch(() => {});
  }
  return true;
}

function handleNav(tabId, url) {
  if (typeof url !== 'string' || !url) return;
  if (maybeRedirectUnsupported(tabId, url)) return;
  if (!isFlowUrl(url)) {
    if (sessions.has(tabId)) detach(tabId);
    return;
  }
  if (!enabled) return;
  if (!chrome.debugger) {
    store({ lastError: 'в этом браузере нет chrome.debugger — нужен desktop Chrome', lastRunAt: new Date().toISOString() });
    setBadge('ERR', tabId, 'no debugger API');
    return;
  }
  if (!sessions.has(tabId)) startPatch(tabId).catch(() => {});
}

if (chrome.tabs && chrome.tabs.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const url = changeInfo.url ||
      (changeInfo.status === 'loading' && tab ? tab.url : null);
    if (url) handleNav(tabId, url);
  });
}

if (chrome.tabs && chrome.tabs.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    lastRedirectAt.delete(tabId);
    if (sessions.has(tabId)) detach(tabId);
  });
}

async function forceRepatch(tabId, url) {
  if (!enabled || !isFlowUrl(url) || !chrome.debugger) return;
  const key = 'repatch_' + tabId;
  const now = Date.now();
  let rec = null;
  try { rec = (await chrome.storage.local.get(key))[key]; } catch {}
  let count = 0;
  if (rec && now - rec.t < REPATCH_WINDOW_MS) count = rec.n;
  if (count >= MAX_REPATCH) {
    await store({
      lastError: 'патч не применился после ' + MAX_REPATCH + ' перезапусков. Проверь VPN и обнови расширение.',
      lastRunAt: new Date().toISOString()
    });
    await setBadge('ERR', tabId, 'repatch limit');
    return;
  }
  store({ [key]: { n: count + 1, t: now } });

  await detach(tabId);
  await startPatch(tabId);
  try { await chrome.tabs.update(tabId, { url: HOME_URL }); } catch {}
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = msg && Number.isInteger(msg.tabId) ? msg.tabId : sender.tab?.id;

  if (msg?.type === 'FLOW_GET') {
    (async () => {
      const st = await chrome.storage.local.get(
        ['enabled', 'lastError', 'lastRunAt', 'lastPatchedUrl', 'patchedCount']
      ).catch(() => ({}));
      reply({
        ok: true,
        enabled: st.enabled !== false,
        lastError: st.lastError || null,
        lastRunAt: st.lastRunAt || null,
        patchedCount: Number(st.patchedCount) || 0,
        lastPatchedUrl: st.lastPatchedUrl || null,
        sessionActive: Number.isInteger(tabId) && sessions.has(tabId)
      });
    })();
    return true;
  }

  if (msg?.type === 'FLOW_SET') {
    enabled = msg.enabled !== false;
    (async () => {
      await store({ enabled });
      if (!enabled) {
        for (const id of Array.from(sessions.keys())) await detach(id);
      }
      globalBadge();
      reply({ ok: true, enabled });
    })();
    return true;
  }

  if (msg?.type === 'FLOW_CSPING') {
    handleNav(sender.tab?.id, msg.url || sender.tab?.url || '');
    reply({ ok: true });
    return false;
  }

  if (msg?.type === 'FLOW_REPATCH' || msg?.type === 'FLOW_FORCE') {
    forceRepatch(tabId, msg.url || sender.tab?.url || '')
      .then(() => reply({ ok: true }))
      .catch((e) => reply({ ok: false, error: String(e) }));
    return true;
  }

  return false;
});

async function init() {
  const st = await chrome.storage.local.get('enabled').catch(() => ({}));
  enabled = st.enabled !== false;
  await store({ enabled });
  globalBadge();

  if (!chrome.debugger) {
    await store({ lastError: 'в этом браузере нет chrome.debugger — нужен desktop Chrome' });
    setBadge('ERR');
    return;
  }
  try {
    const targets = await chrome.debugger.getTargets();
    for (const t of targets) {
      if (t.attached && t.tabId && !sessions.has(t.tabId)) {
        await chrome.debugger.detach({ tabId: t.tabId }).catch(() => {});
      }
    }
  } catch {}
}

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);
