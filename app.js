// app.js — CSV версия (без Apps Script, без JSONP, без Cloudflare)
// Источник: опубликованная таблица Google Sheets (pub -> output=csv)

if (window.__RT_WIDGET_APP_LOADED__) {
  console.warn("RT widget app already loaded");
} else {
  window.__RT_WIDGET_APP_LOADED__ = true;

  (() => {
    const bridge = window.vkBridge;

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

    // === ТВОЯ опубликованная таблица ===
    // https://docs.google.com/spreadsheets/d/e/<PUB_ID>/pubhtml?gid=0&single=true
    const PUB_ID = "2PACX-1vRWC87JHjXGFuyoDwB3iyJLPkzExdiwRwxZu2SKpHv-G1t3oeGE4Kxu35ne0PgJbHWxqaVGq-28kfRE";
    const SHEET_GID = 0;
    const LIMIT = 10;

    let groupId = null;
    let appId = null;
    let communityToken = null;
    let loaded = null;

    function escapeHtml(s) {
      return String(s)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }

    function setOk(text) {
      state.innerHTML = '<span class="ok">' + escapeHtml(text) + '</span>';
    }

    function setBad(text) {
      state.innerHTML = '<span class="bad">' + escapeHtml(text) + '</span>';
    }

    function parseLaunchParams() {
      const sp = new URLSearchParams(window.location.search);
      const lp = Object.fromEntries(sp.entries());

      groupId = lp.vk_group_id ? Number(lp.vk_group_id) : null;
      appId = lp.vk_app_id ? Number(lp.vk_app_id) : null;

      if (groupPill) groupPill.textContent = 'group_id: ' + (groupId ?? '—');
      if (appPill) appPill.textContent = 'app_id: ' + (appId ?? '—');
      if (vkPill) vkPill.textContent = 'vk_platform: ' + (lp.vk_platform ?? '—');
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
        const playerCell = url ? { text: r.nick, url } : { text: r.nick };

        const rtCell = { text: String(r.rt || ''), align: 'center' };

        return [placeCell, playerCell, rtCell];
      });

      // Без more/more_url -> кнопки "Открыть" не будет
      return {
        title: 'Итоговая таблица RT',
        head,
        body
      };
    }

    function buildCode(widgetObj) {
      return 'return ' + JSON.stringify(widgetObj) + ';';
    }

    function csvUrl() {
      return (
        'https://docs.google.com/spreadsheets/d/e/' + encodeURIComponent(PUB_ID) +
        '/pub?gid=' + encodeURIComponent(String(SHEET_GID)) +
        '&single=true&output=csv&t=' + Date.now()
      );
    }

    // Надёжный CSV парсер (кавычки, запятые, переносы строк)
    function parseCsv(text) {
      const rows = [];
      let row = [];
      let cur = '';
      let inQuotes = false;

      for (let i = 0; i < text.length; i++) {
        const ch = text[i];

        if (inQuotes) {
          if (ch === '"') {
            const next = text[i + 1];
            if (next === '"') {
              cur += '"';
              i++;
            } else {
              inQuotes = false;
            }
          } else {
            cur += ch;
          }
          continue;
        }

        if (ch === '"') {
          inQuotes = true;
          continue;
        }

        if (ch === ',') {
          row.push(cur);
          cur = '';
          continue;
        }

        if (ch === '\n') {
          row.push(cur);
          rows.push(row);
          row = [];
          cur = '';
          continue;
        }

        if (ch === '\r') continue;

        cur += ch;
      }

      row.push(cur);
      rows.push(row);

      // убираем пустую последнюю строку, если она появилась
      if (rows.length) {
        const last = rows[rows.length - 1];
        if (last.length === 1 && last[0] === '') rows.pop();
      }

      return rows;
    }

    // Опционально: если первая строка — заголовки (Nick/VK/RT), пропускаем её
    function looksLikeHeader(row) {
      const a = (row?.[0] ?? '').toString().trim().toLowerCase();
      const b = (row?.[1] ?? '').toString().trim().toLowerCase();
      const c = (row?.[2] ?? '').toString().trim().toLowerCase();
      return (
        (a.includes('nick') || a.includes('ник')) &&
        (b === 'vk' || b.includes('vk') || b.includes('ссылка')) &&
        (c.includes('rt') || c.includes('бал'))
      );
    }

    async function loadData() {
      const resp = await fetch(csvUrl(), { cache: "no-store" });
      if (!resp.ok) throw new Error("Не удалось загрузить CSV. HTTP " + resp.status);

      const csvText = await resp.text();
      const table = parseCsv(csvText);

      let startIndex = 0;
      if (table.length && looksLikeHeader(table[0])) startIndex = 1;

      const parsed = [];
      for (let i = startIndex; i < table.length && parsed.length < LIMIT; i++) {
        const nick = (table[i][0] ?? '').toString().trim();
        const vk = (table[i][1] ?? '').toString().trim();
        const rt = (table[i][2] ?? '').toString().trim();

        if (!nick) continue;

        parsed.push({
          place: String(parsed.length + 1),
          nick,
          vk,
          rt
        });
      }

      if (parsed.length === 0) {
        throw new Error("В таблице нет данных. Ожидаю колонки: A=Nick, B=VK, C=RT.");
      }

      loaded = parsed;

      if (dataView) dataView.textContent = JSON.stringify({ rows: loaded }, null, 2);
      const widget = buildWidgetObject(loaded);
      if (codeView) codeView.textContent = buildCode(widget);
    }

    async function updateWidget() {
      if (!communityToken) throw new Error("Сначала получи токен (кнопка 1).");
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
      if (out.error) throw new Error('VK API error: ' + JSON.stringify(out.error));
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

      btnAuth?.addEventListener('click', async () => {
        try {
          if (!groupId || !appId) {
            setBad("Открой мини-приложение из группы (как админ), чтобы появился group_id.");
            return;
          }

          const res = await bridge.send('VKWebAppGetCommunityAuthToken', {
            app_id: appId,
            group_id: groupId,
            scope: 'app_widget'
          });

          communityToken = res.access_token;
          setOk("Токен получен ✅");
        } catch (e) {
          setBad("Ошибка токена");
        }
      });

      btnLoad?.addEventListener('click', async () => {
        try {
          await loadData();
          setOk("Данные загружены ✅");
        } catch (e) {
          setBad(String(e.message || e));
        }
      });

      btnPreview?.addEventListener('click', async () => {
        try {
          await previewWidget();
          setOk("Предпросмотр открыт ✅");
        } catch (e) {
          setBad(String(e.message || e));
        }
      });

      btnUpdate?.addEventListener('click', async () => {
        try {
          await loadData();
          await updateWidget();
          setOk("Виджет обновлён ✅");
        } catch (e) {
          setBad(String(e.message || e));
        }
      });
    }

    init();
  })();
}