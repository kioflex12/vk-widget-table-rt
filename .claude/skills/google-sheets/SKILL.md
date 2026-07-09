---
name: google-sheets
description: "Use whenever the user asks to read, write, append, or automate the Google Sheet that feeds the RT widget — especially to make the sheet fill automatically. Covers gspread + google-auth, the service-account path for unattended automation, and how it lines up with the widget's published-CSV read layer."
---

# Работа с Google Sheets для RT-виджета

Виджет **читает** опубликованную таблицу как CSV (`PUB_ID` в [app.js](../../../app.js)). Этот скилл — про **запись/автозаполнение** той же (или связанной) таблицы: скрипт, который кладёт свежие результаты в Sheets, после чего виджет их подхватывает.

## Ключевое различие с чтением
- **Чтение (в проде):** ничего не нужно — таблица опубликована (`Файл → Поделиться → Опубликовать в интернете → CSV`), виджет тянет её анонимно. Никакой авторизации.
- **Запись (автоматизация):** нужна авторизация Google API. Публикация в интернет даёт только read-only CSV — писать через неё нельзя.

## Выбор способа авторизации

| Способ | Когда | Плюс / минус |
|---|---|---|
| **Service account** (рекомендую для автозаполнения) | Скрипт/крон/сервер пишет в таблицу без человека | Не истекает, работает headless. Правки подписаны роботом — для личного лидерборда это ок (в отличие от корпоративных таблиц с аудитом авторства). |
| **OAuth user-auth** (ADC) | Разовые ручные правки от своего имени | Правки подписаны тобой. Требует `gcloud auth application-default login`, интерактивный. |

Для цели «таблица заполняется сама» → **service account**.

## Настройка service account (один раз)
1. В [Google Cloud Console](https://console.cloud.google.com/) создать (или взять) проект → включить **Google Sheets API** и **Google Drive API**.
2. `IAM & Admin → Service Accounts → Create` → создать ключ типа **JSON**, скачать.
3. Положить JSON **вне репозитория** или в проигнорированный путь (см. `.gitignore` — паттерны `*.credentials.json`, `service-account*.json`). **Никогда не коммитить.**
4. Открыть JSON, скопировать поле `client_email` (вида `...@...iam.gserviceaccount.com`).
5. В самой Google-таблице: **Настройки доступа → добавить этот email как Редактора**. Без этого шага будет `403`.

Зависимости: `pip install gspread google-auth`. Python ≥ 3.9. На Windows запускай `python script.py`.

## Канонический шаблон записи (service account)

```python
import gspread
from google.oauth2.service_account import Credentials

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
creds = Credentials.from_service_account_file(
    r"C:\path\to\service-account.json",  # путь вне репозитория / в .gitignore
    scopes=SCOPES,
)
gc = gspread.authorize(creds)

sh = gc.open_by_key("<SPREADSHEET_ID>")   # из URL: /spreadsheets/d/<ЭТО>/edit
ws = sh.get_worksheet(0)                  # или sh.worksheet("Лист1")

# Полная перезапись данных (колонки A=Nick, B=VK, C=RT — как ждёт виджет):
rows = [["Nick", "VK", "RT"], ["player1", "id123", "1500"]]
ws.clear()
ws.update(range_name="A1", values=rows)

# Либо дописать одну строку в конец:
# ws.append_row(["player9", "durov", "999"])
```

## Как это стыкуется с виджетом
- Виджет ждёт колонки **A=Nick, B=VK, C=RT**; первая строка-заголовок опционально распознаётся (`looksLikeHeader`). Пиши в том же порядке.
- `SPREADSHEET_ID` (для записи) и `PUB_ID` (для чтения, опубликованная версия) — **разные идентификаторы одной таблицы**. После записи данные попадают в CSV не мгновенно: у опубликованного CSV есть кэш (обычно ~минуты). Виджет уже добавляет `&t=<timestamp>` для обхода кэша, но задержку публикации Google это не отменяет — учитывай при тесте «записал → проверил в виджете».
- Ссылка игрока (колонка B): можно писать голый VK-shortname (`durov`) или полный URL — `buildProfileUrl` в виджете сам достроит и отфильтрует по VK-доменам.

## Автозапуск (варианты, от простого к сложному)
- **Планировщик задач Windows / cron** → запускает Python-скрипт по расписанию. Самое дешёвое, если источник данных доступен с твоей машины/сервера.
- **Google Apps Script** (внутри самой таблицы, триггер по времени) → если данные можно получить из самого Google/по HTTP; тогда Python и service account вообще не нужны. Взвесь через `/consilium`, прежде чем выбирать.

## Типовые ошибки
| Из терминала | Причина | Что делать |
|---|---|---|
| `403` / `PERMISSION_DENIED` на таблице | Таблица не пошарена на `client_email` сервис-аккаунта как Editor | Добавить этот email в доступ к таблице как Редактора |
| `APIError 403 ... has not been used/enabled` | Не включён Sheets/Drive API в проекте | Включить оба API в Cloud Console |
| `FileNotFoundError` на JSON | Неверный путь к ключу | Проверить путь; ключ держать вне репозитория |
| `ModuleNotFoundError: gspread` | Библиотеки не установлены / не тот python | `pip install gspread google-auth` |
| `SpreadsheetNotFound` / `WorksheetNotFound` | Неверный ID или имя листа | ID — из URL; имя листа — с учётом регистра/пробелов |
| Виджет не видит новые данные | Кэш опубликованного CSV | Подождать/переопубликовать; проверить, что пишешь в тот же лист, что опубликован |

## Что НЕ делать
- ❌ Коммитить JSON-ключ, OAuth secret или любой токен. Всегда `.gitignore`.
- ❌ Писать в таблицу через «Опубликовать в интернете» — это только чтение.
- ❌ Хардкодить путь к ключу в файле, который уйдёт в git (лучше env-переменная или путь вне репо).
- ❌ Тащить в этот статик-проект тяжёлый backend, если задачу решает скрипт по расписанию или Apps Script (сначала `/consilium`).
