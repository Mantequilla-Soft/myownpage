import { LitElement, html, css, unsafeCSS } from 'lit';

// ---------------------------------------------------------------------------
// Shared helpers & constants
// ---------------------------------------------------------------------------

const HIVE_API_ENDPOINTS = [
  'https://api.hive.blog',
  'https://api.openhive.network',
  'https://anyx.io'
];

const GREEN = unsafeCSS('#10b981');

function isPathBased() {
  return window.location.pathname.startsWith('/site/');
}

function apiBase(shop) {
  if (isPathBased()) return `/site/${shop}/api/store`;
  return '/api/store';
}

function cartKey(shop) {
  return `snapie_cart_${shop}`;
}

function loadCart(shop) {
  try {
    return JSON.parse(localStorage.getItem(cartKey(shop))) || [];
  } catch { return []; }
}

function saveCart(shop, items) {
  localStorage.setItem(cartKey(shop), JSON.stringify(items));
}

// Shared theme CSS applied to every component
const themeBase = css`
  :host { display: block; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  :host([theme="light"]) { --shop-bg: #ffffff; --shop-surface: #f9fafb; --shop-border: #e5e7eb; --shop-text: #111827; --shop-text-secondary: #6b7280; --shop-backdrop: rgba(0,0,0,0.5); }
  :host([theme="dark"])  { --shop-bg: #1a1a2e; --shop-surface: #22223b; --shop-border: #3a3a5c; --shop-text: #f0f0f0; --shop-text-secondary: #a0a0b8; --shop-backdrop: rgba(0,0,0,0.7); }
  :host([theme="auto"])  { --shop-bg: #ffffff; --shop-surface: #f9fafb; --shop-border: #e5e7eb; --shop-text: #111827; --shop-text-secondary: #6b7280; --shop-backdrop: rgba(0,0,0,0.5); }
  @media (prefers-color-scheme: dark) {
    :host([theme="auto"]) { --shop-bg: #1a1a2e; --shop-surface: #22223b; --shop-border: #3a3a5c; --shop-text: #f0f0f0; --shop-text-secondary: #a0a0b8; --shop-backdrop: rgba(0,0,0,0.7); }
  }
`;

// ===========================================================================
// 1. <hive-shop> — Product Grid
// ===========================================================================

class HiveShopElement extends LitElement {
  static properties = {
    shop: { type: String, reflect: true },
    columns: { type: Number, reflect: true },
    theme: { type: String, reflect: true },
    'show-categories': { type: Boolean, reflect: true, attribute: 'show-categories' },
    _products: { state: true },
    _categories: { state: true },
    _activeCategory: { state: true },
    _loading: { state: true },
    _error: { state: true }
  };

  static styles = [
    themeBase,
    css`
      .grid-container { color: var(--shop-text); }

      .category-pills {
        display: flex; flex-wrap: wrap; gap: 0.5rem;
        padding: 0 0 1rem 0;
      }
      .pill {
        padding: 0.375rem 0.875rem; border-radius: 9999px; border: 1px solid var(--shop-border);
        background: var(--shop-surface); color: var(--shop-text-secondary);
        cursor: pointer; font-size: 0.85rem; transition: all 0.2s;
      }
      .pill:hover { border-color: ${GREEN}; color: ${GREEN}; }
      .pill.active { background: ${GREEN}; color: #fff; border-color: ${GREEN}; }

      .product-grid {
        display: grid; gap: 1.25rem;
        grid-template-columns: repeat(var(--cols, 3), 1fr);
      }
      @media (max-width: 900px) { .product-grid { grid-template-columns: repeat(2, 1fr); } }
      @media (max-width: 560px) { .product-grid { grid-template-columns: 1fr; } }

      .card {
        background: var(--shop-bg); border: 1px solid var(--shop-border);
        border-radius: 12px; overflow: hidden;
        box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        display: flex; flex-direction: column;
        transition: box-shadow 0.2s, transform 0.2s;
      }
      .card:hover { box-shadow: 0 6px 20px rgba(0,0,0,0.12); transform: translateY(-2px); }

      .card-img {
        width: 100%; height: 200px; object-fit: cover;
        background: var(--shop-surface);
      }

      .card-body { padding: 1rem; display: flex; flex-direction: column; flex: 1; }

      .card-name {
        margin: 0 0 0.375rem 0; font-size: 1.05rem; font-weight: 600;
        color: var(--shop-text);
      }

      .price-badge {
        display: inline-block; padding: 0.2rem 0.6rem; border-radius: 6px;
        background: ${GREEN}; color: #fff; font-weight: 600; font-size: 0.85rem;
        margin-bottom: 0.5rem; width: fit-content;
      }

      .card-desc {
        color: var(--shop-text-secondary); font-size: 0.875rem; line-height: 1.5;
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
        overflow: hidden; margin: 0 0 auto 0; padding-bottom: 0.75rem;
      }

      .add-btn {
        width: 100%; padding: 0.625rem; border: none; border-radius: 8px;
        background: ${GREEN}; color: #fff; font-weight: 600; font-size: 0.9rem;
        cursor: pointer; transition: background 0.2s;
      }
      .add-btn:hover { background: #059669; }

      .placeholder {
        border: 2px dashed var(--shop-border); border-radius: 12px;
        padding: 3rem 2rem; text-align: center; color: var(--shop-text-secondary);
        font-size: 0.95rem;
      }

      .loading { text-align: center; padding: 2rem; color: var(--shop-text-secondary); }
      .error   { text-align: center; padding: 2rem; color: #ef4444; }
    `
  ];

  constructor() {
    super();
    this.shop = '';
    this.columns = 3;
    this.theme = 'auto';
    this['show-categories'] = false;
    this._products = [];
    this._categories = [];
    this._activeCategory = 'All';
    this._loading = false;
    this._error = '';
  }

  async connectedCallback() {
    super.connectedCallback();
    if (this.shop) await this._fetchStore();
  }

  async updated(changed) {
    if (changed.has('shop') && this.shop) {
      this._products = [];
      this._categories = [];
      this._activeCategory = 'All';
      await this._fetchStore();
    }
  }

  async _fetchStore() {
    this._loading = true;
    this._error = '';
    try {
      const resp = await fetch(apiBase(this.shop));
      if (!resp.ok) throw new Error(`Store API returned ${resp.status}`);
      const data = await resp.json();
      this._products = data.products || [];
      const cats = new Set();
      this._products.forEach(p => { if (p.category) cats.add(p.category); });
      this._categories = [...cats];
    } catch (err) {
      this._error = err.message || 'Failed to load store';
    } finally {
      this._loading = false;
    }
  }

  _addToCart(product) {
    const items = loadCart(this.shop);
    const existing = items.find(i => i.id === product.id);
    if (existing) { existing.qty += 1; }
    else { items.push({ id: product.id, name: product.name, price: product.price, image: product.image, qty: 1 }); }
    saveCart(this.shop, items);
    document.dispatchEvent(new CustomEvent('snapie-add-to-cart', { detail: product, bubbles: true, composed: true }));
  }

  _setCategory(cat) { this._activeCategory = cat; }

  get _filtered() {
    if (this._activeCategory === 'All') return this._products;
    return this._products.filter(p => p.category === this._activeCategory);
  }

  render() {
    if (this._loading) return html`<div class="loading">Loading store...</div>`;
    if (this._error) return html`<div class="error">${this._error}</div>`;
    if (this._products.length === 0) {
      return html`<div class="placeholder">Product Grid &mdash; configure shop username in properties</div>`;
    }

    return html`
      <div class="grid-container" style="--cols:${this.columns}">
        ${this['show-categories'] && this._categories.length ? html`
          <div class="category-pills">
            <button class="pill ${this._activeCategory === 'All' ? 'active' : ''}" @click=${() => this._setCategory('All')}>All</button>
            ${this._categories.map(c => html`
              <button class="pill ${this._activeCategory === c ? 'active' : ''}" @click=${() => this._setCategory(c)}>${c}</button>
            `)}
          </div>
        ` : ''}

        <div class="product-grid">
          ${this._filtered.map(p => html`
            <div class="card">
              ${p.image ? html`<img class="card-img" src="${p.image}" alt="${p.name}" loading="lazy" @error=${e => { e.target.style.display = 'none'; }}>` : ''}
              <div class="card-body">
                <h3 class="card-name">${p.name}</h3>
                <span class="price-badge">${Number(p.price).toFixed(3)} HBD</span>
                ${p.description ? html`<p class="card-desc">${p.description}</p>` : ''}
                <button class="add-btn" @click=${() => this._addToCart(p)}>Add to Cart</button>
              </div>
            </div>
          `)}
        </div>
      </div>
    `;
  }
}

if (!customElements.get('hive-shop')) {
  customElements.define('hive-shop', HiveShopElement);
}

// ===========================================================================
// 2. <hive-cart> — Shopping Cart Drawer
// ===========================================================================

class HiveCartElement extends LitElement {
  static properties = {
    shop: { type: String, reflect: true },
    theme: { type: String, reflect: true },
    _items: { state: true },
    _open: { state: true }
  };

  static styles = [
    themeBase,
    css`
      .fab {
        position: fixed; bottom: 64px; right: 24px; z-index: 9998;
        width: 56px; height: 56px; border-radius: 50%; border: none;
        background: ${GREEN}; color: #fff; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 4px 14px rgba(0,0,0,0.25); transition: transform 0.2s;
        font-size: 1.5rem;
      }
      .fab:hover { transform: scale(1.08); }

      .badge {
        position: absolute; top: -4px; right: -4px;
        background: #ef4444; color: #fff; font-size: 0.7rem; font-weight: 700;
        min-width: 20px; height: 20px; border-radius: 10px;
        display: flex; align-items: center; justify-content: center;
        padding: 0 5px;
      }

      .backdrop {
        position: fixed; inset: 0; z-index: 9999;
        background: var(--shop-backdrop); opacity: 0;
        transition: opacity 0.3s; pointer-events: none;
      }
      .backdrop.open { opacity: 1; pointer-events: auto; }

      .drawer {
        position: fixed; top: 0; right: 0; bottom: 50px; z-index: 10000;
        width: 380px; max-width: 90vw;
        background: var(--shop-bg); color: var(--shop-text);
        box-shadow: -4px 0 24px rgba(0,0,0,0.15);
        display: flex; flex-direction: column;
        transform: translateX(100%); transition: transform 0.3s ease;
      }
      .drawer.open { transform: translateX(0); }

      .drawer-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 1rem 1.25rem; border-bottom: 1px solid var(--shop-border);
      }
      .drawer-header h2 { margin: 0; font-size: 1.15rem; }

      .close-btn {
        background: none; border: none; font-size: 1.5rem; cursor: pointer;
        color: var(--shop-text-secondary); line-height: 1;
      }

      .drawer-body { flex: 1; overflow-y: auto; padding: 1rem 1.25rem; }

      .empty { text-align: center; padding: 3rem 1rem; color: var(--shop-text-secondary); }

      .line-item {
        display: flex; gap: 0.75rem; padding: 0.75rem 0;
        border-bottom: 1px solid var(--shop-border);
      }
      .line-item:last-child { border-bottom: none; }

      .line-thumb {
        width: 56px; height: 56px; border-radius: 8px; object-fit: cover;
        background: var(--shop-surface); flex-shrink: 0;
      }

      .line-info { flex: 1; display: flex; flex-direction: column; gap: 0.25rem; }
      .line-name { font-weight: 600; font-size: 0.9rem; }
      .line-price { font-size: 0.8rem; color: var(--shop-text-secondary); }

      .qty-row { display: flex; align-items: center; gap: 0.5rem; }
      .qty-btn {
        width: 26px; height: 26px; border-radius: 6px; border: 1px solid var(--shop-border);
        background: var(--shop-surface); color: var(--shop-text); cursor: pointer;
        font-size: 1rem; display: flex; align-items: center; justify-content: center;
      }
      .qty-btn:hover { border-color: ${GREEN}; }

      .remove-btn {
        background: none; border: none; color: #ef4444; cursor: pointer;
        font-size: 0.8rem; padding: 0; margin-left: auto; align-self: flex-start;
      }

      .drawer-footer {
        padding: 1rem 1.25rem; border-top: 1px solid var(--shop-border);
      }
      .total-row {
        display: flex; justify-content: space-between; font-weight: 700;
        font-size: 1.05rem; margin-bottom: 0.75rem;
      }
      .checkout-btn {
        width: 100%; padding: 0.75rem; border: none; border-radius: 8px;
        background: ${GREEN}; color: #fff; font-weight: 600; font-size: 1rem;
        cursor: pointer; transition: background 0.2s;
      }
      .checkout-btn:hover { background: #059669; }
    `
  ];

  constructor() {
    super();
    this.shop = '';
    this.theme = 'auto';
    this._items = [];
    this._open = false;
    this._onAddToCart = this._onAddToCart.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    this._items = loadCart(this.shop);
    document.addEventListener('snapie-add-to-cart', this._onAddToCart);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('snapie-add-to-cart', this._onAddToCart);
  }

  _onAddToCart(e) {
    this._addToCart(e.detail);
  }

  _addToCart(product) {
    const items = [...this._items];
    const existing = items.find(i => i.id === product.id);
    if (existing) { existing.qty += 1; }
    else { items.push({ id: product.id, name: product.name, price: product.price, image: product.image, qty: 1 }); }
    this._items = items;
    this._saveCart();
  }

  _changeQty(id, delta) {
    let items = this._items.map(i => i.id === id ? { ...i, qty: i.qty + delta } : i);
    items = items.filter(i => i.qty > 0);
    this._items = items;
    this._saveCart();
  }

  _removeFromCart(id) {
    this._items = this._items.filter(i => i.id !== id);
    this._saveCart();
  }

  _getTotal() {
    return this._items.reduce((sum, i) => sum + i.price * i.qty, 0);
  }

  _saveCart() {
    saveCart(this.shop, this._items);
  }

  _checkout() {
    const total = this._getTotal();
    document.dispatchEvent(new CustomEvent('snapie-checkout', {
      detail: { items: [...this._items], total, shop: this.shop },
      bubbles: true, composed: true
    }));
    this._open = false;
  }

  render() {
    const count = this._items.reduce((s, i) => s + i.qty, 0);

    return html`
      <button class="fab" @click=${() => { this._open = true; }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
        </svg>
        ${count > 0 ? html`<span class="badge">${count}</span>` : ''}
      </button>

      <div class="backdrop ${this._open ? 'open' : ''}" @click=${() => { this._open = false; }}></div>

      <div class="drawer ${this._open ? 'open' : ''}">
        <div class="drawer-header">
          <h2>Shopping Cart</h2>
          <button class="close-btn" @click=${() => { this._open = false; }}>&times;</button>
        </div>

        <div class="drawer-body">
          ${this._items.length === 0
            ? html`<div class="empty">Your cart is empty</div>`
            : this._items.map(item => html`
              <div class="line-item">
                ${item.image ? html`<img class="line-thumb" src="${item.image}" alt="${item.name}" @error=${e => { e.target.style.display = 'none'; }}>` : ''}
                <div class="line-info">
                  <span class="line-name">${item.name}</span>
                  <span class="line-price">${(item.price * item.qty).toFixed(3)} HBD</span>
                  <div class="qty-row">
                    <button class="qty-btn" @click=${() => this._changeQty(item.id, -1)}>-</button>
                    <span>${item.qty}</span>
                    <button class="qty-btn" @click=${() => this._changeQty(item.id, 1)}>+</button>
                  </div>
                </div>
                <button class="remove-btn" @click=${() => this._removeFromCart(item.id)}>Remove</button>
              </div>
            `)
          }
        </div>

        ${this._items.length > 0 ? html`
          <div class="drawer-footer">
            <div class="total-row">
              <span>Total</span>
              <span>${this._getTotal().toFixed(3)} HBD</span>
            </div>
            <button class="checkout-btn" @click=${this._checkout}>Checkout</button>
          </div>
        ` : ''}
      </div>
    `;
  }
}

if (!customElements.get('hive-cart')) {
  customElements.define('hive-cart', HiveCartElement);
}

// ===========================================================================
// 3. <hive-pay> — Checkout & Payment
// ===========================================================================

class HivePayElement extends LitElement {
  static properties = {
    shop: { type: String, reflect: true },
    theme: { type: String, reflect: true },
    lightning: { type: Boolean, reflect: true },
    _state: { state: true },
    _items: { state: true },
    _total: { state: true },
    _memo: { state: true },
    _amount: { state: true },
    _pollCount: { state: true },
    _errorMsg: { state: true }
  };

  static styles = [
    themeBase,
    css`
      .overlay {
        position: fixed; inset: 0; z-index: 10001;
        background: var(--shop-backdrop);
        display: flex; align-items: center; justify-content: center;
        opacity: 0; pointer-events: none; transition: opacity 0.3s;
      }
      .overlay.visible { opacity: 1; pointer-events: auto; }

      .modal {
        background: var(--shop-bg); color: var(--shop-text);
        border-radius: 16px; width: 480px; max-width: 92vw;
        max-height: 90vh; overflow-y: auto;
        box-shadow: 0 12px 40px rgba(0,0,0,0.25);
        transform: scale(0.95); transition: transform 0.3s;
      }
      .overlay.visible .modal { transform: scale(1); }

      .modal-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 1.25rem 1.5rem; border-bottom: 1px solid var(--shop-border);
      }
      .modal-header h2 { margin: 0; font-size: 1.15rem; }
      .close-btn {
        background: none; border: none; font-size: 1.5rem; cursor: pointer;
        color: var(--shop-text-secondary); line-height: 1;
      }

      .modal-body { padding: 1.25rem 1.5rem; }

      .order-item {
        display: flex; justify-content: space-between; padding: 0.4rem 0;
        font-size: 0.9rem;
      }
      .order-item-name { color: var(--shop-text); }
      .order-item-total { color: var(--shop-text-secondary); font-weight: 500; }

      .divider { border: none; border-top: 1px solid var(--shop-border); margin: 0.75rem 0; }

      .order-total {
        display: flex; justify-content: space-between;
        font-weight: 700; font-size: 1.1rem; margin-bottom: 1.25rem;
      }

      .pay-btn {
        width: 100%; padding: 0.75rem; border: none; border-radius: 8px;
        font-weight: 600; font-size: 0.95rem; cursor: pointer;
        transition: background 0.2s; margin-bottom: 0.625rem;
      }
      .pay-btn.keychain { background: ${GREEN}; color: #fff; }
      .pay-btn.keychain:hover { background: #059669; }
      .pay-btn.qr { background: var(--shop-surface); color: var(--shop-text); border: 1px solid var(--shop-border); }
      .pay-btn.qr:hover { border-color: ${GREEN}; }

      .qr-section { text-align: center; padding: 1rem 0; }
      .qr-section canvas { margin: 0 auto 1rem; display: block; border-radius: 8px; }

      .uri-text {
        word-break: break-all; font-size: 0.75rem; color: var(--shop-text-secondary);
        background: var(--shop-surface); padding: 0.75rem; border-radius: 8px;
        margin-top: 0.75rem; cursor: pointer; user-select: all;
      }

      .poll-msg { font-size: 0.85rem; color: var(--shop-text-secondary); text-align: center; margin-top: 0.75rem; }

      .success-view, .timeout-view, .error-view {
        text-align: center; padding: 2rem 1rem;
      }

      .checkmark {
        width: 64px; height: 64px; border-radius: 50%;
        background: ${GREEN}; color: #fff;
        display: flex; align-items: center; justify-content: center;
        margin: 0 auto 1rem; font-size: 2rem;
      }

      .success-view h3 { margin: 0 0 0.5rem; color: ${GREEN}; font-size: 1.25rem; }
      .success-view p { color: var(--shop-text-secondary); }

      .timeout-view h3, .error-view h3 { margin: 0 0 0.5rem; color: #ef4444; font-size: 1.1rem; }
      .timeout-view p, .error-view p { color: var(--shop-text-secondary); font-size: 0.9rem; margin: 0 0 1rem; }

      .retry-btn {
        padding: 0.625rem 1.5rem; border: none; border-radius: 8px;
        background: ${GREEN}; color: #fff; font-weight: 600;
        cursor: pointer; transition: background 0.2s;
      }
      .retry-btn:hover { background: #059669; }
    `
  ];

  constructor() {
    super();
    this.shop = '';
    this.theme = 'auto';
    this.lightning = false;
    this._state = 'idle';
    this._items = [];
    this._total = 0;
    this._memo = '';
    this._amount = '';
    this._pollCount = 0;
    this._errorMsg = '';
    this._onCheckout = this._onCheckout.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('snapie-checkout', this._onCheckout);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('snapie-checkout', this._onCheckout);
  }

  _onCheckout(e) {
    const { items, total, shop } = e.detail;
    this._items = items;
    this._total = total;
    if (shop) this.shop = shop;
    this._generateMemo();
    this._state = 'order-summary';
  }

  _generateMemo() {
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const hex = Array.from(crypto.getRandomValues(new Uint8Array(4)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    this._memo = `snapie:${this.shop}:${ts}:${hex}`;
    this._amount = this._total.toFixed(3);
  }

  _close() {
    this._state = 'idle';
  }

  _clearCart() {
    localStorage.removeItem(cartKey(this.shop));
  }

  // -- Hive Keychain payment --

  _payKeychain() {
    if (!window.hive_keychain) {
      this._errorMsg = 'Hive Keychain extension not found. Please install it and try again.';
      this._state = 'error';
      return;
    }
    window.hive_keychain.requestTransfer(
      null, this.shop, this._amount, this._memo, 'HBD',
      (response) => {
        if (response.success) {
          this._state = 'success';
          this._clearCart();
          document.dispatchEvent(new CustomEvent('snapie-payment-success', {
            detail: { shop: this.shop }, bubbles: true
          }));
        } else {
          this._errorMsg = response.message || 'Keychain transfer was cancelled or failed.';
          this._state = 'error';
        }
      }
    );
  }

  // -- QR code payment --

  _buildHiveUri() {
    const op = ["transfer", { to: this.shop, amount: this._amount + ' HBD', memo: this._memo }];
    const base64 = btoa(JSON.stringify(op)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `hive://sign/op/${base64}`;
  }

  async _payQR() {
    this._state = 'awaiting-payment';
    await this.updateComplete;

    const uri = this._buildHiveUri();
    const qrBox = this.shadowRoot.querySelector('#qr-box');
    if (qrBox && typeof QRCode !== 'undefined') {
      qrBox.innerHTML = '';
      new QRCode(qrBox, {
        text: uri,
        width: 240,
        height: 240,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
      });
    }

    this._pollForPayment();
  }

  async _pollForPayment() {
    for (let i = 0; i < 100; i++) {
      if (this._state !== 'awaiting-payment') return;
      for (const api of HIVE_API_ENDPOINTS) {
        try {
          const resp = await fetch(api, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              method: 'condenser_api.get_account_history',
              params: [this.shop, -1, 20],
              id: 1
            })
          });
          const data = await resp.json();
          if (data.result) {
            const found = data.result.find(tx => {
              const op = tx[1]?.op;
              if (!op || op[0] !== 'transfer') return false;
              return op[1].to === this.shop && op[1].amount === this._amount + ' HBD' && op[1].memo === this._memo;
            });
            if (found) {
              this._state = 'success';
              this._clearCart();
              document.dispatchEvent(new CustomEvent('snapie-payment-success', {
                detail: { shop: this.shop }, bubbles: true
              }));
              return;
            }
          }
          break; // one API worked, no need to try others
        } catch { continue; }
      }
      this._pollCount = i + 1;
      await new Promise(r => setTimeout(r, 3000));
    }
    if (this._state === 'awaiting-payment') this._state = 'timeout';
  }

  _retryPayment() {
    this._pollCount = 0;
    this._state = 'order-summary';
  }

  // -- Rendering --

  _renderOrderSummary() {
    const uri = `hive://sign/transfer?to=${this.shop}&amount=${encodeURIComponent(this._amount + ' HBD')}&memo=${encodeURIComponent(this._memo)}`;
    return html`
      <div class="modal-body">
        ${this._items.map(item => html`
          <div class="order-item">
            <span class="order-item-name">${item.name} &times; ${item.qty}</span>
            <span class="order-item-total">${(item.price * item.qty).toFixed(3)} HBD</span>
          </div>
        `)}
        <hr class="divider">
        <div class="order-total">
          <span>Total</span>
          <span>${this._total.toFixed(3)} HBD</span>
        </div>
        <button class="pay-btn keychain" @click=${this._payKeychain}>Pay with Hive Keychain</button>
        <button class="pay-btn qr" @click=${this._payQR}>Pay with QR Code</button>
      </div>
    `;
  }

  _renderAwaitingPayment() {
    const uri = this._buildHiveUri();
    return html`
      <div class="modal-body">
        <div class="qr-section">
          <div id="qr-box" style="background:#fff;padding:16px;border-radius:12px;display:inline-block;"></div>
          <p class="poll-msg">Scan QR code with your Hive wallet app</p>
          <div class="uri-text" @click=${() => navigator.clipboard?.writeText(uri)}>${uri}</div>
          <p class="poll-msg">Waiting for payment confirmation... (poll ${this._pollCount}/100)</p>
        </div>
      </div>
    `;
  }

  _renderSuccess() {
    return html`
      <div class="modal-body">
        <div class="success-view">
          <div class="checkmark">&#10003;</div>
          <h3>Payment confirmed!</h3>
          <p>Your order has been placed successfully.</p>
        </div>
      </div>
    `;
  }

  _renderTimeout() {
    return html`
      <div class="modal-body">
        <div class="timeout-view">
          <h3>Payment not detected</h3>
          <p>Payment not detected within 5 minutes. If you sent the payment, it may take a moment to confirm.</p>
          <button class="retry-btn" @click=${this._retryPayment}>Try Again</button>
        </div>
      </div>
    `;
  }

  _renderError() {
    return html`
      <div class="modal-body">
        <div class="error-view">
          <h3>Payment Error</h3>
          <p>${this._errorMsg}</p>
          <button class="retry-btn" @click=${this._retryPayment}>Try Again</button>
        </div>
      </div>
    `;
  }

  render() {
    if (this._state === 'idle') return html``;

    let title = 'Checkout';
    if (this._state === 'awaiting-payment') title = 'Awaiting Payment';
    if (this._state === 'success') title = 'Payment Complete';
    if (this._state === 'timeout') title = 'Payment Timeout';
    if (this._state === 'error') title = 'Error';

    let body;
    switch (this._state) {
      case 'order-summary': body = this._renderOrderSummary(); break;
      case 'awaiting-payment': body = this._renderAwaitingPayment(); break;
      case 'success': body = this._renderSuccess(); break;
      case 'timeout': body = this._renderTimeout(); break;
      case 'error': body = this._renderError(); break;
      default: body = html``;
    }

    return html`
      <div class="overlay ${this._state !== 'idle' ? 'visible' : ''}" @click=${this._close}>
        <div class="modal" @click=${e => e.stopPropagation()}>
          <div class="modal-header">
            <h2>${title}</h2>
            <button class="close-btn" @click=${this._close}>&times;</button>
          </div>
          ${body}
        </div>
      </div>
    `;
  }
}

if (!customElements.get('hive-pay')) {
  customElements.define('hive-pay', HivePayElement);
}
