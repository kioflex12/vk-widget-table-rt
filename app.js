(() => {
  const bridge = window.vkBridge;

  const groupPill = document.getElementById('groupPill');
  const appPill = document.getElementById('appPill');
  const vkPill = document.getElementById('vkPill');

  const scriptUrlInput = document.getElementById('scriptUrl');
  const sheetNameInput = document.getElementById('sheetName');

  const btnAuth = document.getElementById('btnAuth');
  const btnLoad = document.getElementById('btnLoad');
  const btnPreview = document.getElementById('btnPreview');
  const btnUpdate = document.getElementById('btnUpdate');

  const state = document.getElementById('state');
  const dataView = document.getElementById('dataView');
  const codeView = document.getElementById('codeView');
  const APPS_SCRIPT_URL =    'https://script.google.com/macros/s/AKfycbwGkvaoitoposwY5fRuRgtsAixIbL5fBkpKdxARs33Nbcj9KOuYrkNjAM2-jXWkNhfy/exec';
  const SHEET_NAME = 'RT';

  let groupId = null;
  let appId = null;
  let communityToken = null;
  let loaded = null;

  const resolveCache = new Map();

  function parseLaunchParams() {
    const sp = new URLSearchParams(window.location.search);
    const lp = Object.fromEntries(sp.entries());

    groupId = lp.vk_group_id ? Number(lp.vk_group_id) : null;
    appId = lp.vk_app_id ? Number(lp.vk_app_id) : null;

    groupPill.textContent = 'group_id: ' + (groupId ?? '—');
    appPill.textContent = 'app_id: ' + (appId ?? '—');
    vkPill.textContent = 'vk_platform: ' + (lp.vk_platform ?? '—');
  }

  function setStateOk(text) {
    state.innerHTML = '<span class="ok">' + escapeHtml(text) + '</span>';
  }

  function setStateBad(text) {
    state.innerHTML = '<span class="bad">' + escapeHtml(text) + '</span>';
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function jsonp(url) {
    return new Promise((resolve, reject) => {
      const cbName = '__vk_jsonp_cb_' + Math.random().toString(36).slice(2);
      let script = null;

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('JSONP timeout'));
      }, 15000);

      function cleanup() {
        clearTimeout(timeout);
        try { delete window[cbName]; } catch (_) { window[cbName] = undefined; }
        if (script && script.parentNode) script.parentNode.removeChild(script);
      }

      window[cbName] = (data) => {
        cleanup();
        resolve(data);
      };

      const sep = url.includes('?') ? '&' : '?';
      const full = url + sep + 'callback=' + encodeURIComponent(cbName) + '&t=' + Date.now();

      script = document.createElement('script');
      script.src = full;
      script.async = true;
      script.onerror = () => {
        cleanup();
        reject(new Error('JSONP load error'));
      };

      document.head.appendChild(script);
    });
  }

  function extractScreenName(vkField) {
    const s = (vkField || '').trim();
    if (!s) return null;

    if (/^\d+$/.test(s)) return null; // already numeric
    const mId = s.match(/(?:vk\.com\/|\/)id(\d+)(?:\b|\/|$)/i);
    if (mId && mId[1]) return null;

    const m = s.match(/vk\.com\/([A-Za-z0-9_.]+)/i);
    if (m && m[1]) return m[1];

    if (/^[A-Za-z0-9_.]+$/.test(s)) return s;

    return null;
  }

  async function resolveScreenNameToUserId(screenName) {
    if (!screenName) return null;
    if (resolveCache.has(screenName)) return resolveCache.get(screenName);

    const url =
      'https://api.vk.com/method/utils.resolveScreenName' +
      '?v=5.199' +
      '&screen_name=' + encodeURIComponent(screenName);

    const json = await jsonp(url);

    let id = null;
    if (json && json.response && json.response.type === 'user' && json.response.object_id) {
      id = Number(json.response.object_id);
    }

    resolveCache.set(screenName, id);
    return id;
  }

  async function normalizeRowsWithResolvedIds(rows) {
    const out = rows.map(r => ({ ...r, resolved_id: null }));

    const toResolve = [];
    for (const r of out) {
      const s = (r.vk || '').trim();
      if (!s) continue;

      if (/^\d+$/.test(s)) {
        r.resolved_id = Number(s);
        continue;
      }

      const mId = s.match(/(?:vk\.com\/|\/)id(\d+)(?:\b|\/|$)/i);
      if (mId && mId[1]) {
        r.resolved_id = Number(mId[1]);
        continue;
      }

      const screen = extractScreenName(s);
      if (screen) toResolve.push({ r, screen });
    }

    for (const item of toResolve) {
      item.r.resolved_id = await resolveScreenNameToUserId(item.screen);
    }

    return out;
  }

  function buildWidgetObject(rows) {
    const head = [
      { text: '№', align: 'center' },
      { text: 'Игрок' },
      { text: 'RT', align: 'center' }
    ];

    const body = rows.slice(0, 10).map(r => {
      const placeCell = { text: String(r.place || ''), align: 'center' };

      let url = null;
      let icon_id = null;

      if (r.resolved_id && Number.isFinite(r.resolved_id)) {
        url = 'https://vk.com/id' + r.resolved_id;
        icon_id = 'id' + r.resolved_id;
      } else {
        const s = (r.vk || '').trim();
        if (s.startsWith('http://') || s.startsWith('https://')) url = s;
        else if (s) url = 'https://vk.com/' + s;
      }

      const playerCell = icon_id
        ? { text: r.nick, icon_id: icon_id, url: url || undefined }
        : (url ? { text: r.nick, url: url } : { text: r.nick });

      const rtCell = { text: String(r.rt || ''), align: 'center' };

      return [placeCell, playerCell, rtCell];
    });

    // Кнопки "Открыть" НЕ будет, потому что нет more/more_url
    return {
      title: 'Турнирная таблица',
      head,
      body
    };
  }

  function buildCode(widgetObj) {
    return 'return ' + JSON.stringify(widgetObj) + ';';
  }

  async function loadDataFromAppsScript() {
    const base = APPS_SCRIPT_URL;
    const sheet = SHEET_NAME;

    if (!base.startsWith('https://')) {
      throw new Error('Apps Script URL должен начинаться с https://');
    }

    const url = base + '?sheet=' + encodeURIComponent(sheet) + '&limit=10';

    // Apps Script -> JSONP (в обход 302/CORS)
    const json = await jsonp(url);

    if (!json || !Array.isArray(json.rows)) {
      throw new Error('Неверный формат ответа Apps Script. Должно быть { rows: [...] }');
    }

    const rows = json.rows.map(x => ({
      place: String(x.place || '').trim(),
      nick: String(x.nick || '').trim(),
      vk: String(x.vk || '').trim(),
      rt: String(x.rt || '').trim()
    })).filter(x => x.nick.length > 0);

    if (rows.length === 0) {
      throw new Error('В таблице нет данных (проверь лист и заполнение).');
    }

    loaded = await normalizeRowsWithResolvedIds(rows);

    dataView.textContent = JSON.stringify({ rows: loaded }, null, 2);

    const widget = buildWidgetObject(loaded);
    codeView.textContent = buildCode(widget);
  }

  async function updateWidget() {
    if (!communityToken) {
      throw new Error('Сначала получи токен (кнопка 1).');
    }
    if (!loaded) {
      await loadDataFromAppsScript();
    }

    const widget = buildWidgetObject(loaded);
    const code = buildCode(widget);

    const form = new URLSearchParams();
    form.set('v', '5.199');
    form.set('access_token', communityToken);
    form.set('type', 'table');
    form.set('code', code);

    const resp = await fetch('https://api.vk.com/method/appWidgets.update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: form.toString()
    });

    const out = await resp.json();
    if (out.error) {
      throw new Error('VK API error: ' + JSON.stringify(out.error));
    }
  }

  async function previewWidget() {
    if (!loaded) {
      await loadDataFromAppsScript();
    }
    const widget = buildWidgetObject(loaded);
    const code = buildCode(widget);
    await bridge.send('VKWebAppShowAppWidgetPreviewBox', { type: 'table', code });
  }

  async function init() {
    parseLaunchParams();
    await bridge.send('VKWebAppInit');

    btnAuth.addEventListener('click', async () => {
      state.textContent = '';
      if (!groupId || !appId) {
        setStateBad('Открой мини-приложение из сообщества (как админ), чтобы появился group_id.');
        return;
      }

      try {
        const res = await bridge.send('VKWebAppGetCommunityAuthToken', {
          app_id: appId,
          group_id: groupId,
          scope: 'app_widget'
        });
        communityToken = res.access_token;
        setStateOk('Токен получен ✅');
      } catch (e) {
        const msg = (e && e.error_data) ? JSON.stringify(e.error_data) : String(e);
        setStateBad('Ошибка токена: ' + msg);
      }
    });

    btnLoad.addEventListener('click', async () => {
      state.textContent = '';
      try {
        await loadDataFromAppsScript();
        setStateOk('Данные загружены ✅');
      } catch (e) {
        setStateBad(String(e.message || e));
      }
    });

    btnPreview.addEventListener('click', async () => {
      state.textContent = '';
      try {
        await previewWidget();
        setStateOk('Предпросмотр открыт ✅');
      } catch (e) {
        setStateBad(String(e.message || e));
      }
    });

    btnUpdate.addEventListener('click', async () => {
      state.textContent = '';
      try {
        await loadDataFromAppsScript();
        await updateWidget();
        setStateOk('Виджет обновлён ✅');
      } catch (e) {
        setStateBad(String(e.message || e));
      }
    });
  }

  init();
})();