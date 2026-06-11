# XpenseTrack — Full-Stack Expense Management App

A complete expense management system built for organizations supporting PHP and USD currencies.

## Project Structure

```
xpensetrack/
├── frontend/          # React PWA (Vite + TailwindCSS)
├── backend/           # Node.js REST API (Express + Prisma)
└── README.md
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, TailwindCSS, React Router |
| Backend | Node.js, Express, Prisma ORM |
| Database | PostgreSQL (or SQLite for local dev) |
| Auth | JWT (JSON Web Tokens) |
| OCR | Google Vision API (receipt scanning) |
| File storage | Cloudinary (receipt images) |
| Email | Nodemailer (approval notifications) |
| PWA | Vite PWA plugin (offline + installable) |

---

## Quick Start

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env      # fill in your values
npx prisma migrate dev    # set up database
npm run dev               # starts on http://localhost:3001
```

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env      # set VITE_API_URL=http://localhost:3001
npm run dev               # starts on http://localhost:5173
```

---

## Features

- ✅ Receipt scanning with OCR (Google Vision API)
- ✅ Manual expense entry
- ✅ PHP / USD dual currency with live conversion
- ✅ Multi-level approval workflow (employee → manager → finance)
- ✅ Expense reports export (Excel + PDF)
- ✅ Role-based access (Employee, Manager, Finance, Admin)
- ✅ Email notifications on submit/approve/reject
- ✅ PWA — installable on iOS and Android
- ✅ Cash advance liquidation tracking
- ✅ Dashboard with charts and metrics

---

## User Roles

| Role | Can do |
|---|---|
| Employee | Submit, edit own expenses |
| Manager | Approve/reject direct reports' expenses |
| Finance | Second-level approval, export reports |
| Admin | Full access, manage users and settings |

---

## Environment Variables

### Backend `.env`
```
DATABASE_URL=postgresql://user:password@localhost:5432/xpensetrack
JWT_SECRET=your-secret-key-here
GOOGLE_VISION_API_KEY=your-google-api-key
CLOUDINARY_URL=cloudinary://api_key:api_secret@cloud_name
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@email.com
SMTP_PASS=your-app-password
FRONTEND_URL=http://localhost:5173
```

### Frontend `.env`
```
VITE_API_URL=http://localhost:3001
VITE_APP_NAME=XpenseTrack
```

---

## Deployment

### Option A: Railway (recommended for quick deploy)
1. Push to GitHub
2. Connect repo to Railway
3. Add PostgreSQL plugin
4. Set environment variables
5. Deploy — Railway auto-detects Node.js

### Option B: Vercel (frontend) + Railway (backend)
- Frontend: connect to Vercel, set `VITE_API_URL` to your Railway backend URL
- Backend: deploy to Railway

### Option C: Docker
```bash
docker-compose up --build
```
