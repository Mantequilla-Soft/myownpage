require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const nodemailer = require('nodemailer');
const axios = require('axios');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// Configure session
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, // Set to true in production with HTTPS
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Parse JSON and URL-encoded bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fsSync.existsSync(uploadDir)) {
      fsSync.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif|webp|svg/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  }
});

// Configure email transporter
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT) || 587,
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Verify email configuration on startup
transporter.verify(function(error, success) {
  if (error) {
    console.log('⚠️  Email configuration error:', error.message);
    console.log('   Contact form will not work until email is configured properly.');
  } else {
    console.log('✓ Email server is ready to send messages');
  }
});

// ==================== AUTHENTICATION MIDDLEWARE ====================

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  
  // For API requests, return 401
  if (req.path.startsWith('/admin/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  // For page requests, redirect to login
  res.redirect('/admin/login');
}

// ==================== STATIC FILES ====================

// Serve only public asset directories (not the entire project root)
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/html', express.static(path.join(__dirname, 'html')));

// ==================== PUBLIC ROUTES ====================

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve pages from html directory by filename
app.get('/pages/:name', (req, res) => {
  const filePath = path.join(__dirname, 'html', req.params.name + '.html');
  if (fsSync.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send('Page not found');
  }
});

// Contact form API endpoint
app.post('/api/v1/message/', async (req, res) => {
  try {
    const { name, email, message, phone, captcha_token } = req.body;

    // Basic validation
    if (!email || !message) {
      return res.status(400).json({
        email: !email ? ['Email is required'] : undefined,
        message: !message ? ['Message is required'] : undefined
      });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        email: ['Please enter a valid email address']
      });
    }

    // Optional: Verify reCAPTCHA
    if (process.env.VERIFY_RECAPTCHA === 'true' && process.env.RECAPTCHA_SECRET_KEY) {
      try {
        const recaptchaResponse = await axios.post(
          `https://www.google.com/recaptcha/api/siteverify`,
          null,
          {
            params: {
              secret: process.env.RECAPTCHA_SECRET_KEY,
              response: captcha_token
            }
          }
        );

        if (!recaptchaResponse.data.success) {
          return res.status(400).json({
            message: ['reCAPTCHA verification failed']
          });
        }
      } catch (error) {
        console.error('reCAPTCHA verification error:', error.message);
      }
    }

    // Prepare email
    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: process.env.EMAIL_TO,
      subject: `New Contact Form Message from ${name || email}`,
      html: `
        <h2>New Contact Form Submission</h2>
        <p><strong>Name:</strong> ${name || 'Not provided'}</p>
        <p><strong>Email:</strong> ${email}</p>
        ${phone ? `<p><strong>Phone:</strong> ${phone}</p>` : ''}
        <p><strong>Message:</strong></p>
        <p>${message.replace(/\n/g, '<br>')}</p>
        <hr>
        <p style="color: #666; font-size: 12px;">Sent from: ${req.headers.host} at ${new Date().toLocaleString()}</p>
      `,
      text: `
New Contact Form Submission

Name: ${name || 'Not provided'}
Email: ${email}
${phone ? `Phone: ${phone}` : ''}

Message:
${message}

---
Sent from: ${req.headers.host} at ${new Date().toLocaleString()}
      `
    };

    // Send email
    await transporter.sendMail(mailOptions);

    console.log(`✓ Contact form message sent from ${email}`);
    res.json({ success: true, message: 'Message sent successfully' });

  } catch (error) {
    console.error('Error sending contact form:', error);
    res.status(500).json({
      message: ['Failed to send message. Please try again later.']
    });
  }
});

// ==================== ADMIN ROUTES ====================

// Admin login page
app.get('/admin/login', (req, res) => {
  if (req.session && req.session.authenticated) {
    return res.redirect('/admin/dashboard');
  }
  res.sendFile(path.join(__dirname, 'admin', 'login.html'));
});

// Admin login API
app.post('/admin/api/login', async (req, res) => {
  const { username, password } = req.body;
  
  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD || 'changeme123';
  
  if (username === adminUsername && password === adminPassword) {
    req.session.authenticated = true;
    req.session.username = username;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid username or password' });
  }
});

// Admin logout
app.post('/admin/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Admin dashboard
app.get('/admin/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'dashboard.html'));
});

// Admin editor
app.get('/admin/editor', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'editor.html'));
});

// Admin page builder (for new pages)
app.get('/admin/builder', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'builder.html'));
});

// Admin media manager
app.get('/admin/media', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'media.html'));
});

// ==================== ADMIN API ROUTES ====================

// Map file paths to public-facing URLs
const fileToUrl = {
  '/index.html': '/',
};

// Get list of pages
app.get('/admin/api/pages', requireAuth, async (req, res) => {
  try {
    const pages = [];

    // Add main page
    pages.push({
      title: 'Home',
      path: '/index.html',
      viewUrl: '/',
      isMain: true
    });

    // Add pages from html directory
    const htmlDir = path.join(__dirname, 'html');
    if (fsSync.existsSync(htmlDir)) {
      const files = await fs.readdir(htmlDir);

      for (const file of files) {
        if (file.endsWith('.html')) {
          const filePath = `/html/${file}`;
          const stats = await fs.stat(path.join(htmlDir, file));

          // Try to extract title from file
          try {
            const content = await fs.readFile(path.join(htmlDir, file), 'utf8');
            const titleMatch = content.match(/<title>(.*?)<\/title>/i);
            const title = titleMatch ? titleMatch[1].split('-')[0].trim() : file;

            pages.push({
              title,
              path: filePath,
              viewUrl: fileToUrl[filePath] || filePath,
              modified: stats.mtime,
              isMain: false
            });
          } catch (err) {
            pages.push({
              title: file,
              path: filePath,
              viewUrl: fileToUrl[filePath] || filePath,
              modified: stats.mtime,
              isMain: false
            });
          }
        }
      }
    }
    
    // Get image count
    let imageCount = 0;
    const uploadsDir = path.join(__dirname, 'uploads');
    if (fsSync.existsSync(uploadsDir)) {
      const files = await fs.readdir(uploadsDir);
      imageCount = files.filter(f => /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(f)).length;
    }
    
    // Get last modified date
    const lastModified = pages.reduce((latest, page) => {
      return page.modified && (!latest || page.modified > latest) ? page.modified : latest;
    }, null);
    
    res.json({ 
      pages,
      imageCount,
      lastModified
    });
  } catch (error) {
    console.error('Error loading pages:', error);
    res.status(500).json({ error: 'Error loading pages' });
  }
});

// Create new page
app.post('/admin/api/pages', requireAuth, async (req, res) => {
  try {
    const { title } = req.body;
    
    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }
    
    // Generate filename from title
    const filename = title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.html';
    const filePath = path.join(__dirname, 'html', filename);
    
    // Check if file already exists
    if (fsSync.existsSync(filePath)) {
      return res.status(400).json({ error: 'Page already exists' });
    }
    
    // Create basic HTML template
    let htmlContent = '';
    
    htmlContent = `<!DOCTYPE html>
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
    
    res.json({ 
      success: true,
      path: `/html/${filename}`
    });
  } catch (error) {
    console.error('Error creating page:', error);
    res.status(500).json({ error: 'Error creating page' });
  }
});

// Delete page
app.delete('/admin/api/pages', requireAuth, async (req, res) => {
  try {
    const { path: pagePath } = req.body;
    
    if (!pagePath || pagePath === '/index.html') {
      return res.status(400).json({ error: 'Cannot delete main page' });
    }
    
    const filePath = path.join(__dirname, pagePath);
    
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
    const { path: pagePath } = req.query;
    
    if (!pagePath) {
      return res.status(400).json({ error: 'Path is required' });
    }
    
    const filePath = path.join(__dirname, pagePath);
    
    if (!fsSync.existsSync(filePath)) {
      return res.status(404).json({ error: 'Page not found' });
    }
    
    const content = await fs.readFile(filePath, 'utf8');

    // Extract body attributes for preservation
    const bodyTagMatch = content.match(/<body([^>]*)>/i);
    const bodyAttrs = bodyTagMatch ? bodyTagMatch[1].trim() : '';

    // Extract HTML body content (handle potential double-body from previous saves)
    const bodyMatch = content.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    let html = bodyMatch ? bodyMatch[1].trim() : content;

    // Remove any nested <body> tags left from previous editor saves
    html = html.replace(/^<body[^>]*>/i, '').replace(/<\/body>\s*$/i, '');

    // Extract inline styles from head only (not from body)
    const headMatch = content.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
    let css = '';
    if (headMatch) {
      const headContent = headMatch[1];
      const styleMatch = headContent.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
      if (styleMatch) {
        css = styleMatch.map(s => s.replace(/<\/?style[^>]*>/gi, '')).join('\n');
      }
    }
    
    // Get available images
    const assets = [];
    const uploadsDir = path.join(__dirname, 'uploads');
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
    const { path: pagePath, html, css } = req.body;

    if (!pagePath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    const filePath = path.join(__dirname, pagePath);

    if (!fsSync.existsSync(filePath)) {
      return res.status(404).json({ error: 'Page not found' });
    }

    // Read existing file to preserve head and body attributes
    const existingContent = await fs.readFile(filePath, 'utf8');
    const headMatch = existingContent.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
    const head = headMatch ? headMatch[1] : '<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Page</title><link href="/css/styles.css" rel="stylesheet">';

    // Preserve original body tag attributes (class, data-* attributes, etc.)
    const bodyTagMatch = existingContent.match(/<body([^>]*)>/i);
    const bodyAttrs = bodyTagMatch ? bodyTagMatch[1] : '';

    // Remove existing inline styles from head (we'll re-add editor styles)
    let cleanHead = head.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

    // Filter out GrapesJS boilerplate from CSS before saving
    if (css && css.trim()) {
      let filteredCss = css
        .replace(/\*\s*\{\s*box-sizing:\s*border-box;\s*\}\s*/g, '')
        .replace(/body\s*\{\s*margin:\s*0;?\s*\}\s*/g, '')
        .trim();
      if (filteredCss) {
        cleanHead += `\n<style>\n${filteredCss}\n</style>`;
      }
    }

    // Strip any <body> wrapper tags that GrapesJS adds to its output
    let bodyContent = html || '';
    bodyContent = bodyContent.replace(/^<body[^>]*>/i, '').replace(/<\/body>\s*$/i, '');

    // Auto-inject Hive component scripts if page uses any hive-* elements
    const usesHive = /<hive-/i.test(bodyContent);
    // Remove any previously injected Hive scripts so we don't duplicate
    cleanHead = cleanHead.replace(/<!-- hive-components-start -->[\s\S]*?<!-- hive-components-end -->\n?/g, '');
    if (usesHive) {
      const hiveScripts = `<!-- hive-components-start -->
<style>
/* Hive component theme overrides — WCAG AA legibility */
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

    // Reconstruct the HTML
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

// Get raw page HTML (used by the inline editor iframe)
app.get('/admin/api/page-raw', requireAuth, async (req, res) => {
  try {
    const { path: pagePath } = req.query;
    if (!pagePath) {
      return res.status(400).send('Path is required');
    }

    const filePath = path.join(__dirname, pagePath);
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(path.resolve(__dirname))) {
      return res.status(400).send('Invalid path');
    }

    if (!fsSync.existsSync(filePath)) {
      return res.status(404).send('Page not found');
    }

    const content = await fs.readFile(filePath, 'utf8');
    res.set('Content-Type', 'text/html');
    res.send(content);
  } catch (error) {
    console.error('Error reading page:', error);
    res.status(500).send('Error reading page');
  }
});

// Save full page HTML (used by the inline editor)
app.post('/admin/api/save-full-page', requireAuth, async (req, res) => {
  try {
    const { path: pagePath, content } = req.body;

    if (!pagePath || !content) {
      return res.status(400).json({ error: 'Path and content are required' });
    }

    // Only allow saving to known page locations
    const filePath = path.join(__dirname, pagePath);
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(path.resolve(__dirname))) {
      return res.status(400).json({ error: 'Invalid path' });
    }

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
    const images = [];
    const uploadsDir = path.join(__dirname, 'uploads');
    
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
    
    // Sort by newest first
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
    const { path: imagePath } = req.body;
    
    if (!imagePath || !imagePath.startsWith('/uploads/')) {
      return res.status(400).json({ error: 'Invalid path' });
    }
    
    const filePath = path.join(__dirname, imagePath);
    
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

// ==================== START SERVER ====================

app.listen(PORT, () => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`✓ Server is running on http://localhost:${PORT}`);
  console.log(`✓ Admin panel: http://localhost:${PORT}/admin/login`);
  console.log(`${'='.repeat(50)}\n`);
});
