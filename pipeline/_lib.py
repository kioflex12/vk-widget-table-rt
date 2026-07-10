# -*- coding: utf-8 -*-
"""Shared login/session helper for mafrate.pro. READ-ONLY usage only.

Routing (from /framework/js/_functions.js):
  AJAX POST target = 'controller-' + <page path>
  e.g. page /login  -> POST /controller-login
       page /rating -> POST /controller-rating
Body is multipart/form-data (browser uses FormData). csrf_token rotates:
  take the new one from each JSON response.

Креды берутся ИЗ ОКРУЖЕНИЯ (не из файла), чтобы ничего не попадало в git:
  MAFRATE_LOGIN     — логин mafrate (обязательно)
  MAFRATE_PASSWORD  — пароль mafrate (обязательно)
  MAFRATE_LOGIN_LATIN — необязательный второй вариант логина (латиница), fallback.
Ни логин, ни пароль, ни тела ответов НЕ печатаются.
"""
import os, sys
import requests

BASE = "https://mafrate.pro"


def _creds():
    """Собрать креды из окружения. Бросает RuntimeError, если обязательные не заданы."""
    login = os.environ.get("MAFRATE_LOGIN")
    password = os.environ.get("MAFRATE_PASSWORD")
    if not login or not password:
        raise RuntimeError("MAFRATE_LOGIN / MAFRATE_PASSWORD не заданы в окружении")
    c = {"login": login, "password": password}
    latin = os.environ.get("MAFRATE_LOGIN_LATIN")
    if latin:
        c["login_latin_variant"] = latin
    return c


def new_session():
    s = requests.Session()
    s.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        "X-Requested-With": "XMLHttpRequest",
        "Accept": "application/json, text/javascript, */*; q=0.01",
    })
    return s


def _multipart(fields):
    return {k: (None, str(v)) for k, v in fields.items()}


def controller_post(s, page_path, action, extra=None, csrf=None, referer=None):
    """POST an AJAX action to controller-<page_path>. Returns (json, new_csrf, status)."""
    page_path = page_path.lstrip("/")
    url = f"{BASE}/controller-{page_path}"
    fields = {"action": action}
    if csrf:
        fields["csrf_token"] = csrf
    if extra:
        fields.update(extra)
    ref = referer or f"{BASE}/{page_path}"
    r = s.post(url, files=_multipart(fields), headers={"Referer": ref}, timeout=60)
    j = None
    try:
        j = r.json()
    except Exception:
        pass
    new_csrf = j.get("csrf_token") if isinstance(j, dict) else None
    return j, new_csrf, r.status_code


def login(s, verbose=True):
    c = _creds()
    s.get(BASE + "/login", timeout=40)
    csrf = None
    for key in ["login", "login_latin_variant"]:
        val = c.get(key)
        if not val:
            continue
        fields = {"action": "login", "post_form_id": "login",
                  "login": val, "password": c["password"], "remember_me": "1"}
        if csrf:
            fields["csrf_token"] = csrf
        r = s.post(BASE + "/controller-login", files=_multipart(fields),
                   headers={"Referer": BASE + "/login"}, timeout=40)
        j = None
        try:
            j = r.json()
        except Exception:
            pass
        if verbose:
            # печатаем только статус-код и result (success/error) — без логина/пароля/тела
            res = j.get("result") if isinstance(j, dict) else "NON-JSON"
            print(f"login attempt: status={r.status_code} result={res}", file=sys.stderr)
        if isinstance(j, dict) and j.get("result") == "success":
            return True, key, j.get("csrf_token"), j
        if isinstance(j, dict) and j.get("csrf_token"):
            csrf = j["csrf_token"]
    return False, None, csrf, None
