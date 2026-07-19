# TalkGrid — Full Stack Chat

A real-time chat web app with end-to-end encrypted direct messages, groups, voice calls, and status updates.

## Tech Stack

- **Backend**: Node.js, Express, Socket.io, **MongoDB** (Mongoose), JWT auth, bcrypt
- **Frontend**: React 18, Vite, Socket.io client, Web Crypto API (E2EE)

## Quick Start

### 1. MongoDB setup

Create a free cluster at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) and copy your connection string.

Create `server/.env`:

```env
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/talkgrid
JWT_SECRET=change-me-in-production
PORT=3001
```

### 2. Install dependencies

```bash
npm run install:all
```

### 3. Run the app

```bash
npm run dev
```

- API + Socket.io: **http://localhost:3001**
- React app: **http://localhost:5173**

### 4. Deploy

- **Frontend** → Vercel (set `VITE_API_URL` and `VITE_SOCKET_URL` to your Render backend URL)
- **Backend** → Render (set `MONGODB_URI` and `JWT_SECRET` in environment variables)

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGODB_URI` | Yes | MongoDB connection string |
| `JWT_SECRET` | Yes (prod) | Secret for signing auth tokens |
| `PORT` | No | Server port (default `3001`) |
| `CLOUDINARY_*` | No | For status/story media uploads |

## Project Structure

```
Backend project/
├── server/
│   ├── index.js           # Express + Socket.io
│   ├── mongo.js           # MongoDB connection + helpers
│   ├── models/            # User, Conversation, Message, Status, Counter
│   └── routes/
├── client/                # Vite + React app
└── package.json
```

## Features

- Register / login with JWT
- 1-on-1 and group chats
- End-to-end encryption for direct messages
- Real-time delivery via Socket.io
- Voice calls (WebRTC signaling)
- Status/stories (Cloudinary uploads)
