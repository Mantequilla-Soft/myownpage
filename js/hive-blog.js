import { LitElement, html, css } from 'lit';
import { hiveApi, baseStyles, themeStyles, truncateText, formatHiveDate, renderPostContent } from '@hiveio/internal';

const HIVE_API_ENDPOINTS = [
  'https://api.hive.blog',
  'https://api.hivekings.com',
  'https://anyx.io',
  'https://api.openhive.network'
];

async function getDiscussionsByBlog(account, limit, startAuthor, startPermlink) {
  const params = { tag: account, limit };
  if (startAuthor && startPermlink) {
    params.start_author = startAuthor;
    params.start_permlink = startPermlink;
  }
  const payload = {
    jsonrpc: '2.0',
    method: 'condenser_api.get_discussions_by_blog',
    params: [params],
    id: Math.floor(Math.random() * 1000)
  };

  for (const endpoint of HIVE_API_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) continue;
      const data = await response.json();
      if (data.error) continue;
      return data.result || [];
    } catch {
      continue;
    }
  }
  throw new Error('All API endpoints failed');
}

class HiveBlogElement extends LitElement {
  static properties = {
    account: { type: String, reflect: true },
    theme: { type: String, reflect: true },
    'posts-per-page': { type: Number, reflect: true, attribute: 'posts-per-page' },
    'preview-length': { type: Number, reflect: true, attribute: 'preview-length' },
    'front-base-url': { type: String, reflect: true, attribute: 'front-base-url' },
    'url-template': { type: String, reflect: true, attribute: 'url-template' },
    _posts: { state: true },
    _loading: { state: true },
    _error: { state: true },
    _hasMore: { state: true }
  };

  static styles = [
    baseStyles,
    themeStyles,
    css`
      /* Override library theme tokens for WCAG AA legibility */
      :host {
        display: block;
        --hive-on-surface: #1a1a1a;
        --hive-on-surface-variant: #4a4a4a;
        --hive-surface-variant: #f5f5f5;
        --hive-border: #d0d0d0;
      }
      :host([theme="dark"]) {
        --hive-on-surface: #f0f0f0;
        --hive-on-surface-variant: #c0c0c0;
        --hive-surface: #1a1a1a;
        --hive-surface-variant: #2a2a2a;
        --hive-border: #404040;
      }
      @media (prefers-color-scheme: dark) {
        :host([theme="auto"]) {
          --hive-on-surface: #f0f0f0;
          --hive-on-surface-variant: #c0c0c0;
          --hive-surface: #1a1a1a;
          --hive-surface-variant: #2a2a2a;
          --hive-border: #404040;
        }
      }

      .blog-container {
        border: 1px solid var(--hive-border);
        border-radius: 8px;
        overflow: hidden;
      }

      .blog-header {
        padding: 1rem;
        background: var(--hive-surface-variant);
        border-bottom: 1px solid var(--hive-border);
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }

      .blog-avatar {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        border: 2px solid var(--hive-border);
        overflow: hidden;
      }

      .blog-avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .blog-title {
        margin: 0;
        font-size: 1.25rem;
        font-weight: 600;
        color: var(--hive-on-surface);
      }

      .blog-subtitle {
        margin: 0;
        font-size: 0.8rem;
        color: var(--hive-on-surface-variant);
      }

      .posts-list { display: grid; gap: 0; }

      .post-item {
        padding: 1rem;
        border-bottom: 1px solid var(--hive-border);
        transition: background-color 0.2s ease;
        cursor: pointer;
        text-decoration: none;
        color: inherit;
        display: block;
      }

      .post-item:hover { background: var(--hive-surface-variant); }
      .post-item:last-child { border-bottom: none; }

      .post-content {
        display: flex;
        flex-direction: row;
        gap: 1rem;
      }

      .preview-img {
        width: 200px;
        height: 150px;
        object-fit: cover;
        border-radius: 6px;
        flex-shrink: 0;
      }

      .post-excerpt {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .post-title {
        margin: 0 0 0.5rem 0;
        font-size: 1.125rem;
        font-weight: 600;
        color: var(--hive-on-surface);
        line-height: 1.4;
      }

      .post-preview {
        margin: 0 0 0.75rem 0;
        color: var(--hive-on-surface-variant);
        line-height: 1.6;
        font-size: 0.9rem;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .post-meta {
        display: flex;
        align-items: center;
        gap: 1rem;
        font-size: 0.8rem;
        color: var(--hive-on-surface-variant);
        margin-top: auto;
      }

      .post-meta-item {
        display: flex;
        align-items: center;
        gap: 0.3rem;
      }

      .load-more-button {
        padding: 1rem;
        text-align: center;
        background: var(--hive-surface-variant);
        border: none;
        cursor: pointer;
        width: 100%;
        color: var(--hive-primary);
        font-weight: 500;
        font-size: 0.9rem;
        font-family: inherit;
        transition: background-color 0.2s ease;
      }

      .load-more-button:hover { background: var(--hive-border); }
      .load-more-button:disabled { opacity: 0.6; cursor: not-allowed; }

      .loading {
        text-align: center;
        padding: 2rem;
        color: var(--hive-on-surface-variant);
      }

      .error {
        text-align: center;
        padding: 2rem;
        color: var(--hive-error);
        background: color-mix(in srgb, var(--hive-error) 10%, transparent);
        border-radius: 6px;
      }

      .no-posts {
        padding: 2rem;
        text-align: center;
        color: var(--hive-on-surface-variant);
      }

      @media (max-width: 640px) {
        .post-content { flex-direction: column; }
        .preview-img { width: 100%; height: 200px; }
      }
    `
  ];

  constructor() {
    super();
    this.account = '';
    this.theme = 'auto';
    this['posts-per-page'] = 5;
    this['preview-length'] = 200;
    this['front-base-url'] = 'https://hive.blog';
    this['url-template'] = '';
    this._posts = [];
    this._loading = false;
    this._error = '';
    this._hasMore = true;
  }

  async connectedCallback() {
    super.connectedCallback();
    if (this.account) {
      await this._loadPosts();
    }
  }

  async updated(changedProperties) {
    if (changedProperties.has('account') && this.account) {
      this._posts = [];
      this._hasMore = true;
      await this._loadPosts();
    }
  }

  async _loadPosts(append = false) {
    if (!this.account) {
      this._error = 'Account name is required';
      return;
    }

    this._loading = true;
    if (!append) {
      this._error = '';
      this._posts = [];
    }

    try {
      let startAuthor, startPermlink;
      const perPage = this['posts-per-page'] || 5;

      if (append && this._posts.length > 0) {
        const lastPost = this._posts[this._posts.length - 1];
        startAuthor = lastPost.author;
        startPermlink = lastPost.permlink;
      }

      const requestLimit = perPage + 1;
      const newPosts = await getDiscussionsByBlog(this.account, requestLimit, startAuthor, startPermlink);

      // Filter to only show posts authored by this account (exclude reblogs)
      const ownPosts = newPosts.filter(p => p.author === this.account);

      this._hasMore = newPosts.length >= requestLimit;
      const posts = ownPosts.slice(0, perPage);

      if (append) {
        // Deduplicate
        const existing = new Set(this._posts.map(p => p.author + '/' + p.permlink));
        const unique = posts.filter(p => !existing.has(p.author + '/' + p.permlink));
        this._posts = [...this._posts, ...unique];
      } else {
        this._posts = posts;
      }
    } catch (err) {
      this._error = err.message || 'Failed to load blog posts';
    } finally {
      this._loading = false;
    }
  }

  _getPostUrl(post) {
    if (this['url-template']) {
      return this['url-template']
        .replace('{permlink}', post.permlink)
        .replace('{author}', post.author);
    }
    return (this['front-base-url'] || 'https://hive.blog') + '/@' + post.author + '/' + post.permlink;
  }

  _handlePostClick(post) {
    const url = this._getPostUrl(post);
    this.dispatchEvent(new CustomEvent('hive-post-click', {
      detail: { post, url, author: post.author, permlink: post.permlink },
      bubbles: true
    }));

    if (this['url-template'] && url.startsWith('/')) {
      window.location.href = url;
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  async _loadMore() {
    if (!this._hasMore || this._loading) return;
    await this._loadPosts(true);
  }

  render() {
    if (this._loading && this._posts.length === 0) {
      return html`<div class="loading">Loading blog posts for @${this.account}...</div>`;
    }

    if (this._error) {
      return html`<div class="error">${this._error}</div>`;
    }

    const previewLen = this['preview-length'] || 200;
    const baseUrl = this['front-base-url'] || 'https://hive.blog';

    return html`
      <div class="blog-container">
        <div class="blog-header">
          <div class="blog-avatar">
            <img src="https://images.hive.blog/u/${this.account}/avatar/medium"
                 alt="${this.account}"
                 @error=${(e) => { e.target.style.display = 'none'; }}>
          </div>
          <div>
            <h2 class="blog-title">@${this.account}</h2>
            <p class="blog-subtitle">Blog Feed</p>
          </div>
        </div>

        ${this._posts.length === 0
          ? html`<div class="no-posts">No blog posts found for @${this.account}</div>`
          : html`
            <div class="posts-list">
              ${this._posts.map(post => {
                let preview = '';
                try {
                  preview = truncateText(
                    renderPostContent(post.body, { breaks: true, baseUrl: baseUrl + '/' })
                      .replace(/<[^>]*>/g, '')
                      .replace(/\n/g, ' ')
                      .trim(),
                    previewLen
                  );
                } catch {
                  preview = truncateText(post.body.replace(/[#*\[\]()!<>]/g, '').trim(), previewLen);
                }

                let imageUrl = '';
                try {
                  imageUrl = JSON.parse(post.json_metadata)?.image?.[0] || '';
                } catch {}

                return html`
                  <article class="post-item" @click=${() => this._handlePostClick(post)}>
                    <div class="post-content">
                      ${imageUrl ? html`
                        <img class="preview-img" src="${imageUrl}" alt="" loading="lazy"
                             @error=${(e) => { e.target.style.display = 'none'; }}>
                      ` : ''}
                      <div class="post-excerpt">
                        <h3 class="post-title">${post.title}</h3>
                        <p class="post-preview">${preview}</p>
                        <div class="post-meta">
                          <span class="post-meta-item">${formatHiveDate(post.created)}</span>
                          <span class="post-meta-item">\u2191 ${post.net_votes} votes</span>
                          <span class="post-meta-item">\u{1F4AC} ${post.children} comments</span>
                          <span class="post-meta-item">${post.pending_payout_value || ''}</span>
                        </div>
                      </div>
                    </div>
                  </article>
                `;
              })}
            </div>

            ${this._hasMore ? html`
              <button class="load-more-button"
                      @click=${this._loadMore}
                      ?disabled=${this._loading}>
                ${this._loading ? 'Loading...' : 'Load More Posts'}
              </button>
            ` : ''}
          `}
      </div>
    `;
  }
}

if (!customElements.get('hive-blog')) {
  customElements.define('hive-blog', HiveBlogElement);
}
