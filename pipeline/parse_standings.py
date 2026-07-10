# -*- coding: utf-8 -*-
"""Extract postFormData JSON from a standings HTML page and pull out
the ranked player list + the nominations table."""
import re, json, os, sys

def extract_postformdata(html):
    key = 'postFormData = '
    i = html.find(key)
    if i < 0:
        raise ValueError('postFormData not found')
    start = html.index('{', i)
    # brace-match, respecting strings
    depth = 0
    in_str = False
    esc = False
    for pos in range(start, len(html)):
        ch = html[pos]
        if in_str:
            if esc:
                esc = False
            elif ch == '\\':
                esc = True
            elif ch == '"':
                in_str = False
        else:
            if ch == '"':
                in_str = True
            elif ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    return json.loads(html[start:pos+1])
    raise ValueError('unterminated postFormData')

def strip_tags(v):
    if not isinstance(v, str):
        return v
    return re.sub(r'<[^>]*>', '', v).strip()

def iter_rows(inner):
    """inner can be a dict keyed by '0','1',... or a list."""
    if isinstance(inner, dict):
        items = [(k, r) for k, r in inner.items()]
    elif isinstance(inner, list):
        items = list(enumerate(inner))
    else:
        return
    for k, row in items:
        if k == 'order_by' or not isinstance(row, dict):
            continue
        yield row

def parse(html):
    d = extract_postformdata(html)
    pfd = d['data']['post_form_data']

    # ranked list
    players = []
    tbl = pfd.get('table_rating_snadings_list', {})
    inner = tbl.get('table_rating_snadings_list', {}) if isinstance(tbl, dict) else {}
    for row in iter_rows(inner):
        players.append({
            'place': row.get('place'),
            'rating_place': row.get('rating_place'),
            'user': strip_tags(row.get('user')),
            'user_id': row.get('user_id'),
            'sum': row.get('sum'),
            'rating': row.get('rating'),
            'game_count': row.get('game_count'),
            'win': row.get('win'),
            'win_as_don': row.get('win_as_don'),
            'win_as_sheriff': row.get('win_as_sheriff'),
            'first_kill': row.get('first_kill'),
            'nomination': strip_tags(row.get('nomination')) if row.get('nomination') else row.get('nomination'),
        })
    def pkey(p):
        try: return int(p['place'])
        except: return 9999
    players.sort(key=pkey)

    # nominations table
    noms = []
    ntbl = pfd.get('table_rating_snadings_listnomination', {})
    ninner = ntbl.get('table_rating_snadings_listnomination', {}) if isinstance(ntbl, dict) else {}
    for row in iter_rows(ninner):
        noms.append({
            'nomination': strip_tags(row.get('nomination')),
            'user': strip_tags(row.get('user')),
        })
    return players, noms, pfd

if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    fn = sys.argv[1] if len(sys.argv) > 1 else 'standings_1620.html'
    html = open(fn, encoding='utf-8').read()
    players, noms, pfd = parse(html)
    print('=== top keys in post_form_data ===')
    print(list(pfd.keys()))
    print('\n=== PLAYERS (%d) ===' % len(players))
    for p in players:
        print('  place=%-3s %-16s uid=%-7s rating=%-6s sum=%-6s games=%-3s win=%-3s don=%s sher=%s nom=%r' % (
            p['place'], p['user'], p['user_id'], p['rating'], p['sum'], p['game_count'],
            p['win'], p['win_as_don'], p['win_as_sheriff'], p['nomination']))
    print('\n=== NOMINATIONS (%d) ===' % len(noms))
    for n in noms:
        print('  %-40s -> %s' % (n['nomination'], n['user']))
