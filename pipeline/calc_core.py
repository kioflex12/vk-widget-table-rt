# -*- coding: utf-8 -*-
"""Reconstruction of the club-RT calculation for gomafia club id=101 "Red Tiger Rostov".

Reproduces the control leaderboard (nick -> RT) EXACTLY from cached data using stdlib only.

Data model
----------
Two independent point sources are summed per person:

  cat1  -- monthly "mafrate" club ratings (files mafrate_month_{m}.json). The set of months
           is chosen DYNAMICALLY (see select_season_months / _resolve_month_files): full
           calendar-month ratings with date_start >= RATING_SEASON_FROM. Jan/Feb are excluded
           by that bound; new months (July, Aug, …) are picked up automatically, no code edits.
           score = place-points (3-star, column-40 table) + 3 per role/other nomination
                   + 5 if "MVP турнира" that month.

  cat2-4 / attest -- gomafia tournament results (files tournaments/t{ID}_.json).
           Each cached tournament is categorised (see categorize()) and scored:
             kat2         : 2*global_game  + 6/role nomination + 10 MVP   (star>0, gg-rated)
             kat3         : place 1/2/3 -> 15/10/5 + 2/nom + 4 MVP         (Тигран/Савелий minicaps)
             kat4_otbor   : place 1-2 -> 15 + 4/nom + 7 MVP                (Лига Юга серия, FSM отборы)
             kat4_quarter : place 1-5 -> 20 + 4/nom + 7 MVP                (Лига Юга 1/4 финала)
             attest       : col-40 place-points + 3/nom + 5 MVP           (аттестационные, scored like a month)

Rules
-----
  * Only roster101 members score (plus the four merge "second accounts", folded into the primary).
  * No-org rule (generalised): in any scored tournament a club player whose uid == creator.id
    gets 0 from that tournament.  (In practice only Тигр/1000 is ever a club organizer, of 2859 & 3041.)
  * Identity merges (one human, several accounts): the second account's events are folded onto the
    primary uid; if both accounts appear in the SAME event only the better position is counted.
    In the cached data the second accounts appear only in mafrate months (never in gomafia),
    so gomafia has no overlap and cat1 merges take the best month_total per rating-month.
  * Exclusions: "Red Tiger Stars" (2621) -- annual final -- is dropped entirely.
"""
import json
import os
import collections

# ---------------------------------------------------------------- constants
# 3-star place-points, column 40 (used by cat1 monthly ratings AND attestational tournaments)
PLACE_POINTS = {1: 33, 2: 29, 3: 26, 4: 22, 5: 20, 6: 18, 7: 16, 8: 14,
                9: 12, 10: 10, 11: 8, 12: 6, 13: 4, 14: 3}

# --- cat1 (mafrate monthly ratings) config ---------------------------------
# Клубное правило: в зачёт идут ТОЛЬКО полноценные МЕСЯЧНЫЕ рейтинги с марта и позже.
# Январь/февраль вне зачёта. Месяцы НЕ хардкодятся: конкретный набор определяется на
# лету по списку рейтингов mafrate (см. конвейер) и передаётся сюда манифестом.
# Изменить сезон — ОДНОЙ строкой ниже; новые месяцы (июль, август…) подхватятся сами.
RATING_SEASON_FROM = '2026-03-01'   # нижняя граница сезона для месячных рейтингов
MANIFEST_NAME = 'mafrate_season.json'   # манифест отобранных месяцев (пишет конвейер)
MVP_NOM_NAME = 'MVP турнира'        # mafrate MVP nomination label
NOM_ROLES = ['best_red', 'best_mafia', 'best_don', 'best_sheriff']   # gomafia role nominations


def is_full_month(date_start_iso, date_end_iso):
    """True, если рейтинг покрывает ПОЛНЫЙ календарный месяц (1-е число .. конец месяца),
    а не однодневный миникап/марафон. date_*_iso в формате YYYY-MM-DD."""
    import datetime
    try:
        a = datetime.date.fromisoformat(date_start_iso)
        b = datetime.date.fromisoformat(date_end_iso)
    except (TypeError, ValueError):
        return False
    return a.day == 1 and (b - a).days >= 26 and a.month == b.month


def select_season_months(ratings, season_from=None):
    """Из нормализованного списка рейтингов клуба отобрать зачётные МЕСЯЧНЫЕ рейтинги сезона.

    ratings: список dict с ключами id, title, date_start, date_end (даты в ISO YYYY-MM-DD).
    Возвращает список {'m','year','rating_id','date_start','date_end','title'}, отсортированный
    по дате. Правило: date_start >= season_from И полный календарный месяц. Ничего не хардкодим
    по номерам месяцев — новые месяцы попадают автоматически.
    """
    season_from = season_from or RATING_SEASON_FROM
    out = []
    for r in ratings:
        ds = r.get('date_start'); de = r.get('date_end')
        if not ds or ds < season_from:
            continue
        if not is_full_month(ds, de):
            continue
        out.append({'m': int(ds[5:7]), 'year': int(ds[:4]), 'rating_id': str(r.get('id')),
                    'date_start': ds, 'date_end': de, 'title': r.get('title')})
    out.sort(key=lambda x: x['date_start'])
    return out

# identity merges: primary uid -> [secondary uid(s)] (same human, extra account).
# The primary uid is the roster101 member; the secondary account carries extra rating history.
MERGES = collections.OrderedDict([
    ('1547', ['6281']),   # Shegan
    ('3788', ['2691']),   # Dee
    ('4758', ['2757']),   # Йода / Yoda
    ('7313', ['2025']),   # Мышь
    ('3971', ['3732']),   # Анталия (roster account 3971 "Антaлия" + rating account 3732 "Анталия")
])
SECONDARY_TO_PRIMARY = {s: p for p, ss in MERGES.items() for s in ss}

# control nick -> primary uid (32 players)
IDENTITY = collections.OrderedDict([
    ('Свой', '4403'), ('Price', '3987'), ('Shegan', '1547'), ('Натс', '4418'),
    ('Zhnec', '5204'), ('Бу.Ханка', '3847'), ('Videns', '9390'), ('Совесть', '6562'),
    ('Sun', '6978'), ('Леви', '8876'), ('Detect', '446'), ('Инга', '3806'),
    ('Tatle', '4113'), ('Мышь', '7313'), ('Vodomerka', '8468'), ('Шальная', '1064'),
    ('Тигр', '1000'), ('Техник', '1049'), ('Заба', '7261'), ('Dee', '3788'),
    ('Актриса', '1050'), ('Морф', '3765'), ('Йода', '4758'), ('Малинka', '1069'),
    ('Hanna', '5130'), ('Анталия', '3971'), ('Хэль', '3873'), ('Vyaza', '3733'),
    ('Адалин', '3673'), ('Вишенка', '1028'), ('FREESTYLE', '4757'), ('Trouble', '7683'),
])


# ---------------------------------------------------------------- helpers
def _fnum(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def place_pts(place):
    try:
        p = int(place)
    except (TypeError, ValueError):
        return 0
    return PLACE_POINTS.get(p, 0)


def merged_standings(data):
    """user_id -> {'place', 'gg'} ; base = without_final, overridden by with_final."""
    m = {}
    for r in (data.get('tournament_result_without_final') or []):
        m[str(r.get('user_id'))] = {'place': r.get('place'), 'gg': _fnum(r.get('global_game'))}
    for r in (data.get('tournament_result_with_final') or []):
        m[str(r.get('user_id'))] = {'place': r.get('place'), 'gg': _fnum(r.get('global_game'))}
    return m


def noms_winners(data):
    """user_id -> {'roles': [...], 'mvp': bool} ; winner = first element of each nomination list."""
    noms = data.get('nominations') or {}
    res = collections.defaultdict(lambda: {'roles': [], 'mvp': False})
    for k in NOM_ROLES + ['mvp']:
        lst = noms.get(k) or []
        if lst:
            uid = str((lst[0].get('user') or {}).get('id'))
            if k == 'mvp':
                res[uid]['mvp'] = True
            else:
                res[uid]['roles'].append(k)
    return res


# ---------------------------------------------------------------- categorisation
def categorize(data):
    """Return category string ('kat2'|'kat3'|'kat4_otbor'|'kat4_quarter'|'attest') or None.

    `data` is the inner object of t{ID}_.json (has 'tournament' and 'creator').
    Data-driven from star / is_use_gg_rating / is_fsm_rating / creator.id / title.
    """
    t = data.get('tournament') or {}
    title = t.get('title') or ''
    tl = title.lower()
    star = int(t.get('star') or 0)
    gg = int(t.get('is_use_gg_rating') or 0)
    fsm = int(t.get('is_fsm_rating') or 0)
    creator_id = str((data.get('creator') or {}).get('id'))

    # explicit exclusion: annual final "Red Tiger Stars" (id 2621)
    if 'red tiger stars' in tl:
        return None
    # attestational tournaments scored like a monthly rating
    if 'аттестац' in tl:
        return 'attest'
    # official GG-rated star tournaments (may also carry fsm=1) -> category 2
    if gg == 1 and star > 0:
        return 'kat2'
    # FSM отборы + Лига Юга (gg==0, fsm==1)
    if fsm == 1:
        if '1/4' in title:
            return 'kat4_quarter'
        return 'kat4_otbor'
    # minicaps organised strictly by Тигран(1000) or Савелий(4403)
    if creator_id in ('1000', '4403'):
        return 'kat3'
    return None


def score_event(cat, place, gg, nroles, mvp, strict_noms=False):
    """RT contribution of a single gomafia event for one player.

    strict_noms: if True, the nomination/MVP bonus is awarded only to players who also earned
    place points (finished in the category's scoring range). This is needed only for top-tier
    federal qualifiers (star>=5 FSM отборы, e.g. Кубок России Отбор 3004), where a nomination
    won by a non-advancing player is not credited. Lower-tier отборы (star<=4 Лига Юга,
    star0 THE.MASTERS) award nominations regardless of place, so strict_noms stays False there.
    """
    try:
        p = int(place) if place not in (None, '') else 9999
    except (TypeError, ValueError):
        p = 9999
    if cat == 'kat2':
        base = 2.0 * gg
        bonus = 6 * nroles + (10 if mvp else 0)
        scored_place = gg > 0
    elif cat == 'kat3':
        base = {1: 15, 2: 10, 3: 5}.get(p, 0)
        bonus = 2 * nroles + (4 if mvp else 0)
        scored_place = base > 0
    elif cat == 'kat4_otbor':
        base = 15 if p in (1, 2) else 0
        bonus = 4 * nroles + (7 if mvp else 0)
        scored_place = base > 0
    elif cat == 'kat4_quarter':
        base = 20 if 1 <= p <= 5 else 0
        bonus = 4 * nroles + (7 if mvp else 0)
        scored_place = base > 0
    elif cat == 'attest':
        base = place_pts(p)
        bonus = 3 * nroles + (5 if mvp else 0)
        scored_place = base > 0
    else:
        raise ValueError('unknown category %r' % cat)
    if strict_noms and not scored_place:
        bonus = 0
    return base + bonus


# ---------------------------------------------------------------- cat1 (mafrate months)
def _resolve_month_files(months_dir_or_files):
    """Определить набор зачётных месяцев ДИНАМИЧЕСКИ. Возвращает {month_key: path},
    где month_key — 'YYYY-MM' (стабилен между годами).

    Приоритет источников (месяцы НИГДЕ не хардкодятся):
      1. Явный dict {month_key: path} — используем как есть.
      2. Каталог с манифестом MANIFEST_NAME (его пишет конвейер) — берём перечисленные файлы.
      3. Каталог без манифеста — глобим mafrate_month_*.json и берём только те, чей
         встроенный date_start >= RATING_SEASON_FROM (устаревший янв/фев сам отсекается).
    """
    if isinstance(months_dir_or_files, dict):
        return {str(k): p for k, p in months_dir_or_files.items()}
    d = months_dir_or_files
    manifest = os.path.join(d, MANIFEST_NAME)
    out = {}
    if os.path.exists(manifest):
        for e in json.load(open(manifest, encoding='utf-8')).get('months', []):
            key = e.get('key') or ('%04d-%02d' % (e.get('year', 0), e.get('m', 0)))
            path = os.path.join(d, e.get('file') or ('mafrate_month_%d.json' % e['m']))
            if os.path.exists(path):
                out[key] = path
        return out
    # fallback: глоб + фильтр по встроенной дате
    import glob
    for path in glob.glob(os.path.join(d, 'mafrate_month_*.json')):
        try:
            doc = json.load(open(path, encoding='utf-8'))
        except (ValueError, OSError):
            continue
        ds = doc.get('date_start')
        if not ds or ds < RATING_SEASON_FROM:
            continue
        key = ds[:7]
        out[key] = path
    return out


def compute_cat1(months_dir_or_files):
    """Return {uid: {month_key: month_total}} for the dynamically-selected season months."""
    files = _resolve_month_files(months_dir_or_files)
    per = collections.defaultdict(dict)   # uid -> {month_key: total}
    for key, path in files.items():
        d = json.load(open(path, encoding='utf-8'))
        nick2uid = {}
        rec = {}   # uid -> [place_pts, nom_pts, mvp_pts]
        for pl in d.get('players', []):
            uid = str(pl['user_id'])
            nick2uid.setdefault(pl['user'], uid)
            rec.setdefault(uid, [0, 0, 0])
            rec[uid][0] = place_pts(pl.get('place'))
        for nom in d.get('nominations', []):
            uid = nick2uid.get(nom.get('user'))
            if uid is None:
                continue
            rec.setdefault(uid, [0, 0, 0])
            if nom.get('nomination') == MVP_NOM_NAME:
                rec[uid][2] = 5
            else:
                rec[uid][1] += 3
        for uid, (pp, np_, mp) in rec.items():
            per[uid][key] = pp + np_ + mp
    return per


def cat1_for_primary(primary_uid, cat1_per):
    """Merged cat1 total for a primary uid: for each present month pick the best month_total
    among the primary and its merged second accounts (count one position only).
    Набор месяцев берётся из данных (cat1_per), а не из захардкоженного списка."""
    group = [primary_uid] + MERGES.get(primary_uid, [])
    months = set()
    for u in group:
        months |= set(cat1_per.get(u, {}).keys())
    total = 0
    for mk in months:
        best = 0
        for u in group:
            v = cat1_per.get(u, {}).get(mk, 0)
            if v > best:
                best = v
        total += best
    return total


# ---------------------------------------------------------------- cat2-4 / attest (gomafia)
def compute_gomafia(tournaments_dir, roster_set):
    """Return (totals {uid: rt}, scored [{id,cat,title,...}]) over all cached tournaments.

    Secondary merge accounts are folded onto their primary uid. No-org rule applied generally.
    """
    totals = collections.defaultdict(float)
    scored = []
    members = set(roster_set) | set(SECONDARY_TO_PRIMARY)
    for fn in sorted(os.listdir(tournaments_dir)):
        if not (fn.startswith('t') and fn.endswith('_.json')):
            continue
        try:
            data = json.load(open(os.path.join(tournaments_dir, fn), encoding='utf-8'))['data']
        except (ValueError, KeyError):
            continue
        cat = categorize(data)
        if cat is None:
            continue
        t = data.get('tournament') or {}
        tid = str(t.get('id'))
        star = int(t.get('star') or 0)
        creator_id = str((data.get('creator') or {}).get('id'))
        m = merged_standings(data)
        win = noms_winners(data)
        # top-tier федеральный отбор (Кубок России): nominations only for advancing places
        strict_noms = (cat == 'kat4_otbor' and star >= 5)

        # collect club participants (standings + nomination winners), mapped to primary uid
        raw_uids = set(u for u in m if u in members) | set(u for u in win if u in members)
        best_by_primary = {}   # primary uid -> best event RT (handles same-event double account)
        for u in raw_uids:
            primary = SECONDARY_TO_PRIMARY.get(u, u)
            if primary not in roster_set:
                continue
            rec = m.get(u, {'place': None, 'gg': 0.0})
            w = win.get(u, {'roles': [], 'mvp': False})
            ev = score_event(cat, rec['place'], rec['gg'], len(w['roles']), w['mvp'], strict_noms)
            # no-org rule: organizer gets 0 from a tournament they created
            if primary == creator_id or u == creator_id:
                ev = 0
            if primary not in best_by_primary or ev > best_by_primary[primary]:
                best_by_primary[primary] = ev
        contributed = 0.0
        for primary, ev in best_by_primary.items():
            totals[primary] += ev
            contributed += ev
        # only tournaments with an actual club participant "contribute" (matter to the fetch layer)
        if best_by_primary:
            scored.append({'id': tid, 'cat': cat, 'title': t.get('title'),
                           'date': t.get('date_start'), 'star': star,
                           'gg': int(t.get('is_use_gg_rating') or 0),
                           'fsm': int(t.get('is_fsm_rating') or 0), 'creator_id': creator_id,
                           'strict_noms': strict_noms,
                           'club_uids': sorted(best_by_primary),
                           'contributed_rt': round(contributed, 2)})
    return totals, scored


# ---------------------------------------------------------------- public API
def compute_table(tournaments_dir, months_dir_or_files, roster_path):
    """Return list of (nick, rt) sorted by RT desc then nick, for the 32 control players."""
    roster = json.load(open(roster_path, encoding='utf-8'))
    roster_set = set(roster.keys())
    cat1_per = compute_cat1(months_dir_or_files)
    gomafia_totals, _scored = compute_gomafia(tournaments_dir, roster_set)

    rows = []
    for nick, uid in IDENTITY.items():
        rt = cat1_for_primary(uid, cat1_per) + gomafia_totals.get(uid, 0)
        rows.append((nick, int(round(rt))))
    rows.sort(key=lambda r: (-r[1], r[0]))
    return rows


def scored_set(tournaments_dir, roster_path):
    """Return list of {id, cat, title, ...} for every tournament that contributes RT."""
    roster = json.load(open(roster_path, encoding='utf-8'))
    _totals, scored = compute_gomafia(tournaments_dir, set(roster.keys()))
    return scored


# identity-merge map for the fetch layer (primary uid -> secondary uids)
identity_merges = MERGES


# ---------------------------------------------------------------- CLI / self-test
if __name__ == '__main__':
    import sys
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer)
    BASE = os.path.dirname(os.path.abspath(__file__))

    CONTROL = collections.OrderedDict([
        ('Свой', 408), ('Price', 193), ('Shegan', 174), ('Натс', 161), ('Zhnec', 159),
        ('Бу.Ханка', 104), ('Videns', 94), ('Совесть', 94), ('Sun', 85), ('Леви', 78),
        ('Detect', 72), ('Инга', 53), ('Tatle', 52), ('Мышь', 46), ('Vodomerka', 40),
        ('Шальная', 31), ('Тигр', 28), ('Техник', 25), ('Заба', 22), ('Dee', 20),
        ('Актриса', 16), ('Морф', 14), ('Йода', 12), ('Малинka', 12), ('Hanna', 11),
        ('Анталия', 10), ('Хэль', 10), ('Vyaza', 8), ('Адалин', 7), ('Вишенка', 6),
        ('FREESTYLE', 4), ('Trouble', 4),
    ])

    tdir = os.path.join(BASE, 'tournaments')
    rows = compute_table(tdir, BASE, os.path.join(BASE, 'roster101.json'))
    got = dict(rows)
    mism = 0
    print('%-12s %6s %6s %6s' % ('nick', 'calc', 'ctrl', 'diff'))
    for nick, ctrl in CONTROL.items():
        c = got.get(nick, 0)
        d = c - ctrl
        if d:
            mism += 1
        print('%-12s %6d %6d %+6d%s' % (nick, c, ctrl, d, '  <<<' if d else ''))
    print('\nmismatches: %d' % mism)
