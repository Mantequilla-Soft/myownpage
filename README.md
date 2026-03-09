# Site Builder

A Node.js website builder with a visual drag-and-drop page editor and Hive blockchain component integration.

## Features

- Visual page builder (GrapesJS-based) with drag-and-drop blocks
- Admin panel with page management, media uploads, and inline editing
- Hive blockchain components: blog feeds, posts, comments, witness info, tag feeds
- Contact form with email notifications
- Clean, responsive default stylesheet

## Quick Start

```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your settings

# Start the server
npm start
```

Visit: http://localhost:3000

Admin panel: http://localhost:3000/admin (default: admin / changeme123)

## Configuration

Edit `.env` to configure:

- `PORT` — Server port (default: 3000)
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` — Admin panel credentials
- `SESSION_SECRET` — Session encryption key
- `EMAIL_*` — SMTP settings for the contact form

## File Structure

```
├── server.js           # Express server
├── index.html          # Landing page
├── html/               # Additional pages (managed via admin)
├── css/styles.css      # Base stylesheet
├── js/
│   └── hive-blog.js    # Custom Hive blog feed component
├── admin/
│   ├── builder.html    # Visual page builder
│   ├── dashboard.html  # Admin dashboard
│   ├── login.html      # Admin login
│   ├── editor.html     # Simple page editor
│   └── media.html      # Media manager
├── uploads/            # User-uploaded images
└── .env.example        # Environment template
```

## Scripts

- `npm start` — Start production server
- `npm run dev` — Start with auto-restart (nodemon)
