# Flick Streaming Platform - AI Context & Status

**Target Audience:** Any AI Assistant reading this folder.
**Current Project State:** Advanced Architecture (Moving from Prototype to Production)

## 📌 Current Step (Where we left off)
We just completed **Phase 2 & Phase 3 Architecture: JWT Authentication & Caching**.
The AI and user have successfully integrated strict TypeScript, React Server Components (Next.js), Redis Caching (NestJS), and True Authentication using JWT and bcrypt.

**➡️ THE IMMEDIATE NEXT STEP IS:** 
Implement Wallet & Monetization Logic. Create `UserCoin` spending endpoints to lock/unlock premium episodes. Connect the frontend player so it checks the backend before allowing playback.

---

## 🏗 System Architecture

### Frontend (`/flick-app`)
* **Framework:** Next.js 16 (App Router)
* **Language:** TypeScript (`.tsx`)
* **Styling:** CSS Modules (No Tailwind)
* **Key Implementations:** 
  * Strict end-to-end type safety using shared interfaces (`src/types/index.ts`).
  * React Server Components used for heavy data fetching (e.g., `/discover`).
  * Horizontal scrolling and responsive CSS grids implemented natively.

### Backend (`/flick-api`)
* **Framework:** NestJS
* **Database:** PostgreSQL (via Prisma ORM)
* **Port:** 3001
* **Key Implementations:**
  * DTO validation using `class-validator` (e.g., `CreateMovieDto`).
  * Cache-Aside pattern implemented in `MoviesModule` via `@nestjs/cache-manager` + Keyv. Backed by real Redis when `REDIS_URL` is set (shared across instances, survives process restarts); falls back to an in-process in-memory store when it isn't (local dev / CI). A Redis outage is logged and degrades gracefully to querying Postgres directly, it does not crash the API.
  * Prisma schema contains optimized B-Tree indexes for high-frequency queries.

---

## 🚀 Completed Milestones
- [x] Create PostgreSQL database and Prisma schema.
- [x] Seed database with Thai streaming content.
- [x] Wire up Next.js frontend to fetch real data from NestJS backend.
- [x] Migrate Next.js to Strict TypeScript.
- [x] Implement React Server Components for SEO and speed.
- [x] Implement Backend DTO validation.
- [x] Implement Backend Caching (In-memory/Redis).
- [x] **Auth:** Replaced `auth.js` localStorage logic with JWT + bcrypt + PostgreSQL.

## 🎯 Upcoming Milestones (TODO)
- [ ] **Monetization:** Create `UserCoin` spending endpoints to lock/unlock premium episodes.
- [ ] **Video Player:** Integrate `Video.js` or `Plyr` to play actual HLS (.m3u8) streams.
- [ ] **Admin Panel:** Build a dashboard to upload new movies and seasons.
