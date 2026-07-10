// app.js — CSV версия (без Apps Script, без JSONP, без Cloudflare)
// Источник: опубликованная таблица Google Sheets (pub -> output=csv)

if (window.__RT_WIDGET_APP_LOADED__) {
  console.warn("RT widget app already loaded");
} else {
  window.__RT_WIDGET_APP_LOADED__ = true;

  (() => {
    const VERSION = '1.0.15';
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

    const btnUpdate = document.getElementById('btnUpdate');
    const btnSheet = document.getElementById('btnSheet');
    const btnGithub = document.getElementById('btnGithub');

    const state = document.getElementById('state');
    const dataView = document.getElementById('dataView');
    const codeView = document.getElementById('codeView');

    // === ТВОЯ опубликованная таблица ===
    // https://docs.google.com/spreadsheets/d/e/<PUB_ID>/pubhtml?gid=0&single=true
    const PUB_ID = "2PACX-1vRWC87JHjXGFuyoDwB3iyJLPkzExdiwRwxZu2SKpHv-G1t3oeGE4Kxu35ne0PgJbHWxqaVGq-28kfRE";
    const SHEET_GID = 0;
    const LIMIT = 10;

    // Редактируемая Google-таблица (куда админ вносит ники и RT).
    // Не путать с PUB_ID — это опубликованная (read-only) версия для чтения CSV.
    const SHEET_EDIT_URL = "https://docs.google.com/spreadsheets/d/1wVC4jjUPBmTE9Lh8sWG2q8Iqk8MoVjdp5HFd2u81V_w/edit?gid=1760608021#gid=1760608021";
    if (btnSheet) btnSheet.href = SHEET_EDIT_URL;

    // GitHub Actions workflow, который пересчитывает таблицу из mafrate/gomafia.
    // Кнопка ведёт на страницу запуска — админ жмёт там "Run workflow".
    // Прямой запуск из клиента невозможен: нужен токен, а его нельзя держать в публичном коде.
    const GITHUB_WORKFLOW_URL = "https://github.com/kioflex12/vk-widget-table-rt/actions/workflows/update-rt.yml";
    if (btnGithub) btnGithub.href = GITHUB_WORKFLOW_URL;

    let groupId = null;
    let appId = null;
    let communityToken = null;
    let loaded = null;
    let loadedTotal = 0;

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

    function setInfo(text) {
      state.innerHTML = '<span class="info"><span class="spinner"></span>' + escapeHtml(text) + '</span>';
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

    function buildWidgetObject(rows, totalCount) {
      const head = [
        { text: '№', align: 'center' },
        { text: 'Игрок' },
        { text: 'RT', align: 'center' }
      ];

      const body = rows.slice(0, LIMIT).map(r => {
        // Топ-3 показываем медалью вместо номера (как в публичной таблице), остальные — числом.
        const placeNum = Number(r.place);
        const placeText = MEDALS[placeNum] || String(r.place || '');
        const placeCell = { text: placeText, align: 'center' };

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

      // Счётчик общего числа участников рядом с заголовком.
      if (totalCount && totalCount > 0) {
        widget.title_counter = totalCount;
      }

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
        const avatar = (table[i][3] ?? '').toString().trim();

        if (!nick) continue;

        parsed.push({
          place: String(parsed.length + 1),
          nick,
          vk,
          rt,
          avatar
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
      const allRows = parseRows(table, null);
      const parsed = allRows.slice(0, LIMIT);

      if (parsed.length === 0) {
        throw new Error("В таблице нет данных. Ожидаю колонки: A=Nick, B=VK, C=RT.");
      }

      loaded = parsed;
      loadedTotal = allRows.length;

      if (dataView) dataView.textContent = JSON.stringify({ rows: loaded }, null, 2);
      const widget = buildWidgetObject(loaded, loadedTotal);
      if (codeView) codeView.textContent = buildCode(widget);
      renderWidgetPreview(loaded, loadedTotal);
    }

    const MEDALS = ['', '\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'];

    // --- \u0410\u0432\u0430\u0442\u0430\u0440\u043A\u0438 \u0438\u0433\u0440\u043E\u043A\u043E\u0432 (\u0442\u043E\u043B\u044C\u043A\u043E \u0432 \u043F\u0443\u0431\u043B\u0438\u0447\u043D\u043E\u0439 \u0442\u0430\u0431\u043B\u0438\u0446\u0435, \u041D\u0415 \u0432 VK-\u0432\u0438\u0434\u0436\u0435\u0442\u0435) ---
    // \u0420\u0435\u0430\u043B\u044C\u043D\u043E\u0435 \u0444\u043E\u0442\u043E \u043F\u0440\u0438\u0445\u043E\u0434\u0438\u0442 \u0438\u0437 \u043A\u043E\u043B\u043E\u043D\u043A\u0438 D \u043B\u0438\u0441\u0442\u0430 (URL VK-CDN, *.userapi.com).
    // \u0415\u0441\u043B\u0438 \u0441\u0441\u044B\u043B\u043A\u0438 \u043D\u0435\u0442 \u0438\u043B\u0438 \u043E\u043D\u0430 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430 \u2014 \u0440\u0438\u0441\u0443\u0435\u043C \u043A\u0440\u0443\u0436\u043E\u043A \u0441 \u043F\u0435\u0440\u0432\u043E\u0439 \u0431\u0443\u043A\u0432\u043E\u0439 \u043D\u0438\u043A\u0430.

    // \u0420\u0430\u0437\u0440\u0435\u0448\u0430\u0435\u043C \u0442\u043E\u043B\u044C\u043A\u043E \u0445\u043E\u0441\u0442 VK-CDN: \u0438\u043D\u0430\u0447\u0435 \u0447\u0435\u0440\u0435\u0437 \u043F\u043E\u0440\u0447\u0443 \u044F\u0447\u0435\u0439\u043A\u0438 \u0432 <img src>
    // \u043C\u043E\u0436\u043D\u043E \u043F\u043E\u0434\u0441\u0443\u043D\u0443\u0442\u044C \u043F\u0440\u043E\u0438\u0437\u0432\u043E\u043B\u044C\u043D\u044B\u0439 \u0441\u0442\u043E\u0440\u043E\u043D\u043D\u0438\u0439/\u0442\u0440\u0435\u043A\u0438\u043D\u0433\u043E\u0432\u044B\u0439 URL.
    function isAvatarUrl(u) {
      try {
        const host = new URL(u).hostname.replace(/^www\./, '');
        return host === 'userapi.com' || host.endsWith('.userapi.com');
      } catch { return false; }
    }

    // \u0421\u0442\u0430\u0431\u0438\u043B\u044C\u043D\u044B\u0439 \u0446\u0432\u0435\u0442 \u043A\u0440\u0443\u0436\u043A\u0430 \u0438\u0437 \u043D\u0438\u043A\u0430 (\u043E\u0434\u0438\u043D \u043D\u0438\u043A -> \u043E\u0434\u0438\u043D \u0446\u0432\u0435\u0442).
    function avatarHue(nick) {
      let h = 0;
      for (let i = 0; i < nick.length; i++) h = (h * 31 + nick.charCodeAt(i)) % 360;
      return h;
    }

    function buildInitialAvatar(nick) {
      const span = document.createElement('span');
      span.className = 'avatar avatar-initial';
      span.textContent = ((nick || '').trim()[0] || '?').toUpperCase();
      span.style.backgroundColor = 'hsl(' + avatarHue(nick || '') + ', 55%, 52%)';
      span.setAttribute('aria-hidden', 'true');
      return span;
    }

    // \u0410\u0432\u0430\u0442\u0430\u0440 \u0438\u0433\u0440\u043E\u043A\u0430: \u0444\u043E\u0442\u043E (\u0432\u0430\u043B\u0438\u0434\u043D\u044B\u0439 VK-CDN URL) \u0441 \u0444\u043E\u043B\u0431\u044D\u043A\u043E\u043C \u043D\u0430 \u043A\u0440\u0443\u0436\u043E\u043A-\u0438\u043D\u0438\u0446\u0438\u0430\u043B.
    function buildAvatar(r) {
      if (isAvatarUrl(r.avatar)) {
        const img = document.createElement('img');
        img.className = 'avatar avatar-img';
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.src = r.avatar; // \u0447\u0435\u0440\u0435\u0437 \u0441\u0432\u043E\u0439\u0441\u0442\u0432\u043E, \u043D\u0435 innerHTML
        img.addEventListener('error', () => img.replaceWith(buildInitialAvatar(r.nick)));
        return img;
      }
      return buildInitialAvatar(r.nick);
    }

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
        const cell = document.createElement('span');
        cell.className = 'player-cell';
        cell.appendChild(buildAvatar(r));

        const url = buildProfileUrl(r.vk);
        if (url) {
          const a = document.createElement('a');
          a.href = url;
          a.target = '_blank';
          a.rel = 'noopener';
          a.textContent = r.nick;
          cell.appendChild(a);
        } else {
          const nameEl = document.createElement('span');
          nameEl.textContent = r.nick;
          cell.appendChild(nameEl);
        }
        tdPlayer.appendChild(cell);

        const tdRt = document.createElement('td');
        tdRt.className = 'col-rt';
        tdRt.textContent = r.rt;

        tr.append(tdPlace, tdPlayer, tdRt);
        publicBody.appendChild(tr);
      });

      publicLoading.style.display = 'none';
      publicTable.style.display = '';
    }

    // Превью того, как VK-виджет (type: table) выглядит в сообществе.
    // Повторяет buildWidgetObject: заголовок, № / Игрок / RT, до LIMIT строк, "Показать всё".
    function renderWidgetPreview(rows, totalCount) {
      const host = document.getElementById('widgetPreview');
      if (!host) return;

      host.classList.remove('widget-preview-empty');
      host.innerHTML = '';

      const card = document.createElement('div');
      card.className = 'wp-card';

      const title = document.createElement('div');
      title.className = 'wp-title';
      title.textContent = 'Итоговая таблица RT';
      if (totalCount && totalCount > 0) {
        const counter = document.createElement('span');
        counter.className = 'wp-title-counter';
        counter.textContent = totalCount;
        title.appendChild(counter);
      }
      card.appendChild(title);

      const table = document.createElement('table');
      table.className = 'wp-table';

      const thead = document.createElement('thead');
      const htr = document.createElement('tr');
      [['№', 'wp-c'], ['Игрок', ''], ['RT', 'wp-c']].forEach(([t, cls]) => {
        const th = document.createElement('th');
        if (cls) th.className = cls;
        th.textContent = t;
        htr.appendChild(th);
      });
      thead.appendChild(htr);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      rows.slice(0, LIMIT).forEach(r => {
        const tr = document.createElement('tr');
        const placeNum = Number(r.place);

        const tdPlace = document.createElement('td');
        tdPlace.className = 'wp-c';
        tdPlace.innerHTML = MEDALS[placeNum] ? '<span class="place-medal">' + MEDALS[placeNum] + '</span>' : escapeHtml(r.place);

        const tdPlayer = document.createElement('td');
        const url = buildProfileUrl(r.vk);
        if (url) {
          const a = document.createElement('a');
          a.href = url;
          a.target = '_blank';
          a.rel = 'noopener';
          a.textContent = r.nick;
          tdPlayer.appendChild(a);
        } else {
          tdPlayer.textContent = r.nick;
        }

        const tdRt = document.createElement('td');
        tdRt.className = 'wp-c';
        tdRt.textContent = r.rt;

        tr.append(tdPlace, tdPlayer, tdRt);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      card.appendChild(table);

      if (appId) {
        const more = document.createElement('div');
        more.className = 'wp-more';
        more.textContent = 'Показать всё';
        card.appendChild(more);
      }

      host.appendChild(card);
    }

    // Фото-аватарки приходят отдельным файлом avatars.json (репо/GitHub Pages),
    // а НЕ из закрытого листа-лидерборда. Мёржим по нику; сбой не критичен ->
    // остаются кружки-инициалы. Хост URL всё равно проверяется в buildAvatar.
    async function applyAvatars(rows) {
      try {
        const resp = await fetch('./avatars.json?t=' + Date.now(), { cache: 'no-store' });
        if (!resp.ok) return;
        const map = await resp.json();
        if (!map || typeof map !== 'object') return;
        rows.forEach(r => {
          const url = map[r.nick];
          if (typeof url === 'string') r.avatar = url;
        });
      } catch { /* нет файла / битый JSON -> инициалы */ }
    }

    async function loadPublicView() {
      try {
        const table = await fetchCsv();
        const allRows = parseRows(table, null);
        if (allRows.length === 0) {
          throw new Error("В таблице нет данных.");
        }
        await applyAvatars(allRows);
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
        if (!communityToken) throw new Error("Нет токена сообщества.");
        if (!loaded) await loadData();

        const widget = buildWidgetObject(loaded, loadedTotal);
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

      // VKWebAppInit — не блокируем UI, отправляем и не ждём
      if (bridge) {
        bridge.send('VKWebAppInit').catch(e => console.warn('VKWebAppInit failed:', e));
      }

      // Режим: если есть group_id — админ-панель, иначе — публичная таблица
      if (groupId) {
        publicView.style.display = 'none';
        adminView.style.display = '';
      } else {
        loadPublicView();
        return;
      }

      // Одна кнопка: токен → загрузка данных → обновление виджета, по очереди.
      let running = false;

      async function runFullUpdate() {
        if (running) return;
        running = true;
        const label = btnUpdate ? btnUpdate.textContent : '';
        if (btnUpdate) {
          btnUpdate.disabled = true;
          btnUpdate.innerHTML = '<span class="spinner"></span>Обновляю…';
        }
        try {
          if (!groupId || !appId) {
            setBad("Открой мини-приложение из сообщества (как админ) — нет group_id.");
            return;
          }

          setInfo("1/3 · Получаю токен…");
          const res = await bridge.send('VKWebAppGetCommunityAuthToken', {
            app_id: appId,
            group_id: groupId,
            scope: 'app_widget'
          });
          communityToken = res.access_token;

          setInfo("2/3 · Загружаю данные из таблицы…");
          await loadData();

          setInfo("3/3 · Обновляю виджет…");
          await updateWidget();

          setOk("Готово · виджет обновлён ✅");
        } catch (e) {
          console.error("runFullUpdate error:", e);
          setBad(extractError(e));
        } finally {
          running = false;
          if (btnUpdate) {
            btnUpdate.disabled = false;
            btnUpdate.textContent = label;
          }
        }
      }

      btnUpdate?.addEventListener('click', runFullUpdate);

      // Превью подтягивает данные из таблицы при первом раскрытии (токен не нужен — читаем CSV).
      const previewBox = document.getElementById('previewBox');
      let previewLoading = false;
      previewBox?.addEventListener('toggle', async () => {
        if (!previewBox.open || loaded || previewLoading) return;
        previewLoading = true;
        try {
          await loadData();
        } catch (e) {
          const host = document.getElementById('widgetPreview');
          if (host) host.textContent = 'Не удалось загрузить превью: ' + extractError(e);
        } finally {
          previewLoading = false;
        }
      });
    }

    init().catch(e => console.error('init error:', e));
  })();
}