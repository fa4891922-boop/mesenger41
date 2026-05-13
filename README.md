# PearNet Messenger

Real-time private messenger with WebRTC voice/video calls and Electron desktop app.

## Stack

- **Frontend**: React 19, Vite 8, Socket.IO Client
- **Backend**: Express 5, Socket.IO 4, PostgreSQL, Redis
- **Desktop**: Electron 36
- **Security**: helmet, express-rate-limit, bcryptjs, JWT
- **Deploy**: Render (Frankfurt)

## Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Redis (optional, for online status tracking)

## Quick Start

```bash
# Clone
git clone https://github.com/fa4891922-boop/mesenger41.git
cd mesenger41

# Backend
cd backend
cp .env.example .env   # fill in DATABASE_URL, JWT_SECRET
npm install
npm start              # http://localhost:3000

# Frontend (new terminal)
cd frontend
cp .env.example .env   # set VITE_BACKEND_URL if needed
npm install
npm run dev            # http://localhost:5173

# Desktop (optional, new terminal)
cd desktop
npm install
npm start
```

## Android APK

For local emulator testing, keep the backend running on your computer at `http://localhost:3000` and run:

```bash
cd frontend
npm run android:sync:debug
npm run android:open
```

For a real release APK, configure the public backend URL first:

```bash
cd frontend
cp .env.production.example .env.production
# edit .env.production if your backend URL changes
npm run android:sync:release
npm run android:open
```

Then build the APK/AAB from Android Studio. Do not use `localhost`, `127.0.0.1`, or `10.0.2.2` for release builds.

## Environment Variables

### Backend (`backend/.env`)

| Variable       | Required | Description              | Default |
|---------------|----------|--------------------------|---------|
| `DATABASE_URL` | yes      | PostgreSQL connection    | -       |
| `JWT_SECRET`   | yes      | JWT signing secret       | -       |
| `REDIS_URL`    | no       | Redis connection         | -       |
| `FRONTEND_URL` | no       | CORS origin              | `*`     |
| `SOCKET_CONN_PER_IP_MAX` | no | Socket connection attempts per IP per minute | `30` |
| `PORT`         | no       | Server port              | `3000`  |

### Frontend (`frontend/.env`)

| Variable          | Description    | Default |
|------------------|----------------|---------|
| `VITE_BACKEND_URL` | Backend URL   | `''`    |

## Project Structure

```
pearnet/
├── backend/
│   ├── index.js              # Entry point, middleware, server
│   ├── db.js                 # PostgreSQL pool, schema init
│   ├── middleware/
│   │   └── auth.js           # JWT authentication
│   ├── routes/
│   │   ├── auth.js           # Register, login, /me
│   │   ├── users.js          # User search
│   │   ├── conversations.js  # List, delete conversations
│   │   └── messages.js       # CRUD with pagination
│   └── socket/
│       └── index.js          # Socket.IO events, Redis online status
├── frontend/
│   └── src/
│       ├── App.jsx           # Auth wrapper
│       ├── AuthPage.jsx      # Login/register form
│       ├── Messenger.jsx     # Main layout, state orchestration
│       ├── CallModal.jsx     # WebRTC voice/video calls
│       ├── components/
│       │   ├── Sidebar.jsx
│       │   ├── ChatArea.jsx
│       │   ├── ChatHeader.jsx
│       │   ├── MessageBubble.jsx
│       │   ├── MessageInput.jsx
│       │   ├── ContextMenu.jsx
│       │   ├── ConfirmDialog.jsx
│       │   └── SearchOverlay.jsx
│       ├── hooks/
│       │   ├── useSocket.js        # Socket.IO + connection status
│       │   ├── useMessages.js      # Messages CRUD + pagination
│       │   └── useConversations.js # Conversations + search
│       └── utils/
│           ├── api.js        # Fetch wrapper
│           └── format.js     # Date/time formatting
└── desktop/
    ├── main.js               # Electron main process
    └── package.json
```

## API

### REST

| Method | Endpoint                     | Auth | Description                      |
|--------|------------------------------|------|----------------------------------|
| GET    | `/`                          | no   | Healthcheck                      |
| POST   | `/api/register`              | no   | Register (rate-limited: 5/min)   |
| POST   | `/api/login`                 | no   | Login (rate-limited: 5/min)      |
| GET    | `/api/me`                    | yes  | Current user                     |
| GET    | `/api/users?search=`         | yes  | Search users                     |
| GET    | `/api/conversations`         | yes  | List conversations               |
| DELETE | `/api/conversations/:userId` | yes  | Delete conversation (soft)       |
| GET    | `/api/messages/:userId`      | yes  | Messages (cursor pagination)     |
| PUT    | `/api/messages/:messageId`   | yes  | Edit message                     |
| DELETE | `/api/messages/:messageId`   | yes  | Delete message                   |

### Socket.IO Events

| Direction      | Event             | Description                  |
|---------------|-------------------|------------------------------|
| client->server | `send_message`    | Send private message         |
| client->server | `typing`          | Typing indicator             |
| client->server | `call_offer`      | Initiate WebRTC call         |
| client->server | `call_answer`     | Answer WebRTC call           |
| client->server | `call_ice`        | ICE candidate                |
| client->server | `call_end`        | End call                     |
| client->server | `call_reject`     | Reject incoming call         |
| server->client | `receive_message` | New message received         |
| server->client | `user_typing`     | Someone is typing            |
| server->client | `online_users`    | Online users list            |
| server->client | `call_incoming`   | Incoming call                |
| server->client | `call_answered`   | Call was answered             |
| server->client | `call_ice`        | ICE candidate from peer      |
| server->client | `call_ended`      | Call ended                   |
| server->client | `call_rejected`   | Call was rejected             |
| server->client | `message_deleted` | Message deleted by sender    |
| server->client | `message_edited`  | Message was edited           |

## Database

Two tables, auto-created on startup:

- **users**: id, username, password_hash, display_name, last_seen, created_at
- **private_messages**: id, sender_id, receiver_id, content, edited_at, deleted_for_sender, deleted_for_receiver, created_at

## Deploy to Render

1. Create PostgreSQL and Redis instances in Frankfurt
2. Create **Web Service** for backend (Node, `npm install`, `npm start`, root: `backend`)
3. Create **Static Site** for frontend (`npm run build`, publish: `dist`, root: `frontend`)
4. Set environment variables on both services
