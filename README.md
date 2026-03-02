# WhatsApp-like Chat (Full Stack)

A real-time chat web app with a WhatsApp-style UI: sign up, sign in, start 1:1 conversations, and send messages that appear instantly for both users.

## Tech Stack

- **Backend**: Node.js, Express, Socket.io, SQLite (sql.js – no native build), JWT auth, bcrypt
- **Frontend**: React 18, Vite, Socket.io client

## Quick Start

### 1. Install dependencies

From the project root:

```bash
npm run install:all
```

This installs both root (server) and `client` dependencies.

### 2. Run the app

**Option A – Run backend and frontend together (recommended):**

```bash
npm run dev
```

- API + Socket.io: **http://localhost:3001**
- React app: **http://localhost:5173**

**Option B – Run separately:**

Terminal 1 (server):

```bash
npm run server
```

Terminal 2 (client):

```bash
npm run client
```

### 3. Use the app

1. Open **http://localhost:5173** in your browser.
2. **Sign up** with a username and password (optional display name).
3. Open another browser (or incognito) and **sign up** a second user.
4. With the first user: click **"+ New"**, choose the second user to start a chat.
5. Send messages; they appear in real time for both users.

## Features

- **Auth**: Register, login, JWT, logout
- **Users list**: See other users to start a chat
- **1:1 chats**: One conversation per pair; created on first message
- **Real-time messages**: Socket.io for instant send/receive
- **History**: Messages stored in SQLite and loaded when you open a conversation
- **WhatsApp-style UI**: Dark theme, conversation list, chat panel, message bubbles

## Project Structure

```
Backend project/
├── server/
│   ├── index.js       # Express + Socket.io server
│   ├── db.js          # SQLite schema and connection
│   ├── auth.js        # JWT sign/verify and middleware
│   └── routes/
│       ├── auth.js
│       ├── users.js
│       ├── conversations.js
│       └── messages.js
├── client/            # Vite + React app
│   ├── src/
│   │   ├── App.jsx
│   │   ├── Chat.jsx
│   │   ├── Login.jsx
│   │   ├── Register.jsx
│   │   ├── Avatar.jsx
│   │   ├── api.js
│   │   └── socket.js
│   └── ...
├── package.json
└── README.md
```

## Environment

- **PORT**: Server port (default `3001`; use 3001 to avoid conflict with other apps on 3000).
- **JWT_SECRET**: Set in production for secure tokens.

Database file: `server/chat.db` (SQLite via sql.js). Delete it to reset all data. No Visual Studio or native build tools are required.
