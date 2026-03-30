// app.js — CSV версия (без Apps Script, без JSONP, без Cloudflare)
// Источник: опубликованная таблица Google Sheets (pub -> output=csv)

if (window.__RT_WIDGET_APP_LOADED__) {
  console.warn("RT widget app already loaded");
} else {
  window.__RT_WIDGET_APP_LOADED__ = true;

  (() => {
    const VERSION = '1.0.3';
    const bridge = window.vkBridge;

    // Режимы: публичная таблица / админ-панель
    const publicView = document.getElementById('publicView');
    const adminView = document.getElementById('adminView');
    const publicBody = document.getElementById('publicBody');
    const publicTable = document.getElementById('publicTable');
    const publicLoading = document.getElementById('publicLoading');
    const publicError = document.getElementById('publicError');

    const groupPill = document.getElementById('groupPill');
    const appPill = document.getElementById('appPill');
    const vkPill = document.getElementById('vkPill');
    const versionPill = document.getElementById('versionPill');

    const btnAuth = document.getElementById('btnAuth');
    const btnLoad = document.getElementById('btnLoad');
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

    function extractError(e) {
      if (e && e.message) return e.message;
      if (e && e.error_data) {
        const d = e.error_data;
        return d.error_msg || d.error_reason || JSON.stringify(d);
      }
      if (typeof e === 'object') return JSON.stringify(e);
      return String(e);
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

    const VK_DOMAINS = ['vk.com', 'vk.ru', 'vkontakte.ru', 'vkvideo.ru', 'vk.me', 'vk.cc', 'vk.link'];

    function isVkUrl(url) {
      try {
        const host = new URL(url).hostname.replace(/^www\./, '');
        return VK_DOMAINS.includes(host);
      } catch { return false; }
    }

    function buildProfileUrl(vkValue) {
      const s = (vkValue || '').trim();
      if (!s) return null;
      if (s.startsWith('http://') || s.startsWith('https://')) {
        if (isVkUrl(s)) return s;
        console.warn('Ссылка не VK-домен, пропущена:', s);
        return null;
      }
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

      const widget = {
        title: 'Итоговая таблица RT',
        head,
        body
      };

      // Кнопка "Показать всё" -> открывает мини-приложение с полной таблицей
      if (appId) {
        widget.more = 'Показать всё';
        widget.more_url = 'https://vk.com/app' + appId;
      }

      return widget;
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

    function parseRows(table, limit) {
      let startIndex = 0;
      if (table.length && looksLikeHeader(table[0])) startIndex = 1;

      const parsed = [];
      for (let i = startIndex; i < table.length; i++) {
        if (limit && parsed.length >= limit) break;

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

      return parsed;
    }

    async function fetchCsv() {
      const resp = await fetch(csvUrl(), { cache: "no-store" });
      if (!resp.ok) throw new Error("Не удалось загрузить CSV. HTTP " + resp.status);
      return parseCsv(await resp.text());
    }

    async function loadData() {
      const table = await fetchCsv();
      const parsed = parseRows(table, LIMIT);

      if (parsed.length === 0) {
        throw new Error("В таблице нет данных. Ожидаю колонки: A=Nick, B=VK, C=RT.");
      }

      loaded = parsed;

      if (dataView) dataView.textContent = JSON.stringify({ rows: loaded }, null, 2);
      const widget = buildWidgetObject(loaded);
      if (codeView) codeView.textContent = buildCode(widget);
    }

    const MEDALS = ['', '\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'];

    function renderPublicTable(rows) {
      publicBody.innerHTML = '';
      rows.forEach(r => {
        const tr = document.createElement('tr');
        const placeNum = Number(r.place);
        if (placeNum >= 1 && placeNum <= 3) tr.className = 'place-' + placeNum;

        const tdPlace = document.createElement('td');
        tdPlace.className = 'col-place';
        tdPlace.innerHTML = MEDALS[placeNum] ? '<span class="place-medal">' + MEDALS[placeNum] + '</span>' : escapeHtml(r.place);

        const tdPlayer = document.createElement('td');
        const url = buildProfileUrl(r.vk);
        if (url) {
          const a = document.createElement('a');
          a.href = url;
          a.target = '_blank';
          a.textContent = r.nick;
          tdPlayer.appendChild(a);
        } else {
          tdPlayer.textContent = r.nick;
        }

        const tdRt = document.createElement('td');
        tdRt.className = 'col-rt';
        tdRt.textContent = r.rt;

        tr.append(tdPlace, tdPlayer, tdRt);
        publicBody.appendChild(tr);
      });

      publicLoading.style.display = 'none';
      publicTable.style.display = '';
    }

    async function loadPublicView() {
      try {
        const table = await fetchCsv();
        const allRows = parseRows(table, null);
        if (allRows.length === 0) {
          throw new Error("В таблице нет данных.");
        }
        renderPublicTable(allRows);
      } catch (e) {
        publicLoading.style.display = 'none';
        publicError.style.display = '';
        publicError.textContent = extractError(e);
      }
    }

    let updating = false;

    async function updateWidget() {
      if (updating) return;
      updating = true;
      try {
        if (!communityToken) throw new Error("Сначала получи токен (кнопка 1).");
        if (!loaded) await loadData();

        const widget = buildWidgetObject(loaded);
        const code = buildCode(widget);

        const out = await bridge.send('VKWebAppCallAPIMethod', {
          method: 'appWidgets.update',
          params: {
            v: '5.199',
            access_token: communityToken,
            type: 'table',
            code: code
          }
        });

        if (out && out.error) {
          throw new Error('VK API error: ' + JSON.stringify(out.error));
        }

        console.log("appWidgets.update response:", out);
      } finally {
        updating = false;
      }
    }

    async function init() {
      parseLaunchParams();
      if (versionPill) versionPill.textContent = 'v' + VERSION;

      try {
        await bridge.send('VKWebAppInit');
      } catch (e) {
        console.warn('VKWebAppInit failed:', e);
      }

      // Режим: если есть group_id — админ-панель, иначе — публичная таблица
      if (groupId) {
        adminView.style.display = '';
      } else {
        publicView.style.display = '';
        loadPublicView();
        return;
      }

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
          setBad(extractError(e));
        }
      });

      btnUpdate?.addEventListener('click', async () => {
        try {
          await loadData();
          await updateWidget();
          setOk("Виджет обновлён ✅");
        } catch (e) {
          console.error("updateWidget error:", e);
          setBad(extractError(e));
        }
      });
    }

    init();
  })();
}