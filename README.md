# Telegram Auto-Sender Web App

A simple web app to log in with Telegram, extract group members, and run delayed message campaigns.

## Features

- Telegram MTProto login using phone number + OTP
- Session saved in SQLite
- Group and channel member extraction
- Campaign status tracking
- Live message update while campaign is running
- Dark React + Tailwind UI

## Tech Stack

- Frontend: React + TypeScript + Vite + Tailwind CSS v4
- Backend: Node.js + Express + TypeScript + GramJS
- Database: SQLite
- Telegram client: `telegram` / GramJS

## Setup Instructions

### 1. Backend Setup

1. Open terminal and navigate to the `backend` folder:

   ```bash
   cd backend
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env` and add your Telegram API credentials:

   ```env
   PORT=5000
   API_ID=YOUR_API_ID
   API_HASH=YOUR_API_HASH
   ```

4. Start the backend:

   ```bash
   npm run dev
   ```

### 2. Frontend Setup

1. Open a new terminal and navigate to the `frontend` folder:

   ```bash
   cd frontend
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Start the dev server:

   ```bash
   npm run dev
   ```

4. Open the app in the browser, usually at `http://localhost:5173`.

## Notes

- This app uses SQLite, not MongoDB.
- The local SQLite database file is created as `backend/database.sqlite`.
- Telegram session tokens are stored server-side and are not returned to the frontend.
- Use this only with accounts and audiences you are allowed to message.
