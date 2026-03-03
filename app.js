(() => {
  const bridge = window.vkBridge;

  const SHEETS_ID = "2PACX-1vRWC87JHjXGFuyoDwB3iyJLPkzExdiwRwxZu2SKpHv-G1t3oeGE4Kxu35ne0PgJbHWxqaVGq-28kfRE";
  const SHEET_GID = "0";
  const LIMIT = 10;
  const groupPill = document.getElementById('groupPill');
  const appPill = document.getElementById('appPill');
  const vkPill = document.getElementById('vkPill');

  const btnAuth = document.getElementById('btnAuth');
  const btnLoad = document.getElementById('btnLoad');
  const btnPreview = document.getElementById('btnPreview');
  const btnUpdate = document.getElementById('btnUpdate');

  const state = document.getElementById('state');
  const dataView = document.getElementById('dataView');
  const codeView = document.getElementById('codeView');

  const APPS_SCRIPT_URL =
    "https://script.google.com/macros/s/AKfycbwGkvaoitoposwY5fRuRgtsAixIbL5fBkpKdxARs33Nbcj9KOuYrkNjAM2-jXWkNhfy/exec";
  const SHEET_NAME = "RT";
  const LIMIT = 10;

  let groupId = null;
  let appId = null;
  let communityToken = null;
  let loaded = null;

  function parseLaunchParams() {
    const sp = new URLSearchParams(window.location.search);
    const lp = Object.fromEntries(sp.entries());

    groupId = lp.vk_group_id ? Number(lp.vk_group_id) : null;
    appId = lp.vk_app_id ? Number(lp.vk_app_id) : null;

    groupPill.textContent = 'group_id: ' + (groupId ?? '—');
    appPill.textContent = 'app_id: ' + (appId ?? '—');
    vkPill.textContent = 'vk_platform: ' + (lp.vk_platform ?? '—');
  }

  function setOk(text) {
    state.innerHTML = '<span class="ok">' + text + '</span>';
  }

  function setBad(text) {
    state.innerHTML = '<span class="bad">' + text + '</span>';
  }

  function buildProfileUrl(vkValue) {
    const s = (vkValue || '').trim();
    if (!s) return null;

    if (s.startsWith('http://') || s.startsWith('https://')) return s;

    return 'https://vk.com/' + s;
  }

  function buildWidgetObject(rows) {
    const head = [
      { text: '№', align: 'center' },
      { text: 'Игрок' },
      { text: 'RT', align: 'center' }
    ];

    const body = rows.slice(0, LIMIT).map(r => {
      const placeCell = { text: String(r.place || ''), align: 'center' };

      const url = buildProfileUrl(r.vk);
      const playerCell = url
        ? { text: r.nick, url: url }
        : { text: r.nick };

      const rtCell = { text: String(r.rt || ''), align: 'center' };

      return [placeCell, playerCell, rtCell];
    });

    return {
      title: 'Турнирная таблица',
      head,
      body
    };
  }

  function buildCode(widgetObj) {
    return 'return ' + JSON.stringify(widgetObj) + ';';
  }

  async function loadData() {
    const url =
      `https://docs.google.com/spreadsheets/d/${encodeURIComponent(SHEETS_ID)}/gviz/tq` +
      `?tqx=out:json&gid=${encodeURIComponent(String(SHEET_GID))}` +
      `&t=${Date.now()}`;

    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) throw new Error("Не удалось загрузить таблицу. HTTP " + resp.status);

    const text = await resp.text();

    // gviz возвращает не чистый JSON, а обёртку. Вытаскиваем объект:
    const match = text.match(/google\\.visualization\\.Query\\.setResponse\\((.*)\\);?\\s*$/s);
    if (!match || !match[1]) throw new Error("Не смог распарсить ответ gviz.");

    const payload = JSON.parse(match[1]);

    const rows = payload?.table?.rows || [];
    // Ожидаем колонки: Nick | VK | RT
    const parsed = [];
    for (let i = 0; i < rows.length && parsed.length < LIMIT; i++) {
      const c = rows[i].c || [];
      const nick = (c[0]?.v ?? "").toString().trim();
      const vk = (c[1]?.v ?? "").toString().trim();
      const rt = (c[2]?.v ?? "").toString().trim();

      if (!nick) continue;

      parsed.push({
        place: String(parsed.length + 1),
        nick,
        vk,
        rt
      });
    }

    if (parsed.length === 0) throw new Error("В таблице нет данных.");

    loaded = parsed;

    dataView.textContent = JSON.stringify({ rows: loaded }, null, 2);

    const widget = buildWidgetObject(loaded);
    codeView.textContent = buildCode(widget);
  }

  async function updateWidget() {
    if (!communityToken) throw new Error("Сначала получи токен");
    if (!loaded) await loadData();

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
    if (out.error) throw new Error(JSON.stringify(out.error));
  }

  async function previewWidget() {
    if (!loaded) await loadData();
    const widget = buildWidgetObject(loaded);
    const code = buildCode(widget);
    await bridge.send('VKWebAppShowAppWidgetPreviewBox', { type: 'table', code });
  }

  async function init() {
    parseLaunchParams();
    await bridge.send('VKWebAppInit');

    btnAuth.addEventListener('click', async () => {
      if (!groupId || !appId) {
        setBad("Открой приложение из группы (как админ)");
        return;
      }

      try {
        const res = await bridge.send('VKWebAppGetCommunityAuthToken', {
          app_id: appId,
          group_id: groupId,
          scope: 'app_widget'
        });
        communityToken = res.access_token;
        setOk("Токен получен");
      } catch (e) {
        setBad("Ошибка токена");
      }
    });

    btnLoad.addEventListener('click', async () => {
      try {
        await loadData();
        setOk("Данные загружены");
      } catch (e) {
        setBad(e.message);
      }
    });

    btnPreview.addEventListener('click', async () => {
      try {
        await previewWidget();
        setOk("Предпросмотр открыт");
      } catch (e) {
        setBad(e.message);
      }
    });

    btnUpdate.addEventListener('click', async () => {
      try {
        await loadData();
        await updateWidget();
        setOk("Виджет обновлён");
      } catch (e) {
        setBad(e.message);
      }
    });
  }

  init();
})();