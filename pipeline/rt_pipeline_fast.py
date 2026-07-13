# -*- coding: utf-8 -*-
"""
RT-конвейер (клуб gomafia id=101 «Red Tiger Rostov») — БЫСТРАЯ версия + запись в Google Sheet.

Затык старого подхода: getAll(time=all) -> ~374 турнира периода -> детали КАЖДОГО
через POST /api/tournament/get ПОСЛЕДОВАТЕЛЬНО -> потом фильтр до ~35 клубных.
~90% запросов впустую + всё по очереди => 15-20 минут.

Три оптимизации здесь:
  1) ТЯНЕМ ТОЛЬКО РЕЛЕВАНТНОЕ. Набор турниров клуба берём ДЁШЕВО из истории
     профилей всех резидентов (Next-SSR stats/{uid}.json -> serverData.history).
  2) ПАРАЛЛЕЛЬНОСТЬ. Все HTTP — конкурентно, ThreadPoolExecutor + requests.Session.
  3) ИНКРЕМЕНТАЛЬНЫЙ КЭШ на диске. Завершённые турниры (status==completed) неизменны.

Расчёт RT — в модуле calc_core (правила НЕ меняются). После расчёта таблица
пишется в лист RT DATA published-Google-Sheet, откуда её читает виджет.

БОЕВАЯ ОБВЯЗКА (отличия от исследовательской версии):
  * Креды ТОЛЬКО из окружения: MAFRATE_LOGIN / MAFRATE_PASSWORD (в _lib),
    GOOGLE_SA_JSON (service-account JSON целиком одной строкой). Ничего из файлов.
  * Артефакты кэша (tournaments/, mafrate_month_*.json, roster, манифест) — в RT_CACHE_DIR
    (по умолчанию ./.rtcache), НЕ в дерево репозитория.
  * ГАРДЫ перед записью: логин/сеть упали -> исключение -> exit(1), НЕ пишем;
    строк меньше порога -> exit(1), НЕ пишем. Частичная запись исключена.
  * Секреты (пароль, csrf, session, тела ответов, SA-JSON) НИКОГДА не печатаются —
    только статус-коды, числа строк и тайминги.
"""
import os, sys, re, json, time, threading, argparse, io
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

try:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
except Exception:
    pass

import calc_core   # ядро расчёта (правила/ставки/RATING_SEASON_FROM — единый источник)

HERE = os.path.dirname(os.path.abspath(__file__))

# --- каталог кэша: артефакты НЕ пишем в дерево репозитория ---
CACHE_DIR = os.environ.get("RT_CACHE_DIR") or os.path.join(HERE, ".rtcache")
os.makedirs(CACHE_DIR, exist_ok=True)
# кэш деталей турниров: по умолчанию <cache>/tournaments, переопределяется RT_TOURN_DIR
TOURN_DIR = os.environ.get("RT_TOURN_DIR") or os.path.join(CACHE_DIR, "tournaments")
os.makedirs(TOURN_DIR, exist_ok=True)

# =================== КОНФИГ ===================
GOMAFIA = "https://gomafia.pro"
MAFRATE = "https://mafrate.pro"
CLUB_ID = "101"                       # клуб gomafia
POOL = 32                             # размер пула параллельных HTTP
SEASON_FROM = "2026-01-01"            # нижняя граница сезона для ТУРНИРОВ (истории профилей)
TODAY = time.strftime("%Y-%m-%d")     # сегодня (для определения незакрытого месяца)
RATING_SEASON_FROM = calc_core.RATING_SEASON_FROM   # единый источник (одна строка в calc_core)

# --- целевой Google Sheet (публичные идентификаторы, не секрет) ---
SPREADSHEET_ID = os.environ.get("RT_SPREADSHEET_ID", "1wVC4jjUPBmTE9Lh8sWG2q8Iqk8MoVjdp5HFd2u81V_w")
SHEET_NAME = os.environ.get("RT_SHEET_NAME", "RT DATA")
# ГАРД: при исправных данных ожидаем ~32 строки; ниже порога — считаем источник сломанным
MIN_ROWS = int(os.environ.get("RT_MIN_ROWS", "15"))

# Курируемый ОВЕРРАЙД VK-ссылок (vanity-имена типа sava_svoi не выводятся из числового vk_id,
# их приходится задавать руками). Это уже НЕ источник состава: членов берём из живого ростера,
# а VK для тех, кого здесь нет, строим динамически как https://vk.com/id<vk_id> из профиля.
# Ключи — ОТОБРАЖАЕМЫЙ ник (calc_core.display_nick: NICK_OVERRIDE либо логин). Нет vk_id и нет
# оверрайда -> пустая ячейка.
VK_LINKS = {
    "Свой": "https://vk.com/sava_svoi",
    "Price": "https://vk.com/denigo360",
    "Shegan": "https://vk.com/shegan12",
    "Натс": "https://vk.com/your_panacea29",
    "Zhnec": "https://vk.com/id100683962",
    "Бу.Ханка": "https://vk.com/bu1hanka",
    "Videns": "https://vk.com/id328018664",
    "Совесть": "https://vk.com/id475255348",
    "Sun": "https://vk.com/sun_017",
    "Леви": "https://vk.com/id751976771",
    "Detect": "https://vk.com/valeriimilosh",
    "Инга": "https://vk.com/id58511508",
    "Tatle": "https://vk.com/tatlle",
    "Мышь": "https://vk.com/fotinai",
    "Vodomerka": "https://vk.com/nadzzhar",
    "Шальная": "https://vk.com/id411389123",
    "Тигр": "https://vk.com/tigr_stamy_25",
    "Техник": "https://vk.ru/alexey_tehnik",
    "Заба": "https://vk.com/zabaluevakate",
    "Dee": "https://vk.com/id332887684",
    "Актриса": "",
    "Морф": "https://vk.com/id464468281",
    "Йода": "https://vk.com/id305991075",
    "Малинka": "https://vk.com/id7252822",
    "Hanna": "https://vk.com/id388842333",
    "Анталия": "https://vk.ru/id255840349",
    "Хэль": "https://vk.com/id50896975",
    "Vyaza": "https://vk.com/id94632588",
    "Адалин": "https://vk.com/id534137057",
    "Вишенка": "https://vk.com/id358243413",
    "FREESTYLE": "https://vk.com/id310864202",
    "Trouble": "https://vk.ru/jhornojhovanna",
}

# ---------------- счётчики HTTP ----------------
class Counter:
    def __init__(self):
        self.lock = threading.Lock()
        self.by = {}
    def inc(self, kind, n=1):
        with self.lock:
            self.by[kind] = self.by.get(kind, 0) + n
    def total(self):
        return sum(self.by.values())
CNT = Counter()

def new_session():
    s = requests.Session()
    s.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/120 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
    })
    a = requests.adapters.HTTPAdapter(pool_connections=POOL, pool_maxsize=POOL, max_retries=2)
    s.mount("https://", a); s.mount("http://", a)
    return s

# ---------------- gomafia: buildId + Next-SSR + API ----------------
def get_build_id(s):
    r = s.get(GOMAFIA + "/", timeout=30); CNT.inc("discovery")
    m = re.search(r'"buildId":"([^"]+)"', r.text)
    if not m:
        raise RuntimeError("buildId не найден на главной gomafia")
    return m.group(1)

def ssr(s, bid, path, kind="discovery"):
    r = s.get(f"{GOMAFIA}/_next/data/{bid}{path}", timeout=30); CNT.inc(kind)
    r.raise_for_status()
    return r.json()["pageProps"]["serverData"]

def api_post(s, method, payload, kind):
    r = s.post(f"{GOMAFIA}/api/{method}", data=payload, timeout=60); CNT.inc(kind)
    r.raise_for_status()
    return r.json()

# ---------------- Оптимизация 1: дешёвая разведка релевантного набора ----------------
def fetch_residents(s, bid):
    """Резиденты клуба 101 -> roster {uid:{login,elo,city}}. club/101.json?page=N (10/стр)."""
    roster = {}
    first = ssr(s, bid, f"/club/{CLUB_ID}.json?page=1")
    total = int(first.get("residentsTotal") or 0)
    def take(res):
        for r in res or []:
            roster[str(r["id"])] = {"login": r.get("login"), "elo": r.get("elo"), "city": r.get("city")}
    take(first.get("residents"))
    pages = list(range(2, (total + 9) // 10 + 1))
    if pages:
        with ThreadPoolExecutor(max_workers=POOL) as ex:
            futs = {ex.submit(ssr, s, bid, f"/club/{CLUB_ID}.json?page={p}"): p for p in pages}
            for f in as_completed(futs):
                take(f.result().get("residents"))
    return roster

def _history_page(s, bid, uid, page):
    """Одна страница истории профиля. serverData уже содержит user.vk_id — забираем его даром
    (без доп. запросов). Возвращает (uid, page, season_ids, has_more, had_season, vk_id)."""
    sd = ssr(s, bid, f"/stats/{uid}.json?page={page}&id={uid}&period=2026", kind="discovery")
    rows = sd.get("history") or []
    total = int(sd.get("historyTotal") or 0)
    vk_id = str(((sd.get("user") or {}).get("vk_id")) or "").strip()
    season_ids, had_season = set(), 0
    for e in rows:
        if (e.get("date_start") or "") >= SEASON_FROM:
            season_ids.add(str(e["id"])); had_season += 1
    has_more = bool(rows) and page * 10 < total
    return uid, page, season_ids, has_more, had_season, vk_id

def discover_relevant_tournaments(s, bid, roster):
    """Объединение историй всех резидентов (сезон, вкл. star=0) — раундами параллельно.
    Заодно собираем vk_id из serverData каждого профиля (бесплатно). Возвращает (rel, vk_ids)."""
    rel = set()
    vk_ids = {}
    active = list(roster.keys())
    page = 1
    while active:
        with ThreadPoolExecutor(max_workers=POOL) as ex:
            results = list(ex.map(lambda u: _history_page(s, bid, u, page), active))
        nxt = []
        for uid, pg, season_ids, has_more, had_season, vk_id in results:
            rel |= season_ids
            if vk_id and uid not in vk_ids:
                vk_ids[uid] = vk_id
            if has_more and had_season >= 10:
                nxt.append(uid)
        active = nxt
        page += 1
    return rel, vk_ids

# ---------------- Оптимизация 3: кэш деталей турниров ----------------
def tourn_path(tid):
    return os.path.join(TOURN_DIR, f"t{tid}_.json")

def cached_tournament(tid):
    p = tourn_path(tid)
    if not os.path.exists(p):
        return None
    try:
        return json.load(open(p, encoding="utf-8"))
    except Exception:
        return None

def is_completed(doc):
    try:
        return (doc["data"]["tournament"].get("status") == "completed")
    except Exception:
        return False

def fetch_tournament(s, tid):
    doc = api_post(s, "tournament/get", {"id": str(tid)}, kind="detail")
    if doc.get("result") == "success":
        json.dump(doc, open(tourn_path(tid), "w", encoding="utf-8"), ensure_ascii=False)
    return tid, doc

def ensure_tournaments(s, tids, force_all=False):
    """Качаем детали только для отсутствующих в кэше + всегда незавершённые. Параллельно.
       Сетевые/HTTP-ошибки ПРОБРАСЫВАЕМ (f.result()) — чтобы частичная запись была исключена.
       Возвращает (fetched_count, from_cache_count)."""
    to_fetch = []
    from_cache = 0
    for tid in tids:
        doc = None if force_all else cached_tournament(tid)
        if doc is None or not is_completed(doc):
            to_fetch.append(tid)
        else:
            from_cache += 1
    if to_fetch:
        with ThreadPoolExecutor(max_workers=POOL) as ex:
            futs = [ex.submit(fetch_tournament, s, t) for t in to_fetch]
            for f in as_completed(futs):
                f.result()   # пробрасываем ошибку источника -> пайплайн падает до записи
    return len(to_fetch), from_cache

# ---------------- mafrate: месячные рейтинги (cat1) — ДИНАМИЧЕСКИ ----------------
import re as _re

def _iso(d):
    """DD.MM.YYYY -> YYYY-MM-DD (даты со страницы /rating). Иначе вернуть как есть."""
    m = _re.match(r'^(\d{2})\.(\d{2})\.(\d{4})$', d or '')
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else (d or '')

def _strip_html(t):
    return _re.sub(r'<[^>]*>', '', t or '').strip()

def month_key(entry):
    return "%04d-%02d" % (entry["year"], entry["m"])

def month_path(entry):
    # артефакты месяцев — в каталог кэша, не в дерево репозитория
    return os.path.join(CACHE_DIR, f"mafrate_month_{entry['m']}.json")

def fetch_rating_list(s_mf):
    """Список рейтингов клуба со страницы /rating (postFormData). Нормализованные строки
    [{id, title, date_start(iso), date_end(iso)}]. Ничего не хардкодим по месяцам."""
    import parse_standings as ps
    r = s_mf.get(f"{MAFRATE}/rating", timeout=60); CNT.inc("mafrate")
    pfd = ps.extract_postformdata(r.text)["data"]["post_form_data"]
    tbl = (pfd.get("table_rating_list") or {}).get("table_rating_list") or {}
    rows = []
    for v in tbl.values():
        if isinstance(v, dict) and "date_start" in v and "club_id" in v:
            rows.append({"id": str(v.get("id")), "title": _strip_html(v.get("title")),
                         "date_start": _iso(v.get("date_start")), "date_end": _iso(v.get("date_end"))})
    return rows

def fetch_mafrate_month(s_mf, entry):
    """Скачать standings месяца и записать mafrate_month_{m}.json с ВСТРОЕННЫМИ датами."""
    import parse_standings as ps
    rid = entry["rating_id"]
    r = s_mf.get(f"{MAFRATE}/standings/rating/{rid}", timeout=60); CNT.inc("mafrate")
    players, noms, _ = ps.parse(r.text)
    doc = {"label": entry.get("title"), "rating_id": rid, "month": entry["m"], "year": entry["year"],
           "key": month_key(entry), "date_start": entry["date_start"], "date_end": entry["date_end"],
           "players": players, "nominations": noms}
    json.dump(doc, open(month_path(entry), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return entry

def ensure_mafrate_months(force_all=False):
    """Динамически: логин -> список рейтингов клуба -> автоотбор МЕСЯЧНЫХ рейтингов сезона.
    Текущий (незакрытый) ВСЕГДА перезапрашиваем; закрытые — из кэша. Пишем манифест.
    Сетевые ошибки скачивания месяцев ПРОБРАСЫВАЕМ. Возвращает (fetched, from_cache, season_info)."""
    import _lib
    s_mf = _lib.new_session()
    ok, _which, _csrf, _j = _lib.login(s_mf, verbose=False); CNT.inc("mafrate")  # пароль не печатается
    if not ok:
        raise RuntimeError("mafrate login failed")

    ratings = fetch_rating_list(s_mf)
    season = calc_core.select_season_months(ratings, RATING_SEASON_FROM)
    if not season:
        raise RuntimeError("не найдено ни одного месячного рейтинга сезона (>= %s)" % RATING_SEASON_FROM)

    latest = max(season, key=lambda e: e["date_start"])
    current_keys = {month_key(e) for e in season if e["date_end"] >= TODAY} or {month_key(latest)}

    need, from_cache = [], 0
    for e in season:
        e["current"] = month_key(e) in current_keys
        must = force_all or e["current"] or (not os.path.exists(month_path(e)))
        (need.append(e) if must else None)
        if not must:
            from_cache += 1
    if need:
        with ThreadPoolExecutor(max_workers=POOL) as ex:
            futs = [ex.submit(fetch_mafrate_month, s_mf, e) for e in need]
            for f in as_completed(futs):
                f.result()   # пробрасываем ошибку источника -> пайплайн падает до записи

    manifest = {"season_from": RATING_SEASON_FROM, "today": TODAY,
                "months": [{"key": month_key(e), "m": e["m"], "year": e["year"],
                            "rating_id": e["rating_id"], "date_start": e["date_start"],
                            "date_end": e["date_end"], "current": e["current"],
                            "file": os.path.basename(month_path(e)), "title": e["title"]}
                           for e in sorted(season, key=lambda x: x["date_start"])]}
    json.dump(manifest, open(os.path.join(CACHE_DIR, calc_core.MANIFEST_NAME), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    season_info = {"months": [month_key(e) for e in sorted(season, key=lambda x: x["date_start"])],
                   "current": sorted(current_keys)}
    return len(need), from_cache, season_info

# ---------------- vk_id профилей (для динамических VK-ссылок) ----------------
def fetch_vk_id(s, uid):
    """POST /api/stats/get -> vk_id профиля. Фолбэк, если vk_id не пришёл из SSR-разведки
    (напр. в warm-режиме без переразведки). Тело ответа/токены в лог не пишем."""
    try:
        doc = api_post(s, "stats/get", {"id": str(uid)}, kind="vkid")
        return uid, str(((doc.get("data") or {}).get("user") or {}).get("vk_id") or "").strip()
    except Exception:
        return uid, ""

def resolve_vk_links(s, roster, vk_ids, table):
    """Построить {отображаемый_ник: VK-ссылка} для игроков таблицы (RT>0).
    Приоритет: курируемый VK_LINKS (по нику) -> https://vk.com/id<vk_id> из профиля -> "".
    vk_id берём из разведки (SSR, даром); для членов БЕЗ оверрайда, у кого его ещё нет, —
    добираем POST /api/stats/get параллельно (только для них)."""
    display2uid = {calc_core.display_nick(uid, roster): uid for uid in roster}
    need_fetch = []
    for nick, _rt in table:
        if nick in VK_LINKS:
            continue
        uid = display2uid.get(nick)
        if uid and not vk_ids.get(uid):
            need_fetch.append(uid)
    if need_fetch:
        with ThreadPoolExecutor(max_workers=POOL) as ex:
            for uid, vid in ex.map(lambda u: fetch_vk_id(s, u), need_fetch):
                if vid:
                    vk_ids[uid] = vid
    links = {}
    for nick, _rt in table:
        if nick in VK_LINKS:
            links[nick] = VK_LINKS[nick]
            continue
        uid = display2uid.get(nick)
        vid = vk_ids.get(uid) if uid else None
        links[nick] = ("https://vk.com/id%s" % vid) if vid else ""
    return links

# ---------------- прогон ----------------
ROSTER_PATH = os.path.join(CACHE_DIR, "roster101.json")
IDSET_PATH = os.path.join(TOURN_DIR, "_relevant_ids.json")   # кэш набора релевантных турниров
VKIDS_PATH = os.path.join(CACHE_DIR, "vk_ids.json")          # кэш vk_id профилей (из SSR-разведки)

def run(mode="cold"):
    cold = (mode == "cold")
    CNT.by.clear()
    t0 = time.perf_counter()
    s = new_session()

    can_reuse = (not cold) and os.path.exists(IDSET_PATH) and os.path.exists(ROSTER_PATH)
    t_disc0 = time.perf_counter()
    if can_reuse:
        roster = json.load(open(ROSTER_PATH, encoding="utf-8"))
        relevant = set(json.load(open(IDSET_PATH, encoding="utf-8")))
        vk_ids = json.load(open(VKIDS_PATH, encoding="utf-8")) if os.path.exists(VKIDS_PATH) else {}
        rediscovered = False
    else:
        bid = get_build_id(s)
        roster = fetch_residents(s, bid)
        json.dump(roster, open(ROSTER_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        relevant, vk_ids = discover_relevant_tournaments(s, bid, roster)
        json.dump(sorted(relevant, key=int), open(IDSET_PATH, "w", encoding="utf-8"))
        json.dump(vk_ids, open(VKIDS_PATH, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        rediscovered = True
    t_disc = time.perf_counter() - t_disc0

    t_det0 = time.perf_counter()
    fetched, cachehit = ensure_tournaments(s, sorted(relevant, key=int), force_all=cold)
    t_det = time.perf_counter() - t_det0

    t_mf0 = time.perf_counter()
    mf_fetched, mf_cache, season_info = ensure_mafrate_months(force_all=cold)
    t_mf = time.perf_counter() - t_mf0

    # ---- расчёт (логика в calc_core, НЕ меняется) ----
    t_calc0 = time.perf_counter()
    table = calc_core.compute_table(TOURN_DIR, CACHE_DIR, ROSTER_PATH)
    t_calc = time.perf_counter() - t_calc0

    # ---- динамические VK-ссылки (оверрайд VK_LINKS -> vk.com/id<vk_id> из профиля) ----
    vk_links = resolve_vk_links(s, roster, vk_ids, table)

    wall = time.perf_counter() - t0
    return {
        "mode": mode,
        "rediscovered": rediscovered,
        "residents": len(roster),
        "relevant_tournaments": len(relevant),
        "details_fetched": fetched,
        "details_from_cache": cachehit,
        "mafrate_fetched": mf_fetched,
        "mafrate_from_cache": mf_cache,
        "season_months": season_info["months"],
        "season_current": season_info["current"],
        "http_by": dict(CNT.by),
        "http_total": CNT.total(),
        "timings": {"discovery": round(t_disc, 2), "details": round(t_det, 2),
                    "mafrate": round(t_mf, 2), "calc": round(t_calc, 3), "wall": round(wall, 2)},
        "table": table,
        "vk_links": vk_links,
    }

# ---------------- запись в Google Sheet (RT DATA) ----------------
def build_rows(table, vk_links):
    """table [(nick, rt), ...] (уже отсортирована по RT убыв.) -> строки данных [[Nick, VK, RT], ...].
    VK берём из динамически построенной карты vk_links (оверрайд VK_LINKS + vk.com/id<vk_id>).
    Пишем только игроков с RT > 0 (это же ГАРД: сломанный источник обнуляет RT -> строк < порога)."""
    return [[nick, vk_links.get(nick, ""), rt] for nick, rt in table if rt and rt > 0]


# --- Аватарки игроков (бонус-фича для публичной HTML-таблицы; НИКОГДА не роняет запись RT) ---
VK_API_VERSION = "5.199"

def _vk_identifier(link):
    """Из VK-ссылки достаём идентификатор для users.get:
    vk.com/id123 -> 'id123', vk.com/shortname -> 'shortname'. Пусто/не vk -> None."""
    if not link:
        return None
    m = re.search(r"vk\.com/([A-Za-z0-9_]+)", link.strip())
    return m.group(1) if m else None

def resolve_avatars(nick_links):
    """nick_links: [(nick, vk_link), ...] -> {nick: photo_url}. ОДИН батч users.get
    сервисным токеном из VK_SERVICE_TOKEN. Сопоставление ответа — по возвращённому
    id / screen_name / domain, НЕ позиционно (deactivated остаются в ответе без фото).
    Токен и request-url в лог НЕ пишем. Любой сбой -> {} (запись RT не страдает)."""
    token = os.environ.get("VK_SERVICE_TOKEN")
    if not token:
        print("[avatars] VK_SERVICE_TOKEN не задан — пишу без аватарок")
        return {}

    req = []  # [(nick, ident)] — только непустые VK-ссылки
    for nick, link in nick_links:
        ident = _vk_identifier(link)
        if ident:
            req.append((nick, ident))
    if not req:
        return {}

    try:
        resp = requests.get(
            "https://api.vk.com/method/users.get",
            params={"user_ids": ",".join(i for _, i in req),
                    "fields": "photo_200,screen_name,domain",
                    "v": VK_API_VERSION, "access_token": token},
            timeout=30,
        )
        data = resp.json()
    except Exception as e:
        print("[avatars] users.get не удался: %s: %s — пишу без аватарок" % (type(e).__name__, e))
        return {}

    if isinstance(data, dict) and "error" in data:
        # НЕ печатаем error целиком: там request_params с токеном
        print("[avatars] users.get вернул error code=%s — пишу без аватарок"
              % (data.get("error", {}) or {}).get("error_code"))
        return {}

    # ответ -> {ключ: photo}, ключи и по числовому id, и по screen_name/domain (lower)
    photo_by_key = {}
    for u in (data.get("response") or []):
        if u.get("deactivated") or not u.get("photo_200"):
            continue
        photo_by_key[str(u.get("id"))] = u["photo_200"]
        for k in (u.get("screen_name"), u.get("domain")):
            if k:
                photo_by_key[k.lower()] = u["photo_200"]

    out = {}
    for nick, ident in req:
        m = re.fullmatch(r"id(\d+)", ident)
        key = m.group(1) if m else ident.lower()
        photo = photo_by_key.get(key)
        if photo:
            out[nick] = photo

    print("[avatars] резолвлено %d из %d ссылок" % (len(out), len(req)))
    return out

# --- avatars.json: аватарки едут в репо/GitHub Pages, НЕ через закрытый лист-лидерборд ---
AVATARS_JSON = os.path.join(os.path.dirname(HERE), "avatars.json")

def write_avatars_json(table, vk_links):
    """Резолвит аватарки и пишет {nick: photo_url} в avatars.json в корне репо
    (его коммитит workflow; публичная страница мёржит по нику). Бонус-фича:
    любой сбой не роняет прогон, а пустой результат НЕ затирает существующий файл."""
    try:
        needed = [(nick, vk_links.get(nick, "")) for nick, rt in table if rt and rt > 0]
        avatars = resolve_avatars(needed)
        if not avatars:
            print("[avatars] пусто (нет токена/резолвов) — avatars.json не трогаю")
            return 0
        with io.open(AVATARS_JSON, "w", encoding="utf-8") as f:
            json.dump(avatars, f, ensure_ascii=False, indent=2, sort_keys=True)
        print("[avatars] avatars.json обновлён: %d фото" % len(avatars))
        return len(avatars)
    except Exception as e:
        print("[avatars] запись avatars.json не удалась: %s: %s" % (type(e).__name__, e))
        return 0

def _gs_worksheet():
    """Авторизация по service-account из GOOGLE_SA_JSON (не из файла). Содержимое SA не печатается."""
    import gspread
    from google.oauth2.service_account import Credentials
    raw = os.environ.get("GOOGLE_SA_JSON")
    if not raw:
        raise RuntimeError("GOOGLE_SA_JSON не задан в окружении")
    try:
        info = json.loads(raw)
    except ValueError:
        raise RuntimeError("GOOGLE_SA_JSON не является валидным JSON")
    scopes = ["https://www.googleapis.com/auth/spreadsheets"]
    creds = Credentials.from_service_account_info(info, scopes=scopes)
    gc = gspread.authorize(creds)
    sh = gc.open_by_key(SPREADSHEET_ID)
    return sh.worksheet(SHEET_NAME)

def write_to_sheet(table, vk_links):
    """ГАРД + идемпотентная запись в лист RT DATA. Возвращает число записанных строк данных.
    Гард на логин/сеть отработал раньше (run() уже бросил бы исключение до сюда)."""
    data = build_rows(table, vk_links)
    if len(data) < MIN_ROWS:
        raise RuntimeError("ГАРД: итоговых строк %d < порога %d — источник считаем сломанным, "
                           "запись отменена" % (len(data), MIN_ROWS))
    ws = _gs_worksheet()
    rows = [["Nick", "VK", "RT"]] + data
    ws.batch_clear(["A1:C1000"])                       # идемпотентно: чистим прежний диапазон
    ws.update(range_name="A1", values=rows)            # затем пишем актуальные строки
    print("RT DATA обновлён: записано %d строк данных (+заголовок) в лист '%s'"
          % (len(data), SHEET_NAME))
    return len(data)

# ---------------- контрольная сверка (только для локального теста, НЕ гейтит запись) ----------------
CONTROL = [
    ("Свой",408),("Price",193),("Shegan",174),("Натс",161),("Zhnec",159),("Бу.Ханка",104),
    ("Videns",94),("Совесть",94),("Sun",85),("Леви",78),("Detect",72),("Инга",53),("Tatle",52),
    ("Мышь",46),("Vodomerka",40),("Шальная",31),("Тигр",28),("Техник",25),("Заба",22),("Dee",20),
    ("Актриса",16),("Морф",14),("Йода",12),("Малинka",12),("Hanna",11),("Анталия",10),("Хэль",10),
    ("Vyaza",8),("Адалин",7),("Вишенка",6),("FREESTYLE",4),("Trouble",4),
]

def verify(table):
    got = {n: rt for n, rt in table}
    ok = True
    print("\n%-14s %6s %6s %s" % ("Ник", "расчёт", "эталон", ""))
    for n, rt in CONTROL:
        g = got.get(n)
        mark = "OK" if (g is not None and abs(g - rt) < 1e-6) else "  <<< РАСХОЖДЕНИЕ"
        if mark != "OK":
            ok = False
        print("%-14s %6s %6s  %s" % (n, ("%g" % g if g is not None else "—"), rt, mark))
    extra = [n for n, _ in table if n not in dict(CONTROL)]
    if extra:
        ok = False
        print("ЛИШНИЕ игроки в расчёте:", extra)
    print("\nИТОГ СВЕРКИ:", "СОВПАДАЕТ с контрольной таблицей (32 игрока)" if ok else "ЕСТЬ РАСХОЖДЕНИЯ")
    return ok

def _print_summary(res):
    print("=" * 72)
    print("РЕЖИМ:", res["mode"].upper(), "| разведка профилей:",
          "ДА" if res["rediscovered"] else "нет (набор из кэша)")
    print("резидентов:", res["residents"], "| релевантных турниров:", res["relevant_tournaments"])
    print("детали: скачано %d, из кэша %d" % (res["details_fetched"], res["details_from_cache"]))
    print("mafrate месяцы:", res["season_months"], "| текущий (перезапрос):", res["season_current"])
    print("mafrate: скачано %d, из кэша %d" % (res["mafrate_fetched"], res["mafrate_from_cache"]))
    print("HTTP по типам:", res["http_by"], "| ВСЕГО HTTP:", res["http_total"])
    print("тайминги (сек):", res["timings"])

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="RT-конвейер: расчёт + запись в лист RT DATA")
    ap.add_argument("--mode", choices=["cold", "warm"], default="cold")
    ap.add_argument("--evict", default=None, help="warm: id турнира, удалить из кэша (имитация нового события)")
    ap.add_argument("--no-write", action="store_true", help="только расчёт, без записи в таблицу (dry-run)")
    ap.add_argument("--verify", action="store_true", help="печатать контрольную сверку (для локального теста)")
    args = ap.parse_args()

    if args.mode == "warm" and args.evict:
        p = tourn_path(args.evict)
        if os.path.exists(p):
            os.remove(p)
            print(f"[warm] выселен из кэша турнир {args.evict} (имитация нового события)")

    try:
        res = run(args.mode)
        _print_summary(res)
        if args.verify:
            verify(res["table"])
        if args.no_write:
            data = build_rows(res["table"], res["vk_links"])
            print("DRY-RUN: запись пропущена; к записи готово %d строк данных" % len(data))
            print("VK-ссылок построено: %d (из них курируемых оверрайдов %d)"
                  % (sum(1 for v in res["vk_links"].values() if v),
                     sum(1 for n in res["vk_links"] if n in VK_LINKS)))
        else:
            write_to_sheet(res["table"], res["vk_links"])
            write_avatars_json(res["table"], res["vk_links"])
    except Exception as e:
        # понятное сообщение БЕЗ секретов; ненулевой код -> джоб GitHub Actions падает
        print("ОШИБКА КОНВЕЙЕРА: %s: %s" % (type(e).__name__, e), file=sys.stderr)
        sys.exit(1)
