# My Own Page — Powered by Snapie

A multi-tenant website builder for the Hive blockchain. Build your own website with a visual editor, log in with Hive Keychain, and publish to your own subdomain — no coding required.

**Live at:** [snapie.io](https://snapie.io)

---

## Features

- **Hive Keychain Login** — No passwords, no signup forms. Your Hive account is your identity.
- **Visual Page Builder** — Drag-and-drop editor powered by GrapesJS. Click to edit text, drag to rearrange.
- **10 Starter Templates** — Blogger, Portfolio, Musician, Photographer, Small Business, CV, Restaurant, Vlogger, Community/DAO, Link-in-Bio.
- **Hive Components** — Embed your blog feed, posts, comments, witness info, and tag feeds as native web components.
- **Your Subdomain** — Every user gets `yourname.snapie.io`.
- **50 MB Storage** — Upload images (JPEG, PNG, GIF, WebP, SVG).
- **Mobile Ready** — All templates and the builder are responsive.

---

## Delegation Support — The Butter Board

Snapie is **free for everyone**. The project is funded through HP (Hive Power) delegations. Your stake stays yours — you can undelegate at any time.

### Tiers

| Tier | HP Delegated | What You Get |
|------|-------------|--------------|
| **Free** | 0 | Full access, small "Powered by Snapie" banner on your site |
| **Butterino** | 100–499 HP | Banner replaced with pride badge + leaderboard spot |
| **Butterist** | 500–999 HP | Higher tier badge |
| **Butterist Supreme** | 1,000–5,000 HP | Premium badge |
| **Butterist Lord** | 5,001+ HP | Top tier badge |

Delegators appear on the **Butter Board** leaderboard on the landing page, ranked by delegation amount. If you undelegate, the free-tier banner reappears immediately. No pages are ever deleted.

---

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Hive Keychain](https://hive-keychain.com/) browser extension (for login)

### Installation

```bash
npm install
cp .env.example .env
# Edit .env with your settings
npm run dev
```

Visit: http://localhost:3000

Admin panel: http://localhost:3000/admin/login

Local dev tenant preview: http://localhost:3000/site/{username}

---

## Configuration

Edit `.env` to configure:

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `SNAPIE_DOMAIN` | Base domain for subdomains | `snapie.io` |
| `SESSION_SECRET` | Session encryption key | (required) |
| `DELEGATION_TARGET` | Hive account to receive HP delegations | `mantequilla-soft` |
| `EMAIL_HOST` | SMTP host for contact forms | `smtp.gmail.com` |
| `EMAIL_PORT` | SMTP port | `587` |
| `EMAIL_USER` / `EMAIL_PASS` | SMTP credentials | — |
| `EMAIL_FROM` / `EMAIL_TO` | Sender/recipient addresses | — |
| `RECAPTCHA_SECRET_KEY` | Google reCAPTCHA secret (optional) | — |
| `VERIFY_RECAPTCHA` | Enable reCAPTCHA | `false` |

---

## File Structure

```
server.js              Express server, all API routes, delegation sync
index.html             Landing page + Butter Board

admin/
  login.html           Hive Keychain login
  onboarding.html      First-time template selection
  dashboard.html       Page management + delegation status
  builder.html         GrapesJS visual editor
  media.html           Image upload manager

templates/             10 starter page templates
css/styles.css         Shared stylesheet
js/hive-blog.js        Hive blog feed web component (Lit)

data/snapie.db         SQLite database (users + delegations)
tenants/{username}/    Per-user content
  index.html           Homepage
  html/                Additional pages
  uploads/             User images
```

---

## API Endpoints

### Public

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/butter-board` | Delegation leaderboard |
| POST | `/api/v1/message/` | Contact form |

### Auth

| Method | Path | Description |
|--------|------|-------------|
| POST | `/admin/api/auth/challenge` | Generate login challenge |
| POST | `/admin/api/auth/verify` | Verify Keychain signature |
| POST | `/admin/api/logout` | End session |

### Authenticated

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/me` | User info + delegation status |
| GET | `/admin/api/pages` | List pages |
| POST | `/admin/api/pages` | Create page |
| DELETE | `/admin/api/pages` | Delete page |
| GET/POST | `/admin/api/page-content` | Get/save page content |
| POST | `/admin/api/save-full-page` | Save from builder |
| POST | `/admin/api/upload` | Upload image |
| GET | `/admin/api/images` | List images |
| DELETE | `/admin/api/images` | Delete image |
| GET | `/admin/api/templates` | List templates |
| POST | `/admin/api/apply-homepage-template` | Apply template |

---

## Scripts

- `npm start` — Start server
- `npm run dev` — Start with auto-restart (nodemon)

---

## Tech Stack

- **Runtime:** Node.js + Express
- **Database:** SQLite (better-sqlite3, WAL mode)
- **Editor:** GrapesJS
- **Auth:** Hive Keychain (challenge-response)
- **Blockchain:** Hive RPC nodes with failover
- **Components:** Lit web components

---

Built by [@mantequilla-soft](https://hive.blog/@mantequilla-soft) on the Hive blockchain.
