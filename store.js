import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { STORE_CONFIG } from './config.js';

const db = createClient(STORE_CONFIG.supabaseUrl, STORE_CONFIG.supabasePublishableKey);
const productGrid = document.querySelector('[data-products]');
const categoryPills = document.querySelector('[data-category-pills]');
const countLabel = document.querySelector('[data-product-count]');
const searchInput = document.querySelector('[data-product-search]');
const cartKey = 'hjertekraft-cart-v1';
let products = [];
let variants = [];
const lineKey = row => `${row.id}:${row.variant_id || ''}`;
const variantOf = row => variants.find(v => v.id === row.variant_id);
const unitPrice = row => variantOf(row)?.price_ore ?? products.find(p => p.id === row.id)?.price_ore ?? 0;
let categories = [];
let demoMode = false;
let selectedCategory = 'all';
let query = '';
let cart = readCart();
const demoProducts = [
  { id: 'demo-vase', category_id: 'demo-home', name: 'Fargerik vase', short_description: 'Demovare · plass til sesongens blomster', price_ore: 49000, images: [], stock_quantity: 8, is_featured: true, demo: true },
  { id: 'demo-cup', category_id: 'demo-home', name: 'Keramikkopp', short_description: 'Demovare · en liten hverdagsfavoritt', price_ore: 34000, images: [], stock_quantity: 12, is_featured: false, demo: true },
  { id: 'demo-card', category_id: 'demo-small', name: 'Kort med omtanke', short_description: 'Demovare · en hilsen som får bli', price_ore: 8500, images: [], stock_quantity: 25, is_featured: false, demo: true },
  { id: 'demo-gift', category_id: 'demo-gift', name: 'Gavekort', short_description: 'Demovare · la mottakeren velge', price_ore: 25000, images: [], stock_quantity: null, is_featured: true, demo: true },
];
const demoCategories = [
  { id: 'demo-home', name: 'Til hjemmet', slug: 'til-hjemmet', sort_order: 1 },
  { id: 'demo-small', name: 'Små gleder', slug: 'sma-gleder', sort_order: 2 },
  { id: 'demo-gift', name: 'Gaver', slug: 'gaver', sort_order: 3 },
];

function readCart() {
  try { return JSON.parse(localStorage.getItem(cartKey) || '[]').filter(row => row && typeof row.id === 'string' && Number.isInteger(row.quantity) && row.quantity > 0); }
  catch { return []; }
}
function saveCart() { localStorage.setItem(cartKey, JSON.stringify(cart)); renderCart(); }
function money(amount) { return new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: 0 }).format(amount / 100); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function visibleProducts() {
  return products.filter(item => (selectedCategory === 'all' || item.category_id === selectedCategory) && (!query || `${item.name} ${item.short_description || ''}`.toLowerCase().includes(query)));
}
function renderProducts() {
  if (!productGrid) return;
  const rows = visibleProducts();
  if (countLabel) countLabel.textContent = demoMode ? `${products.length} demovarer · eksempelpriser` : products.length ? `${products.length} produkter` : 'Utvalget åpner snart';
  if (!rows.length) {
    productGrid.innerHTML = products.length
      ? '<p class="catalog-message">Ingen produkter matcher søket ditt. Prøv et annet ord.</p>'
      : '<div class="catalog-empty catalog-empty-shop"><div class="empty-symbol">✳</div><div><h2>Vi gjør klar utvalget.</h2><p>Produktene vises her så snart butikken er fylt opp. Har du spørsmål eller leter etter noe spesielt, send oss gjerne en melding.</p><a class="button button-dark" href="contact.html">Ta kontakt <span>↗</span></a></div></div>';
    return;
  }
  productGrid.innerHTML = rows.map(item => {
    const image = Array.isArray(item.images) && item.images[0] ? `<img src="${escapeHtml(item.images[0])}" alt="${escapeHtml(item.name)}" loading="lazy">` : `<span class="product-placeholder" aria-hidden="true">H</span>`;
    const stock = item.stock_quantity === null || item.stock_quantity > 0;
    const options = variants.filter(v => v.product_id === item.id);
    const selector = options.length ? `<label style="display:block;font-size:12px">Velg variant<select data-product-variant="${item.id}" style="width:100%;padding:10px;margin:8px 0">${options.map(v => `<option value="${v.id}" ${v.stock_quantity ? '' : 'disabled'}>${escapeHtml(v.name)} · ${money(v.price_ore ?? item.price_ore)}${v.stock_quantity ? '' : ' · utsolgt'}</option>`).join('')}</select></label>` : '';
    return `<article class="product-card"><div class="product-visual">${image}${item.demo ? '<span class="product-badge">Demo · eksempelpris</span>' : item.is_featured ? '<span class="product-badge">Utvalgt</span>' : ''}</div><div class="product-details"><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.short_description || '')}</p>${selector}<div class="product-price"><strong>${money(item.price_ore)}</strong><button type="button" data-add-to-cart="${item.id}" ${stock && (!options.length || options.some(v=>v.stock_quantity>0)) ? '' : 'disabled'}>${stock ? 'Legg i kurv +' : 'Utsolgt'}</button></div></div></article>`;
  }).join('');
}
function renderCategories() {
  if (!categoryPills) return;
  categoryPills.innerHTML = `<button class="pill ${selectedCategory === 'all' ? 'is-selected' : ''}" data-category="all">Alt</button>` + categories.map(row => `<button class="pill ${selectedCategory === row.id ? 'is-selected' : ''}" data-category="${row.id}">${escapeHtml(row.name)}</button>`).join('');
}
function renderCart() {
  const itemsEl = document.querySelector('[data-cart-items]');
  const countEl = document.querySelector('[data-cart-count]');
  const totalEl = document.querySelector('[data-cart-total]');
  const checkout = document.querySelector('[data-checkout]');
  const rows = cart.map(line => ({ ...line, product: products.find(item => item.id === line.id) })).filter(line => line.product);
  const count = rows.reduce((sum, row) => sum + row.quantity, 0);
  const total = rows.reduce((sum, row) => sum + unitPrice(row) * row.quantity, 0);
  if (countEl) countEl.textContent = String(count);
  if (totalEl) totalEl.textContent = money(total);
  if (itemsEl) itemsEl.innerHTML = rows.length ? rows.map(row => `<div class="cart-item"><div><strong>${escapeHtml(row.product.name)}${row.variant_id ? ' · ' + escapeHtml(variantOf(row)?.name || '') : ''}</strong><small>${money(unitPrice(row))} per stk.</small></div><div class="cart-quantity"><button data-quantity="${lineKey(row)}" data-delta="-1" aria-label="Fjern én ${escapeHtml(row.product.name)}">−</button><span>${row.quantity}</span><button data-quantity="${lineKey(row)}" data-delta="1" aria-label="Legg til én ${escapeHtml(row.product.name)}">+</button></div></div>`).join('') : '<div class="cart-empty">Kurven er tom ennå.<br>Finn noe du liker i butikken.</div>';
  if (checkout) checkout.disabled = !rows.length;
}
async function loadCatalog() {
  if (!productGrid) return;
  const [categoryResult, productResult, variantResult] = await Promise.all([
    db.from('categories').select('id,name,slug,sort_order').order('sort_order'),
    db.from('products').select('id,name,slug,short_description,price_ore,images,stock_quantity,is_featured,is_demo,category_id').eq('is_published', true).order('created_at', { ascending: false }),
    db.from('product_variants').select('*').eq('is_active', true),
  ]);
  if (!categoryResult.error) categories = categoryResult.data || [];
  if (!variantResult.error) variants = variantResult.data || [];
  if (!productResult.error) {
    const published = productResult.data || [];
    const realProducts = published.filter(item => !item.is_demo);
    demoMode = realProducts.length === 0;
    products = published.map(item => ({ ...item, demo: Boolean(item.is_demo) }));
  }
  if (!products.length) { demoMode = true; products = demoProducts; if (!categories.length) categories = demoCategories; }
  cart = cart.filter(line => products.some(item => item.id === line.id));
  renderCategories(); renderProducts(); saveCart();
}

document.addEventListener('click', event => {
  const category = event.target.closest('[data-category]');
  if (category) { selectedCategory = category.dataset.category; renderCategories(); renderProducts(); }
  const add = event.target.closest('[data-add-to-cart]');
  if (add) {
    const item = products.find(product => product.id === add.dataset.addToCart);
    if (!item) return;
    const variant_id = document.querySelector(`[data-product-variant="${item.id}"]`)?.value || null;
    const selected = variants.find(v => v.id === variant_id);
    const line = cart.find(row => row.id === item.id && (row.variant_id || null) === variant_id);
    const maximum = Math.min(99, selected?.stock_quantity ?? 99, item.stock_quantity ?? 99);
    if ((line?.quantity || 0) >= maximum) return;
    if (line) line.quantity += 1; else cart.push({ id: item.id, variant_id, quantity: 1 });
    saveCart();
  }
  const quantity = event.target.closest('[data-quantity]');
  if (quantity) {
    const line = cart.find(row => lineKey(row) === quantity.dataset.quantity);
    if (line) { const max = Math.min(99, variantOf(line)?.stock_quantity ?? 99, products.find(p => p.id === line.id)?.stock_quantity ?? 99); line.quantity = Math.min(max, line.quantity + Number(quantity.dataset.delta)); }
    cart = cart.filter(row => row.quantity > 0); saveCart();
  }
  if (event.target.closest('[data-cart-open]')) setCartOpen(true);
  if (event.target.closest('[data-cart-close]')) setCartOpen(false);
});
function setCartOpen(open) {
  const drawer = document.querySelector('[data-cart-drawer]');
  if (!drawer) return;
  drawer.classList.toggle('is-open', open); drawer.setAttribute('aria-hidden', String(!open));
  document.body.style.overflow = open ? 'hidden' : '';
  if (open) drawer.querySelector('.icon-button')?.focus();
}
searchInput?.addEventListener('input', () => { query = searchInput.value.trim().toLowerCase(); renderProducts(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') setCartOpen(false); });
document.querySelector('[data-checkout]')?.addEventListener('click', () => {
  if (!cart.length) return;
  window.location.href = 'checkout.html';
});
renderCart();
loadCatalog().catch(() => { if (productGrid) productGrid.innerHTML = '<p class="catalog-message">Vi klarte ikke å hente butikken akkurat nå. Prøv igjen om litt.</p>'; });

