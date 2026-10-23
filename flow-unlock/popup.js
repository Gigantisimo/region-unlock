const $ = (id) => document.getElementById(id);
const HOME = 'https://flow.google.com/';
let tabId = null;
let tabUrl = '';

const isFlow = (u = '') => u.startsWith(HOME);

function fmtTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return ''; }
}

async function refresh() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  tabUrl = tab?.url || '';

  let s = null;
  try { s = await chrome.runtime.sendMessage({ type: 'FLOW_GET', tabId }); } catch {}

  const on = s ? s.enabled : true;
  $('enabled').checked = on;

  $('restart').disabled = !on || !isFlow(tabUrl);

  const status = $('status');
  status.className = '';

  if (!on) {
    status.textContent = 'Выключено. Включи тумблер.';
  } else if (s?.lastError) {
    status.textContent = 'Патч не применился';
    status.className = 'wait';
  } else if (isFlow(tabUrl) && s?.sessionActive) {
    status.textContent = 'Патч активен на этой вкладке.';
    status.className = 'ok';
  } else if (isFlow(tabUrl)) {
    status.textContent = 'Жду загрузку Flow…';
    status.className = 'wait';
  } else {
    status.textContent = 'Открой flow.google.com — патч включится сам.';
    status.className = 'wait';
  }

  $('error').textContent = s?.lastError || '';

  const parts = [];
  if (s?.patchedCount) parts.push('Патчей применено: ' + s.patchedCount);
  if (s?.lastRunAt) parts.push('последний: ' + fmtTime(s.lastRunAt));
  $('stats').textContent = parts.join(' · ');
}

$('enabled').addEventListener('change', async (e) => {
  const r = await chrome.runtime.sendMessage({ type: 'FLOW_SET', enabled: e.target.checked }).catch(() => null);
  if (!r?.ok) {
    e.target.checked = !e.target.checked;
    $('error').textContent = r?.error || 'Не удалось переключить';
    return;
  }
  refresh();
});

$('open').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'FLOW_SET', enabled: true }).catch(() => {});
  chrome.tabs.create({ url: HOME });
  window.close();
});

$('restart').addEventListener('click', async () => {
  if (!isFlow(tabUrl) || !Number.isInteger(tabId)) return;
  const r = await chrome.runtime.sendMessage({ type: 'FLOW_FORCE', tabId, url: tabUrl }).catch(() => null);
  if (!r?.ok) {
    $('error').textContent = r?.error || 'Не удалось перезапустить';
    return;
  }
  setTimeout(refresh, 1200);
});

refresh();
