# Telegram Auto-Sender Web App

A simple web app to log in with Telegram, extract group members, and run delayed message campaigns.

## Features

- Telegram MTProto login using phone number + OTP or Session String
- Session saved in Firebase Firestore
- Group and channel member extraction
- Campaign status tracking
- Live message/delay update while campaign is running
- Dark mode UI

## Tech Stack

- Frontend: React + TypeScript + Vite + Tailwind CSS v4
- Backend: Node.js + Express + TypeScript + GramJS
- Database: Firebase Firestore
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

## Deployment (Render/Vercel)

### Backend on Render
1. Create a new Web Service on Render
2. Set environment variables: `API_ID`, `API_HASH`, `FIREBASE_SERVICE_ACCOUNT`
3. Use cron-job.org to ping `/api/health` every 5-10 minutes to prevent sleep

### Frontend on Vercel
1. Push frontend to GitHub
2. Import project on Vercel
3. Set `VITE_API_URL` environment variable to your Render backend URL

## Notes

- This app uses Firebase Firestore, not SQLite.
- Telegram session tokens are stored server-side and auto-reused on restart.
- **Mobile Tip**: Use "Session String" tab on mobile browsers - more reliable than OTP
- **Session String Login**: When OTP is rate-limited (24hr wait), use the saved session string
- Use this only with accounts and audiences you are allowed to message.

## Getting Session String

1. Login with OTP on desktop to get your session string
2. It's saved in Firestore - copy it from login success alert
3. On mobile: Use "Session String" or "Save Session" tab
4. Session strings look like: `1Ada...long string...X7kM`
