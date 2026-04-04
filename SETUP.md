# Fantasy IPL 2026 — Next.js App Setup Guide

## What this is

A full Next.js + Supabase web app replacing the single HTML file.
- Real database (Postgres via Supabase) — everyone shares the same data
- Authentication — each manager logs in with email/password or magic link
- Real-time — waiver bids update live across all browsers
- Auto-scoring via /api/score (no Netlify timeouts)
- Deploy to Vercel — free tier, no function limits

---

## Prerequisites

Make sure you have installed:
- Node.js LTS from nodejs.org (check: `node --version` in terminal)
- VS Code from code.visualstudio.com

---

## Step 1 — Create a Supabase project

1. Go to **supabase.com** → Sign up (free)
2. Click **New project**
3. Name it `fantasy-ipl`, choose a region close to you, set a database password
4. Wait ~2 minutes for it to spin up
5. Go to **Settings → API** and copy:
   - **Project URL** (looks like `https://xxxx.supabase.co`)
   - **anon public key** (long string starting with `eyJ...`)

---

## Step 2 — Run the database migration

1. In your Supabase project, click **SQL Editor** in the left sidebar
2. Click **New query**
3. Open the file `supabase/migrations/001_initial_schema.sql` from this project
4. Paste the entire contents into the SQL editor
5. Click **Run** (green button)
6. You should see "Success. No rows returned."

This creates all your tables: teams, players, squads, matches, transfers, waiver_bids, etc.

---

## Step 3 — Seed your data

After running the migration, run this seed script to add your league, teams, and players.
(I'll provide a seed.sql file — or you can use the Supabase dashboard to insert rows manually.)

For now, in the SQL editor run:

```sql
-- Create your league
INSERT INTO public.leagues (name, slug, season)
VALUES ('Fantasy IPL 2026', 'fantasy-ipl-2026', 2026);
```

Then invite each manager to sign up, and assign them to teams via the Supabase dashboard.

---

## Step 4 — Set up environment variables

1. In the project folder, copy `.env.example` to a new file called `.env.local`
2. Fill in your values:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
ANTHROPIC_API_KEY=sk-ant-api03-your-key
```

**NEVER commit `.env.local` to GitHub** — it's in .gitignore already.

---

## Step 5 — Run locally

Open a terminal in the project folder and run:

```bash
npm install
npm run dev
```

Open **http://localhost:3000** in your browser.
You should see the login page. Sign up with your email to create an account.

---

## Step 6 — Deploy to Vercel

1. Go to **vercel.com** → Sign up with GitHub
2. Push your project to a GitHub repo:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/fantasy-ipl.git
   git push -u origin main
   ```
3. In Vercel → **Add New Project** → Import from GitHub → select `fantasy-ipl`
4. In **Environment Variables**, add all three from your `.env.local`
5. Click **Deploy**
6. You'll get a URL like `fantasy-ipl.vercel.app` — share this with the league

Any time you push to GitHub, Vercel auto-deploys.

---

## Step 7 — Invite your league members

1. Share the Vercel URL with all 8 managers
2. Each manager signs up with their email
3. You (as commissioner) go to Supabase dashboard → Table Editor → `teams`
4. Update the `manager_id` column for each team to match the user's ID
   (Find user IDs in Authentication → Users)

Once linked, each manager logs in and sees their own team highlighted.

---

## Project Structure

```
src/
├── app/
│   ├── api/score/route.ts    ← Auto-score proxy (no timeout!)
│   ├── login/page.tsx        ← Login/signup page
│   ├── standings/page.tsx    ← Leaderboard
│   ├── weeks/page.tsx        ← Match scoring
│   ├── teams/page.tsx        ← Team grid
│   ├── teams/[id]/page.tsx   ← Team detail
│   ├── transfers/page.tsx    ← Transfer log
│   ├── waivers/page.tsx      ← Waiver bidding (real-time)
│   └── rules/page.tsx        ← Scoring rules
├── components/layout/Nav.tsx ← Navigation
├── lib/
│   ├── supabase/client.ts    ← Browser Supabase client
│   ├── supabase/server.ts    ← Server Supabase client
│   ├── queries.ts            ← All data fetching
│   └── scoring.ts            ← Fantasy points math
└── types/index.ts            ← TypeScript types
```

---

## Key differences from the HTML file

| Feature | HTML file | Next.js app |
|---|---|---|
| Data storage | localStorage (per browser) | Supabase Postgres (shared) |
| Auth | None | Email/password + magic link |
| Real-time | None | Live waiver bid updates |
| Scoring proxy | Netlify function (26s timeout) | Next.js API route (no limit) |
| Deploy | Netlify drag-and-drop | Vercel (auto-deploy from GitHub) |
| Multi-league | No | Yes (league slug system) |

---

## Troubleshooting

**`npm install` errors** → Make sure Node.js is installed: `node --version`

**Supabase connection errors** → Check your `.env.local` values match exactly what's in Supabase Settings → API

**"League not found"** → Make sure you ran the SQL migration and inserted a row into `leagues` with slug `fantasy-ipl-2026`

**Login not working** → In Supabase → Authentication → URL Configuration → add your Vercel URL to "Redirect URLs"
