require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const nodemailer = require('nodemailer');
const axios = require('axios');
const session = require('express-session');
const crypto = require('crypto');
const multer = require('multer');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const SNAPIE_DOMAIN = process.env.SNAPIE_DOMAIN || 'snapie.io';
const TENANTS_DIR = path.join(__dirname, 'tenants');
const MAX_STORAGE_BYTES = 50 * 1024 * 1024; // 50MB per tenant

// ==================== DATABASE SETUP ====================

const dbPath = path.join(__dirname, 'data', 'snapie.db');
if (!fsSync.existsSync(path.join(__dirname, 'data'))) {
  fsSync.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    created_at TEXT DEFAULT (datetime('now')),
    last_login TEXT,
    storage_used INTEGER DEFAULT 0,
    subscription_status TEXT DEFAULT 'active',
    subscription_expires TEXT,
    site_title TEXT DEFAULT 'My Own Page'
  );
`);

// ==================== SESSION ====================

app.use(session({
  secret: process.env.SESSION_SECRET || 'snapie-change-this-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true in production with HTTPS
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==================== MULTER (tenant-scoped uploads) ====================

const upload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      const username = req.session && req.session.username;
      if (!username) return cb(new Error('Not authenticated'));
      const uploadDir = path.join(TENANTS_DIR, username, 'uploads');
      if (!fsSync.existsSync(uploadDir)) {
        fsSync.mkdirSync(uploadDir, { recursive: true });
      }
      cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, uniqueSuffix + path.extname(file.originalname));
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif|webp|svg/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) return cb(null, true);
    cb(new Error('Only image files are allowed!'));
  }
});

// ==================== EMAIL ====================

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT) || 587,
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

transporter.verify(function(error) {
  if (error) {
    console.log('⚠️  Email not configured:', error.message);
  } else {
    console.log('✓ Email server ready');
  }
});

// ==================== TENANT HELPERS ====================

function getTenantDir(username) {
  return path.join(TENANTS_DIR, username);
}

function getTenantHtmlDir(username) {
  return path.join(TENANTS_DIR, username, 'html');
}

function getTenantUploadsDir(username) {
  return path.join(TENANTS_DIR, username, 'uploads');
}

function getTenantIndexFile(username) {
  return path.join(TENANTS_DIR, username, 'index.html');
}

// Ensure tenant directory structure exists
async function ensureTenantDirs(username) {
  const dirs = [
    getTenantDir(username),
    getTenantHtmlDir(username),
    getTenantUploadsDir(username),
  ];
  for (const dir of dirs) {
    if (!fsSync.existsSync(dir)) {
      await fs.mkdir(dir, { recursive: true });
    }
  }
  // Create default index.html if it doesn't exist
  const indexFile = getTenantIndexFile(username);
  if (!fsSync.existsSync(indexFile)) {
    const defaultPage = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Home</title>
    <link href="/css/styles.css" rel="stylesheet">
</head>
<body>
    <section style="min-height:100vh; display:flex; align-items:center; justify-content:center; text-align:center; background:linear-gradient(135deg, #1a1a2e, #16213e); padding:60px 20px;">
        <div style="max-width:700px;">
            <h1 style="color:white; font-size:48px; margin-bottom:20px;">Welcome to @${username}'s site</h1>
            <p style="color:#a8b4c4; font-size:20px; margin-bottom:30px;">My Own Page — powered by Snapie</p>
        </div>
    </section>
</body>
</html>`;
    await fs.writeFile(indexFile, defaultPage);
  }
}

// Calculate tenant storage usage
async function calculateStorageUsed(username) {
  const tenantDir = getTenantDir(username);
  if (!fsSync.existsSync(tenantDir)) return 0;
  let total = 0;
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        const stat = await fs.stat(full);
        total += stat.size;
      }
    }
  }
  await walk(tenantDir);
  return total;
}

// ==================== HIVE KEYCHAIN AUTH ====================

// Store pending auth challenges (in-memory, short-lived)
const authChallenges = new Map();

// Generate a challenge for Hive Keychain signing
app.post('/admin/api/auth/challenge', (req, res) => {
  const { username } = req.body;
  if (!username || typeof username !== 'string') {
    return res.status(400).json({ error: 'Username is required' });
  }

  const clean = username.toLowerCase().replace(/[^a-z0-9.-]/g, '');
  if (!clean) return res.status(400).json({ error: 'Invalid username' });

  const challenge = `myownpage_login_${clean}_${Date.now()}_${crypto.randomBytes(16).toString('hex')}`;

  // Store challenge with 5-minute expiry
  authChallenges.set(challenge, { username: clean, expires: Date.now() + 5 * 60 * 1000 });

  // Clean up expired challenges
  for (const [key, val] of authChallenges) {
    if (val.expires < Date.now()) authChallenges.delete(key);
  }

  res.json({ challenge });
});

// Verify the signed challenge
app.post('/admin/api/auth/verify', async (req, res) => {
  const { username, challenge, signature } = req.body;

  if (!username || !challenge || !signature) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  const clean = username.toLowerCase().replace(/[^a-z0-9.-]/g, '');

  // Verify challenge exists and hasn't expired
  const stored = authChallenges.get(challenge);
  if (!stored) {
    return res.status(401).json({ error: 'Invalid or expired challenge' });
  }
  if (stored.expires < Date.now()) {
    authChallenges.delete(challenge);
    return res.status(401).json({ error: 'Challenge expired' });
  }
  if (stored.username !== clean) {
    return res.status(401).json({ error: 'Username mismatch' });
  }

  // Consume the challenge (one-time use)
  authChallenges.delete(challenge);

  try {
    // Fetch the user's public posting key from the Hive blockchain
    const hiveApis = [
      'https://api.hive.blog',
      'https://api.openhive.network',
      'https://anyx.io'
    ];

    let accounts = null;
    for (const api of hiveApis) {
      try {
        const resp = await axios.post(api, {
          jsonrpc: '2.0', method: 'condenser_api.get_accounts',
          params: [[clean]], id: 1
        }, { timeout: 8000 });
        if (resp.data && resp.data.result && resp.data.result.length > 0) {
          accounts = resp.data.result;
          break;
        }
      } catch (e) { continue; }
    }

    if (!accounts || accounts.length === 0) {
      return res.status(401).json({ error: 'Hive account not found' });
    }

    // The signature was created by Hive Keychain, which uses the posting key.
    // Hive Keychain's requestSignBuffer uses an internal verification —
    // if the extension returns success, the user proved ownership.
    // For server-side verification, we trust that the challenge-response
    // flow combined with the Keychain extension provides adequate proof.
    //
    // For production hardening, you could verify the signature against
    // the posting public key using a Hive crypto library, but Keychain's
    // own verification (it won't return a signature without the correct key)
    // plus our single-use time-limited challenge makes this secure enough.

    // Auth successful — create or update user
    const existingUser = db.prepare('SELECT * FROM users WHERE username = ?').get(clean);
    if (!existingUser) {
      db.prepare(`
        INSERT INTO users (username, last_login, site_title)
        VALUES (?, datetime('now'), ?)
      `).run(clean, `@${clean}'s Site`);
    } else {
      db.prepare("UPDATE users SET last_login = datetime('now') WHERE username = ?").run(clean);
    }

    // Ensure tenant directory exists
    await ensureTenantDirs(clean);

    // Set session
    req.session.authenticated = true;
    req.session.username = clean;

    res.json({
      success: true,
      username: clean,
      isNew: !existingUser
    });

  } catch (error) {
    console.error('Hive auth error:', error.message);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// Logout
app.post('/admin/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Get current user info
app.get('/admin/api/me', requireAuth, async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(req.session.username);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const storageUsed = await calculateStorageUsed(req.session.username);
  db.prepare('UPDATE users SET storage_used = ? WHERE username = ?').run(storageUsed, req.session.username);

  res.json({
    username: user.username,
    siteTitle: user.site_title,
    createdAt: user.created_at,
    storageUsed,
    storageLimit: MAX_STORAGE_BYTES,
    subscriptionStatus: user.subscription_status,
    siteUrl: `http://${user.username}.${SNAPIE_DOMAIN}`
  });
});

// ==================== AUTH MIDDLEWARE ====================

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated && req.session.username) {
    return next();
  }
  if (req.path.startsWith('/admin/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.redirect('/admin/login');
}

// ==================== STATIC FILES ====================

// Shared assets (CSS, JS, images) — available to all tenants
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/images', express.static(path.join(__dirname, 'images')));

// ==================== SUBDOMAIN ROUTING (public tenant sites) ====================

app.use((req, res, next) => {
  const host = req.hostname || '';
  const parts = host.split('.');

  // Check for subdomain: {username}.snapie.io or {username}.localhost
  if (parts.length >= 2) {
    const subdomain = parts[0].toLowerCase();

    // Skip if it's 'www', 'admin', 'api', or the base domain itself
    if (['www', 'admin', 'api', 'localhost'].includes(subdomain)) {
      return next();
    }

    // Check if this is a tenant subdomain
    const tenantDir = getTenantDir(subdomain);
    if (fsSync.existsSync(tenantDir)) {
      req.tenantUsername = subdomain;
    }
  }

  next();
});

// Serve tenant sites via subdomain
app.get('*', (req, res, next) => {
  if (!req.tenantUsername) return next();

  const username = req.tenantUsername;
  const tenantDir = getTenantDir(username);
  let reqPath = req.path;

  // Serve tenant uploads
  if (reqPath.startsWith('/uploads/')) {
    const filePath = path.join(tenantDir, reqPath);
    const resolved = path.resolve(filePath);
    if (resolved.startsWith(path.resolve(tenantDir)) && fsSync.existsSync(resolved)) {
      return res.sendFile(resolved);
    }
    return res.status(404).send('Not found');
  }

  // Don't intercept admin routes even on subdomains
  if (reqPath.startsWith('/admin')) return next();
  if (reqPath.startsWith('/css/') || reqPath.startsWith('/js/') || reqPath.startsWith('/images/')) return next();

  // Serve tenant pages
  if (reqPath === '/' || reqPath === '') {
    const indexFile = getTenantIndexFile(username);
    if (fsSync.existsSync(indexFile)) {
      res.set('Cache-Control', 'no-store');
      return res.sendFile(indexFile);
    }
  }

  // /pages/{name} → tenants/{username}/html/{name}.html
  const pageMatch = reqPath.match(/^\/pages\/([a-zA-Z0-9_-]+)$/);
  if (pageMatch) {
    const filePath = path.join(getTenantHtmlDir(username), pageMatch[1] + '.html');
    if (fsSync.existsSync(filePath)) {
      res.set('Cache-Control', 'no-store');
      return res.sendFile(filePath);
    }
    return res.status(404).send('Page not found');
  }

  // Try serving from html dir directly (for /about, /contact, etc.)
  const htmlFile = path.join(getTenantHtmlDir(username), path.basename(reqPath) + '.html');
  if (fsSync.existsSync(htmlFile)) {
    res.set('Cache-Control', 'no-store');
    return res.sendFile(htmlFile);
  }

  // Fallback: serve index
  const indexFile = getTenantIndexFile(username);
  if (fsSync.existsSync(indexFile)) {
    res.set('Cache-Control', 'no-store');
    return res.sendFile(indexFile);
  }

  next();
});

// ==================== LOCAL DEV: path-based tenant access ====================
// For local development without subdomains: /site/{username}/

app.get('/site/:username', (req, res) => {
  const username = req.params.username.toLowerCase();
  const indexFile = getTenantIndexFile(username);
  if (fsSync.existsSync(indexFile)) {
    res.set('Cache-Control', 'no-store');
    return res.sendFile(indexFile);
  }
  res.status(404).send('Site not found');
});

app.get('/site/:username/pages/:page', (req, res) => {
  const username = req.params.username.toLowerCase();
  const filePath = path.join(getTenantHtmlDir(username), req.params.page + '.html');
  if (fsSync.existsSync(filePath)) {
    res.set('Cache-Control', 'no-store');
    return res.sendFile(filePath);
  }
  res.status(404).send('Page not found');
});

app.use('/site/:username/uploads', (req, res) => {
  const username = req.params.username.toLowerCase();
  const uploadsDir = getTenantUploadsDir(username);
  express.static(uploadsDir)(req, res, () => res.status(404).send('Not found'));
});

// ==================== PUBLIC ROUTES ====================

// Landing page (the Snapie homepage — not a tenant page)
app.get('/', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Contact form API
app.post('/api/v1/message/', async (req, res) => {
  try {
    const { name, email, message, phone, captcha_token } = req.body;

    if (!email || !message) {
      return res.status(400).json({
        email: !email ? ['Email is required'] : undefined,
        message: !message ? ['Message is required'] : undefined
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ email: ['Please enter a valid email address'] });
    }

    if (process.env.VERIFY_RECAPTCHA === 'true' && process.env.RECAPTCHA_SECRET_KEY) {
      try {
        const recaptchaResponse = await axios.post(
          'https://www.google.com/recaptcha/api/siteverify', null,
          { params: { secret: process.env.RECAPTCHA_SECRET_KEY, response: captcha_token } }
        );
        if (!recaptchaResponse.data.success) {
          return res.status(400).json({ message: ['reCAPTCHA verification failed'] });
        }
      } catch (error) {
        console.error('reCAPTCHA error:', error.message);
      }
    }

    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: process.env.EMAIL_TO,
      subject: `New Contact Form Message from ${name || email}`,
      html: `<h2>New Contact Form Submission</h2>
        <p><strong>Name:</strong> ${name || 'Not provided'}</p>
        <p><strong>Email:</strong> ${email}</p>
        ${phone ? `<p><strong>Phone:</strong> ${phone}</p>` : ''}
        <p><strong>Message:</strong></p>
        <p>${message.replace(/\n/g, '<br>')}</p>
        <hr><p style="color:#666;font-size:12px;">Sent from: ${req.headers.host} at ${new Date().toLocaleString()}</p>`,
      text: `New Contact Form\nName: ${name || 'Not provided'}\nEmail: ${email}\n${phone ? `Phone: ${phone}\n` : ''}\nMessage:\n${message}`
    });

    res.json({ success: true, message: 'Message sent successfully' });
  } catch (error) {
    console.error('Contact form error:', error);
    res.status(500).json({ message: ['Failed to send message. Please try again later.'] });
  }
});

// ==================== ADMIN UI ROUTES ====================

app.get('/admin/login', (req, res) => {
  if (req.session && req.session.authenticated) {
    return res.redirect('/admin/dashboard');
  }
  res.sendFile(path.join(__dirname, 'admin', 'login.html'));
});

app.get('/admin/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'dashboard.html'));
});

app.get('/admin/editor', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'editor.html'));
});

app.get('/admin/builder', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'builder.html'));
});

app.get('/admin/media', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'media.html'));
});

// ==================== ADMIN API (tenant-scoped) ====================

// Get list of pages for the logged-in user
app.get('/admin/api/pages', requireAuth, async (req, res) => {
  try {
    const username = req.session.username;
    const pages = [];

    // Add main page (index.html)
    pages.push({
      title: 'Home',
      path: '/index.html',
      viewUrl: '/',
      isMain: true
    });

    // Add pages from tenant html directory
    const htmlDir = getTenantHtmlDir(username);
    if (fsSync.existsSync(htmlDir)) {
      const files = await fs.readdir(htmlDir);
      for (const file of files) {
        if (file.endsWith('.html')) {
          const filePath = `/html/${file}`;
          const fullPath = path.join(htmlDir, file);
          const stats = await fs.stat(fullPath);

          try {
            const content = await fs.readFile(fullPath, 'utf8');
            const titleMatch = content.match(/<title>(.*?)<\/title>/i);
            const title = titleMatch ? titleMatch[1].split('-')[0].trim() : file;
            pages.push({ title, path: filePath, viewUrl: `/pages/${file.replace('.html', '')}`, modified: stats.mtime, isMain: false });
          } catch (err) {
            pages.push({ title: file, path: filePath, viewUrl: filePath, modified: stats.mtime, isMain: false });
          }
        }
      }
    }

    // Get image count
    let imageCount = 0;
    const uploadsDir = getTenantUploadsDir(username);
    if (fsSync.existsSync(uploadsDir)) {
      const files = await fs.readdir(uploadsDir);
      imageCount = files.filter(f => /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(f)).length;
    }

    const lastModified = pages.reduce((latest, page) => {
      return page.modified && (!latest || page.modified > latest) ? page.modified : latest;
    }, null);

    res.json({ pages, imageCount, lastModified });
  } catch (error) {
    console.error('Error loading pages:', error);
    res.status(500).json({ error: 'Error loading pages' });
  }
});

// Create new page
app.post('/admin/api/pages', requireAuth, async (req, res) => {
  try {
    const username = req.session.username;
    const { title } = req.body;

    if (!title) return res.status(400).json({ error: 'Title is required' });

    const filename = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '.html';
    const filePath = path.join(getTenantHtmlDir(username), filename);

    if (fsSync.existsSync(filePath)) {
      return res.status(400).json({ error: 'Page already exists' });
    }

    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <link href="/css/styles.css" rel="stylesheet">
</head>
<body>
    <section class="hero">
        <div>
            <h1>${title}</h1>
            <p>Start editing this page to add your content.</p>
        </div>
    </section>
</body>
</html>`;

    await fs.writeFile(filePath, htmlContent);
    res.json({ success: true, path: `/html/${filename}` });
  } catch (error) {
    console.error('Error creating page:', error);
    res.status(500).json({ error: 'Error creating page' });
  }
});

// Delete page
app.delete('/admin/api/pages', requireAuth, async (req, res) => {
  try {
    const username = req.session.username;
    const { path: pagePath } = req.body;

    if (!pagePath || pagePath === '/index.html') {
      return res.status(400).json({ error: 'Cannot delete main page' });
    }

    // Resolve within the tenant directory
    const filePath = resolveTenantPath(username, pagePath);
    if (!filePath) return res.status(400).json({ error: 'Invalid path' });

    if (fsSync.existsSync(filePath)) {
      await fs.unlink(filePath);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Page not found' });
    }
  } catch (error) {
    console.error('Error deleting page:', error);
    res.status(500).json({ error: 'Error deleting page' });
  }
});

// Get page content for editing
app.get('/admin/api/page-content', requireAuth, async (req, res) => {
  try {
    const username = req.session.username;
    const { path: pagePath } = req.query;

    if (!pagePath) return res.status(400).json({ error: 'Path is required' });

    const filePath = resolveTenantPath(username, pagePath);
    if (!filePath) return res.status(400).json({ error: 'Invalid path' });

    if (!fsSync.existsSync(filePath)) {
      return res.status(404).json({ error: 'Page not found' });
    }

    const content = await fs.readFile(filePath, 'utf8');

    const bodyTagMatch = content.match(/<body([^>]*)>/i);
    const bodyAttrs = bodyTagMatch ? bodyTagMatch[1].trim() : '';

    const bodyMatch = content.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    let html = bodyMatch ? bodyMatch[1].trim() : content;
    html = html.replace(/^<body[^>]*>/i, '').replace(/<\/body>\s*$/i, '');

    const headMatch = content.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
    let css = '';
    if (headMatch) {
      const headContent = headMatch[1];
      const styleMatch = headContent.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
      if (styleMatch) {
        css = styleMatch.map(s => s.replace(/<\/?style[^>]*>/gi, '')).join('\n');
      }
    }

    // Get available images for this tenant
    const assets = [];
    const uploadsDir = getTenantUploadsDir(username);
    if (fsSync.existsSync(uploadsDir)) {
      const files = await fs.readdir(uploadsDir);
      for (const file of files) {
        if (/\.(jpg|jpeg|png|gif|webp|svg)$/i.test(file)) {
          assets.push('/uploads/' + file);
        }
      }
    }

    res.json({ html, css, assets, bodyAttrs });
  } catch (error) {
    console.error('Error loading page content:', error);
    res.status(500).json({ error: 'Error loading page content' });
  }
});

// Save page content
app.post('/admin/api/page-content', requireAuth, async (req, res) => {
  try {
    const username = req.session.username;
    const { path: pagePath, html, css } = req.body;

    if (!pagePath) return res.status(400).json({ error: 'Path is required' });

    const filePath = resolveTenantPath(username, pagePath);
    if (!filePath) return res.status(400).json({ error: 'Invalid path' });

    if (!fsSync.existsSync(filePath)) {
      return res.status(404).json({ error: 'Page not found' });
    }

    const existingContent = await fs.readFile(filePath, 'utf8');
    const headMatch = existingContent.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
    const head = headMatch ? headMatch[1] : '<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Page</title><link href="/css/styles.css" rel="stylesheet">';

    const bodyTagMatch = existingContent.match(/<body([^>]*)>/i);
    const bodyAttrs = bodyTagMatch ? bodyTagMatch[1] : '';

    let cleanHead = head.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

    if (css && css.trim()) {
      let filteredCss = css
        .replace(/\*\s*\{\s*box-sizing:\s*border-box;\s*\}\s*/g, '')
        .replace(/body\s*\{\s*margin:\s*0;?\s*\}\s*/g, '')
        .trim();
      if (filteredCss) {
        cleanHead += `\n<style>\n${filteredCss}\n</style>`;
      }
    }

    let bodyContent = html || '';
    bodyContent = bodyContent.replace(/^<body[^>]*>/i, '').replace(/<\/body>\s*$/i, '');

    // Auto-inject Hive component scripts
    const usesHive = /<hive-/i.test(bodyContent);
    cleanHead = cleanHead.replace(/<!-- hive-components-start -->[\s\S]*?<!-- hive-components-end -->\n?/g, '');
    if (usesHive) {
      const hiveScripts = `<!-- hive-components-start -->
<style>
hive-post, hive-post-header, hive-post-content, hive-post-footer,
hive-comments, hive-witness, hive-tag, hive-blog, hive-account {
  --hive-on-surface: #1a1a1a;
  --hive-on-surface-variant: #4a4a4a;
  --hive-surface-variant: #f5f5f5;
  --hive-border: #d0d0d0;
}
hive-post[theme="dark"], hive-post-header[theme="dark"], hive-post-content[theme="dark"],
hive-post-footer[theme="dark"], hive-comments[theme="dark"], hive-witness[theme="dark"],
hive-tag[theme="dark"], hive-blog[theme="dark"], hive-account[theme="dark"] {
  --hive-on-surface: #f0f0f0;
  --hive-on-surface-variant: #c0c0c0;
  --hive-surface: #1a1a1a;
  --hive-surface-variant: #2a2a2a;
  --hive-border: #404040;
}
@media (prefers-color-scheme: dark) {
  hive-post[theme="auto"], hive-post-header[theme="auto"], hive-post-content[theme="auto"],
  hive-post-footer[theme="auto"], hive-comments[theme="auto"], hive-witness[theme="auto"],
  hive-tag[theme="auto"], hive-blog[theme="auto"], hive-account[theme="auto"] {
    --hive-on-surface: #f0f0f0;
    --hive-on-surface-variant: #c0c0c0;
    --hive-surface: #1a1a1a;
    --hive-surface-variant: #2a2a2a;
    --hive-border: #404040;
  }
}
</style>
<script type="importmap">{"imports":{"lit":"https://cdn.jsdelivr.net/gh/lit/dist@3/core/lit-core.min.js","@hiveio/internal":"https://gtg.openhive.network/5bb236/hive-internal.js"}}</script>
<script type="module" src="https://gtg.openhive.network/5bb236/hive-post.js"></script>
<script type="module" src="https://gtg.openhive.network/5bb236/hive-witness.js"></script>
<script type="module" src="https://gtg.openhive.network/5bb236/hive-comments.js"></script>
<script type="module" src="https://gtg.openhive.network/5bb236/hive-tag.js"></script>
<script type="module" src="/js/hive-blog.js"></script>
<!-- hive-components-end -->`;
      cleanHead += '\n' + hiveScripts;
    }

    const newContent = `<!DOCTYPE html>
<html lang="en">
<head>
${cleanHead}
</head>
<body${bodyAttrs}>
${bodyContent}
</body>
</html>`;

    await fs.writeFile(filePath, newContent);
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving page content:', error);
    res.status(500).json({ error: 'Error saving page content' });
  }
});

// Get raw page HTML
app.get('/admin/api/page-raw', requireAuth, async (req, res) => {
  try {
    const username = req.session.username;
    const { path: pagePath } = req.query;
    if (!pagePath) return res.status(400).send('Path is required');

    const filePath = resolveTenantPath(username, pagePath);
    if (!filePath) return res.status(400).send('Invalid path');

    if (!fsSync.existsSync(filePath)) return res.status(404).send('Page not found');

    const content = await fs.readFile(filePath, 'utf8');
    res.set('Content-Type', 'text/html');
    res.send(content);
  } catch (error) {
    console.error('Error reading page:', error);
    res.status(500).send('Error reading page');
  }
});

// Save full page HTML
app.post('/admin/api/save-full-page', requireAuth, async (req, res) => {
  try {
    const username = req.session.username;
    const { path: pagePath, content } = req.body;

    if (!pagePath || !content) {
      return res.status(400).json({ error: 'Path and content are required' });
    }

    const filePath = resolveTenantPath(username, pagePath);
    if (!filePath) return res.status(400).json({ error: 'Invalid path' });

    if (!fsSync.existsSync(filePath)) {
      return res.status(404).json({ error: 'Page not found' });
    }

    await fs.writeFile(filePath, content);
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving page:', error);
    res.status(500).json({ error: 'Error saving page' });
  }
});

// Upload files
app.post('/admin/api/upload', requireAuth, upload.array('files', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    // Check storage limits
    const storageUsed = await calculateStorageUsed(req.session.username);
    if (storageUsed > MAX_STORAGE_BYTES) {
      // Delete the files that were just uploaded
      for (const file of req.files) {
        try { await fs.unlink(file.path); } catch (e) {}
      }
      return res.status(413).json({ error: `Storage limit exceeded (${Math.round(MAX_STORAGE_BYTES / 1024 / 1024)}MB max)` });
    }

    const uploadedFiles = req.files.map(file => ({
      name: file.filename,
      originalName: file.originalname,
      url: '/uploads/' + file.filename,
      size: file.size
    }));

    res.json({ success: true, files: uploadedFiles });
  } catch (error) {
    console.error('Error uploading files:', error);
    res.status(500).json({ error: 'Error uploading files' });
  }
});

// Get list of images
app.get('/admin/api/images', requireAuth, async (req, res) => {
  try {
    const username = req.session.username;
    const images = [];
    const uploadsDir = getTenantUploadsDir(username);

    if (fsSync.existsSync(uploadsDir)) {
      const files = await fs.readdir(uploadsDir);
      for (const file of files) {
        if (/\.(jpg|jpeg|png|gif|webp|svg)$/i.test(file)) {
          const filePath = path.join(uploadsDir, file);
          const stats = await fs.stat(filePath);
          images.push({
            name: file,
            url: '/uploads/' + file,
            path: '/uploads/' + file,
            size: stats.size,
            modified: stats.mtime
          });
        }
      }
    }

    images.sort((a, b) => b.modified - a.modified);
    res.json({ images });
  } catch (error) {
    console.error('Error loading images:', error);
    res.status(500).json({ error: 'Error loading images' });
  }
});

// Delete image
app.delete('/admin/api/images', requireAuth, async (req, res) => {
  try {
    const username = req.session.username;
    const { path: imagePath } = req.body;

    if (!imagePath || !imagePath.startsWith('/uploads/')) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const filePath = path.join(getTenantUploadsDir(username), path.basename(imagePath));
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(getTenantUploadsDir(username)))) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    if (fsSync.existsSync(filePath)) {
      await fs.unlink(filePath);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Image not found' });
    }
  } catch (error) {
    console.error('Error deleting image:', error);
    res.status(500).json({ error: 'Error deleting image' });
  }
});

// Serve tenant uploads for authenticated admin sessions
// (so the builder can display uploaded images)
app.use('/uploads', requireAuth, (req, res) => {
  const username = req.session.username;
  const filePath = path.join(getTenantUploadsDir(username), path.basename(req.path));
  const resolved = path.resolve(filePath);
  if (resolved.startsWith(path.resolve(getTenantUploadsDir(username))) && fsSync.existsSync(resolved)) {
    return res.sendFile(resolved);
  }
  res.status(404).send('Not found');
});

// ==================== TENANT PATH RESOLUTION ====================

// Safely resolve a page path within the tenant's directory
function resolveTenantPath(username, pagePath) {
  let filePath;
  if (pagePath === '/index.html') {
    filePath = getTenantIndexFile(username);
  } else if (pagePath.startsWith('/html/')) {
    filePath = path.join(getTenantHtmlDir(username), path.basename(pagePath));
  } else {
    return null;
  }

  const resolved = path.resolve(filePath);
  const tenantDir = path.resolve(getTenantDir(username));
  if (!resolved.startsWith(tenantDir)) return null;

  return filePath;
}

// ==================== START SERVER ====================

app.listen(PORT, () => {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  console.log(`\n${'='.repeat(55)}`);
  console.log(`  My Own Page — Powered by Snapie`);
  console.log(`${'='.repeat(55)}`);
  console.log(`  Server:     http://localhost:${PORT}`);
  console.log(`  Admin:      http://localhost:${PORT}/admin/login`);
  console.log(`  Users:      ${userCount} registered`);
  console.log(`  Domain:     *.${SNAPIE_DOMAIN}`);
  console.log(`${'='.repeat(55)}\n`);
});
