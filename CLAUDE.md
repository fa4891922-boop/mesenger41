# PearNet Messenger — Инструкции для Claude

## Проект

Мессенджер реального времени. Монорепо: `frontend/` (React 19 + Vite 8) и `backend/` (Express 5 + Socket.IO 4).
GitHub: `fa4891922-boop/mesenger41`, ветка `main`.

## Предпочтения по стеку

- **Frontend**: React (последняя версия), Vite, JSX (не TSX)
- **Backend**: Node.js, Express, Socket.IO для реалтайма
- **БД**: PostgreSQL через `pg` (параметризованные запросы `$1, $2`)
- **Кэш**: Redis через `redis`
- **Реалтайм**: Socket.IO (не голые WebSocket)
- **CSS**: CSS-классы + CSS-переменные, без CSS-фреймворков
- **Язык**: JavaScript (без TypeScript)
- **Деплой**: Render (через MCP-инструменты)

## Стиль кода

### Общие правила

- Чистый, читаемый код без лишних абстракций
- Без комментариев — код должен говорить сам за себя
- camelCase для переменных и функций
- Одинарные кавычки в JS
- Точка с запятой обязательна
- Отступы — 2 пробела

### Backend

- CommonJS: `require` / `module.exports`
- Async/await вместо колбэков
- SQL: всегда параметризованные запросы (`$1, $2`)
- Обработка ошибок: try/catch, не утекать err.message клиенту
- CORS через переменную `FRONTEND_URL`

### Frontend

- ESM: `import` / `export`
- Функциональные компоненты + хуки
- `import.meta.env.VITE_*` для переменных окружения

## Структура проекта

```
pearnet/
├── CLAUDE.md
├── README.md
├── backend/
│   ├── index.js          ← точка входа
│   ├── db.js             ← Pool, initDb
│   ├── package.json
│   ├── .env.example
│   ├── middleware/
│   │   └── auth.js       ← JWT authenticate
│   ├── routes/
│   │   ├── auth.js       ← register, login, me
│   │   ├── users.js      ← поиск пользователей
│   │   ├── conversations.js ← список диалогов, удаление
│   │   └── messages.js   ← CRUD сообщений
│   └── socket/
│       └── index.js      ← Socket.IO обработчики
├── frontend/
│   ├── index.html
│   ├── vite.config.js
│   ├── .env.example
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx
│   │   ├── App.css
│   │   ├── index.css
│   │   ├── AuthPage.jsx
│   │   ├── Messenger.jsx
│   │   ├── CallModal.jsx
│   │   ├── components/
│   │   │   ├── Sidebar.jsx
│   │   │   ├── ChatArea.jsx
│   │   │   ├── MessageBubble.jsx
│   │   │   ├── ChatHeader.jsx
│   │   │   ├── MessageInput.jsx
│   │   │   ├── ContextMenu.jsx
│   │   │   ├── ConfirmDialog.jsx
│   │   │   └── SearchOverlay.jsx
│   │   ├── hooks/
│   │   │   ├── useSocket.js
│   │   │   ├── useMessages.js
│   │   │   └── useConversations.js
│   │   └── utils/
│   │       ├── api.js
│   │       └── format.js
│   └── public/
└── desktop/
    ├── main.js
    └── package.json
```

## Переменные окружения

### Backend (.env)

| Переменная     | Обяз. | Описание                        | По умолч. |
|---------------|-------|---------------------------------|-----------|
| `DATABASE_URL` | да    | PostgreSQL connection string    | —         |
| `JWT_SECRET`   | да    | Секрет для подписи JWT          | —         |
| `REDIS_URL`    | нет   | Redis connection string         | —         |
| `FRONTEND_URL` | нет   | CORS origin                     | `*`       |
| `PORT`         | нет   | Порт сервера                    | `3000`    |

### Frontend

| Переменная          | Описание        | По умолч. |
|--------------------|-----------------|-----------|
| `VITE_BACKEND_URL` | URL бэкенда     | `''`      |

## API

### REST-эндпоинты

| Метод   | Путь                          | Auth  | Описание                     |
|---------|-------------------------------|-------|------------------------------|
| GET     | `/`                           | нет   | Healthcheck                  |
| POST    | `/api/register`               | нет   | Регистрация                  |
| POST    | `/api/login`                  | нет   | Авторизация                  |
| GET     | `/api/me`                     | да    | Текущий пользователь         |
| GET     | `/api/users?search=`          | да    | Поиск пользователей          |
| GET     | `/api/conversations`          | да    | Список диалогов              |
| GET     | `/api/messages/:userId`       | да    | Сообщения с пользователем    |
| PUT     | `/api/messages/:messageId`    | да    | Редактирование сообщения     |
| DELETE  | `/api/messages/:messageId`    | да    | Удаление сообщения           |
| DELETE  | `/api/conversations/:userId`  | да    | Удаление диалога             |

### WebSocket-события (Socket.IO)

| Направление       | Событие           | Данные                                      |
|-------------------|-------------------|---------------------------------------------|
| клиент → сервер   | `send_message`    | `{ receiverId: number, content: string }`   |
| клиент → сервер   | `typing`          | `{ receiverId: number }`                    |
| клиент → сервер   | `call_offer`      | `{ to: number, offer: RTCOffer, callType }` |
| клиент → сервер   | `call_answer`     | `{ to: number, answer: RTCAnswer }`         |
| клиент → сервер   | `call_ice`        | `{ to: number, candidate: RTCIceCandidate }`|
| клиент → сервер   | `call_end`        | `{ to: number }`                            |
| клиент → сервер   | `call_reject`     | `{ to: number }`                            |
| сервер → клиент   | `receive_message` | объект строки из `private_messages` + `sender_name` |
| сервер → клиент   | `online_users`    | `number[]` (массив userId)                  |
| сервер → клиент   | `user_typing`     | `{ userId: number }`                        |
| сервер → клиент   | `message_deleted` | `{ messageId: number, forEveryone: bool }`  |
| сервер → клиент   | `message_edited`  | объект обновлённого сообщения               |
| сервер → клиент   | `call_incoming`   | `{ from, fromName, offer, callType }`       |
| сервер → клиент   | `call_answered`   | `{ answer: RTCAnswer }`                     |
| сервер → клиент   | `call_ice`        | `{ candidate: RTCIceCandidate }`            |
| сервер → клиент   | `call_ended`      | —                                           |
| сервер → клиент   | `call_rejected`   | `{ reason: string }`                        |

## БД: схема

```sql
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS private_messages (
  id SERIAL PRIMARY KEY,
  sender_id INTEGER REFERENCES users(id),
  receiver_id INTEGER REFERENCES users(id),
  content TEXT NOT NULL,
  edited_at TIMESTAMP,
  deleted_for_sender BOOLEAN DEFAULT FALSE,
  deleted_for_receiver BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

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

# Desktop — разработка
cd desktop && npm run dev

# Desktop — сборка
cd desktop && npm run build
```

## Деплой на Render (MCP)

| Ресурс   | Render ID                        | Имя                  | Регион    |
|----------|----------------------------------|-----------------------|-----------|
| Postgres | `dpg-d805956gvqtc73d769j0-a`    | telegram-clone-db     | Frankfurt |
| Redis    | `red-d80593b7uimc73f7pdg0`      | telegram-clone-redis  | Frankfurt |

Все сервисы создавай в **Frankfurt**.

## Правила работы

- Язык общения: русский
- Не добавляй TypeScript
- Не добавляй CSS-фреймворки (Tailwind, Bootstrap и т.д.)
- Всегда используй параметризованные SQL-запросы
- SSL для PostgreSQL: `{ rejectUnauthorized: false }` (облачная БД)
- Git: пушь автоматически после коммита
- При изменении API — обновляй и бэкенд, и фронтенд
