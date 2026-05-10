# PearNet Messenger — Инструкции для Claude

## Проект

Мессенджер реального времени. Монорепо: `frontend/` (React 19 + Vite 8) и `backend/` (Express 5 + Socket.IO 4).
GitHub: `fa4891922-boop/mesenger41`, ветка `main`.

## Предпочтения по стеку

Пользователь предпочитает следующие технологии — используй их по умолчанию:

- **Frontend**: React (последняя версия), Vite, JSX (не TSX)
- **Backend**: Node.js, Express, Socket.IO для реалтайма
- **БД**: PostgreSQL через `pg` (параметризованные запросы `$1, $2`)
- **Кэш**: Redis через `redis`
- **Реалтайм**: Socket.IO (не голые WebSocket)
- **CSS**: inline-стили или CSS-переменные, без CSS-фреймворков
- **Язык**: JavaScript (без TypeScript)
- **Деплой**: Render (через MCP-инструменты)

## Стиль кода

### Общие правила

- Пиши чистый, читаемый код без лишних абстракций
- Не добавляй комментарии — код должен говорить сам за себя
- Не создавай файлы документации, если не просят
- Имена переменных и функций — camelCase, описательные
- Строки — одинарные кавычки в JS
- Точка с запятой — обязательна
- Отступы — 2 пробела

### Backend

- CommonJS: `require` / `module.exports`
- Async/await вместо колбэков
- SQL-запросы: всегда параметризованные (`$1, $2`), никогда не конкатенация строк
- Обработка ошибок: try/catch в async-обработчиках
- CORS настраивается через переменную `FRONTEND_URL`

### Frontend

- ESM: `import` / `export`
- Функциональные компоненты + хуки (useState, useEffect)
- Компоненты без классов
- Socket.IO-клиент инициализируется на уровне модуля (вне компонента)
- `import.meta.env.VITE_*` для переменных окружения

### Формат inline-стилей в JSX

```jsx
<div style={{ padding: '20px', borderRadius: '10px', background: '#fff' }}>
```

## Структура проекта

```
pearnet/
├── CLAUDE.md
├── backend/
│   ├── index.js          ← точка входа, вся серверная логика
│   └── package.json
└── frontend/
    ├── index.html
    ├── vite.config.js
    ├── src/
    │   ├── main.jsx      ← точка входа React
    │   ├── App.jsx       ← главный компонент (вся UI-логика)
    │   ├── App.css
    │   └── index.css     ← CSS-переменные, глобальные стили
    └── public/
```

## Переменные окружения

### Backend (.env)

| Переменная     | Обяз. | Описание                        | По умолч. |
|---------------|-------|---------------------------------|-----------|
| `DATABASE_URL` | да    | PostgreSQL connection string    | —         |
| `REDIS_URL`    | нет   | Redis connection string         | —         |
| `FRONTEND_URL` | нет   | CORS origin                     | `*`       |
| `PORT`         | нет   | Порт сервера                    | `3000`    |

### Frontend

| Переменная          | Описание        | По умолч. |
|--------------------|-----------------|-----------|
| `VITE_BACKEND_URL` | URL бэкенда     | `''`      |

## API

- `GET /` — healthcheck
- `GET /api/messages` — последние 100 сообщений

### WebSocket-события (Socket.IO)

| Направление       | Событие           | Данные                                    |
|-------------------|-------------------|-------------------------------------------|
| клиент → сервер   | `send_message`    | `{ username: string, content: string }`   |
| сервер → клиент   | `receive_message` | объект строки из таблицы `messages`        |

## БД: таблица messages

```sql
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

Таблица создаётся автоматически при старте backend.

## Команды

```bash
# Backend
cd backend && npm install && npm start

# Frontend — разработка
cd frontend && npm install && npm run dev

# Frontend — сборка
cd frontend && npm run build

# Линтинг
cd frontend && npm run lint
```

## Деплой на Render (MCP)

Проект деплоится на Render. Инфраструктура:

| Ресурс   | Render ID                        | Имя                  | Регион    |
|----------|----------------------------------|-----------------------|-----------|
| Postgres | `dpg-d805956gvqtc73d769j0-a`    | telegram-clone-db     | Frankfurt |
| Redis    | `red-d80593b7uimc73f7pdg0`      | telegram-clone-redis  | Frankfurt |

### Как деплоить

При деплое используй MCP-инструменты Render:

1. **Backend** — `create_web_service` (runtime: `node`, region: `frankfurt`):
   - Build: `npm install`
   - Start: `npm start`
   - Root dir: `backend`
   - Env: `DATABASE_URL`, `REDIS_URL`, `FRONTEND_URL`

2. **Frontend** — `create_static_site`:
   - Build: `npm run build`
   - Publish: `dist`
   - Root dir: `frontend`
   - Env: `VITE_BACKEND_URL` = URL бэкенд-сервиса

3. **Env-переменные** — подтягивай connection strings из Postgres и Redis через `get_postgres` / `get_key_value`

### Регион

Все сервисы создавай в **Frankfurt** — там уже живут БД и Redis.

## Правила работы

- Язык общения: русский
- Не добавляй TypeScript — проект на чистом JavaScript
- Не добавляй тестовые фреймворки, если не просят
- Не предлагай CSS-фреймворки (Tailwind, Bootstrap и т.д.)
- При добавлении новых страниц/компонентов — создавай отдельные файлы в `src/`
- При изменении API — обновляй и бэкенд, и фронтенд в одном запросе
- Всегда используй параметризованные SQL-запросы
- SSL для PostgreSQL: `{ rejectUnauthorized: false }` (облачная БД)
- Git: не пушь автоматически, спроси перед пушем
